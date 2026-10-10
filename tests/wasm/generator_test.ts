import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { GeneratorCorpus } from "./fixture_types.ts";
import {
  assertPreservedOutput,
  createRuntimeMigration,
  requestOptions,
} from "./runtime_migration.ts";
interface Expected {
  status: number;
  response: Buffer;
  stderr: Buffer;
}
import { Buffer } from "node:buffer";
import {
  command,
  migrateDriverDiagnostic,
  removedTarget,
  wabt,
} from "./test_helpers.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { type IOOptions, runPlugin } from "./wasi_test_host.ts";

test("WAT generator", async (t) => {
  // Whole-program compatibility checks against frozen reference responses. The test host
  // uses JavaScript allocations; the guest must retain its one fixed memory and
  // import only command arguments and byte-stream I/O.
  //
  // Usage: WASM_BINARY=path/to/candidate.wasm node --test tests/wasm/generator_test.ts

  const binaryPath =
    process.env.WASM_BINARY || "bin/sqlc-gen-typescript-native.wasm";
  const binary = await readFile(binaryPath);
  const module = await WebAssembly.compile(binary);
  const MEMORY_BYTES = 64 * 1024 * 1024;
  const INPUT_BYTES = 16 * 1024 * 1024;
  const sha256 = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

  assert.deepEqual(
    WebAssembly.Module.imports(module)
      .map((i) => `${i.module}.${i.name}:${i.kind}`)
      .sort(),
    ["args_get", "args_sizes_get", "fd_read", "fd_write", "proc_exit"]
      .map((name) => `wasi_snapshot_preview1.${name}:function`)
      .sort(),
    "unexpected guest imports",
  );
  assert.deepEqual(
    WebAssembly.Module.exports(module)
      .map((e) => `${e.name}:${e.kind}`)
      .sort(),
    ["_start:function", "memory:memory"],
    "unexpected guest exports",
  );

  // Read the memory section, not an opcode-shaped byte that could occur in data
  // or an instruction operand. Equal minimum/maximum also limits host growth.
  let offset = 8;
  function uleb() {
    let value = 0,
      shift = 0;
    for (;;) {
      assert.ok(offset < binary.length, "truncated WebAssembly integer");
      const byte = binary[offset++];
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
      assert.ok(shift < 35, "oversized WebAssembly integer");
    }
  }
  let memorySections = 0;
  while (offset < binary.length) {
    const section = binary[offset++],
      size = uleb(),
      end = offset + size;
    assert.ok(end <= binary.length, "truncated WebAssembly section");
    if (section === 5) {
      memorySections++;
      assert.equal(uleb(), 1, "guest must have one memory");
      assert.equal(uleb(), 1, "guest memory must set a maximum");
      assert.equal(uleb(), MEMORY_BYTES / 65536, "guest memory minimum");
      assert.equal(uleb(), MEMORY_BYTES / 65536, "guest memory maximum");
      assert.equal(offset, end, "unexpected memory section data");
    }
    offset = end;
  }
  assert.equal(memorySections, 1, "missing guest memory");
  const printed = await command(wabt("wasm2wat"), [binaryPath], {
    encoding: "utf8",
  });
  assert.equal(printed.status, 0, printed.stderr);
  assert.doesNotMatch(
    printed.stdout,
    /\bmemory\.grow\b/,
    "guest contains memory.grow",
  );

  const runtimeMigration = await createRuntimeMigration();
  // Captured from ed8b0d4 with its explicit native option, before its removal.
  const sqliteDefaults = JSON.parse(
    gunzipSync(
      await readFile(
        new URL("./fixtures/sqlite-default-generator.json.gz", import.meta.url),
      ),
    ).toString(),
  );
  assert.equal(
    sqliteDefaults.source_commit,
    "ed8b0d4783a4f0622909d0ceaaec44a71511ab5c",
  );
  const coveredDefaults = new Set<string>();

  async function loadCorpus(name: string) {
    const corpus: GeneratorCorpus = JSON.parse(
      gunzipSync(
        await readFile(new URL(`./fixtures/${name}.json.gz`, import.meta.url)),
      ).toString(),
    );
    assert.equal(corpus.format, 1, "unsupported fixture format");
    assert.match(corpus.provenance.source_commit, /^[a-f0-9]{40}$/);
    assert.match(corpus.provenance.source_sha256, /^[a-f0-9]{64}$/);
    const blobs = corpus.response_blobs.map((b) => Buffer.from(b, "base64"));
    return corpus.cases.map((c) => {
      const request = Buffer.from(c.request, "base64");
      const response = Buffer.concat(
        c.response_chunks.map((i: number) => {
          assert.ok(
            Number.isInteger(i) && i >= 0 && i < blobs.length,
            "invalid response chunk",
          );
          return blobs[i];
        }),
      );
      assert.equal(
        sha256(request),
        c.request_sha256,
        `${c.name}: request fixture hash`,
      );
      assert.equal(
        sha256(response),
        c.response_sha256,
        `${c.name}: response fixture hash`,
      );
      const migrated = runtimeMigration.migrate(response);
      const nativeKey = `${c.request_sha256}:${JSON.stringify(c.args)}`;
      const native = sqliteDefaults.cases[nativeKey];
      if (native) {
        coveredDefaults.add(nativeKey);
        for (const key of ["request", "response"]) {
          assert.equal(
            sha256(Buffer.from(native[key], "base64")),
            native[`${key}_sha256`],
            `${c.name}: SQLite ${key} fixture hash`,
          );
        }
      }
      return {
        ...c,
        status: native?.status ?? c.status,
        request: native ? Buffer.from(native.request, "base64") : request,
        // Verify historical bytes before loading reviewed compact expectations.
        // The migration independently checks SQL and expanded public types.
        response: native ? Buffer.from(native.response, "base64") : migrated,
        stderr: Buffer.from(
          migrateDriverDiagnostic(native?.stderr ?? c.stderr),
        ),
      };
    });
  }
  const cases = await loadCorpus("generator");
  const largeCases = await loadCorpus("generator-large");
  runtimeMigration.assertCoverage();
  assert.deepEqual(
    [...coveredDefaults].sort(),
    Object.keys(sqliteDefaults.cases).sort(),
  );

  function sameBytes(actual: Buffer, expected: Buffer, label: string) {
    if (actual.equals(expected)) return;
    let first = 0;
    while (
      first < Math.min(actual.length, expected.length) &&
      actual[first] === expected[first]
    )
      first++;
    assert.fail(
      `${label}: first difference at byte ${first}; got ${actual.length} bytes, wanted ${expected.length}; ` +
        `got ${JSON.stringify(
          actual.subarray(first, first + 120).toString(),
        )}, ` +
        `wanted ${JSON.stringify(
          expected.subarray(first, first + 120).toString(),
        )}`,
    );
  }
  async function check(
    name: string,
    request: Uint8Array,
    args: string[],
    expected: Expected,
    io?: IOOptions,
  ) {
    await t.test(name, async () => {
      const actual = await runPlugin(module, request, args, io);
      assert.equal(
        actual.status,
        expected.status,
        `exit status; stderr: ${actual.stderr.toString()}`,
      );
      runtimeMigration.assertRuntimeOutput(actual.stdout);
      sameBytes(actual.stdout, expected.response, "stdout");
      sameBytes(actual.stderr, expected.stderr, "stderr");
    });
  }
  for (const c of [...cases, ...largeCases] as const) {
    const options = requestOptions(c.request);
    if (options && removedTarget(options)) continue;
    await check(c.name, c.request, c.args, c);
  }

  // Byte-at-a-time reads/writes cover fragmented protobuf headers, payloads,
  // response headers and diagnostics. The large fixture uses bounded short I/O
  // by default, without making millions of JavaScript calls.
  const success = cases.find(
    (c) => c.status === 0 && !removedTarget(requestOptions(c.request) ?? {}),
  );
  assert.ok(success, "missing transport fixture");
  for (const name of [
    "method/slash",
    "method/bare",
    "method/unknown",
    "wire/invalid-utf8",
    "wire/zero-tag",
  ] as const) {
    const original = cases.find((c) => c.name === name);
    assert.ok(original, `missing fixture ${name}`);
    const c =
      name === "method/slash" || name === "method/bare"
        ? { ...success, args: original.args }
        : original;
    for (const [readChunk, writeChunk] of [
      [1, 1],
      [37, 29],
    ] as const) {
      await check(
        `${name} short I/O ${readChunk}/${writeChunk}`,
        c.request,
        c.args,
        c,
        { readChunk, writeChunk },
      );
    }
  }
  const optionError = cases.find((c) =>
    c.stderr.includes("typescript options: typescript options:"),
  );
  assert.ok(optionError, "missing wrapped options diagnostic fixture");
  await check(
    "options diagnostic short I/O",
    optionError.request,
    optionError.args,
    optionError,
    { readChunk: 1, writeChunk: 1 },
  );

  function varint(n: number) {
    const bytes = [];
    do {
      const byte = n % 128;
      n = Math.floor(n / 128);
      bytes.push(byte | (n ? 128 : 0));
    } while (n);
    return Buffer.from(bytes);
  }
  // Unknown protobuf bytes are legal padding. The exact 16 MiB request must
  // succeed; the following extra byte must fail before protobuf parsing starts.
  const paddingTag = varint(500 * 8 + 2);
  const paddingLength =
    INPUT_BYTES - success.request.length - paddingTag.length - 4;
  assert.equal(varint(paddingLength).length, 4);
  const fullInput = Buffer.concat([
    success.request,
    paddingTag,
    varint(paddingLength),
    Buffer.alloc(paddingLength),
  ]);
  assert.equal(fullInput.length, INPUT_BYTES);
  await check("exact input capacity", fullInput, success.args, success);
  const failure = (message: string) => ({
    status: 2,
    response: Buffer.alloc(0),
    stderr: Buffer.from(`error generating output: ${message}\n`),
  });
  await check(
    "input capacity plus one",
    Buffer.concat([fullInput, Buffer.from([0])]),
    [],
    failure("input exceeds fixed memory capacity"),
  );
  await check(
    "failed stdin read",
    success.request,
    [],
    failure("input read failed"),
    { readError: true },
  );
  await check(
    "failed stdout write",
    success.request,
    [],
    failure("output write failed"),
    { stdoutError: true },
  );
  await check(
    "zero stdout write",
    success.request,
    [],
    failure("output write failed"),
    { stdoutZero: true },
  );
  for (const io of [{ stderrError: true }, { stderrZero: true }] as const) {
    await check(
      `failed stderr ${Object.keys(io)[0]}`,
      Buffer.from([0]),
      [],
      {
        status: 2,
        response: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
      },
      io,
    );
  }
});

test("output fixture migration rejects unknown responses and retains unchanged files", async () => {
  const migration = await createRuntimeMigration();
  const field = (key: number, bytes: Uint8Array) => {
    assert.ok(bytes.length < 128);
    return Buffer.concat([Buffer.from([key * 8 + 2, bytes.length]), bytes]);
  };
  const response = (name: string, contents: string) =>
    field(
      1,
      Buffer.concat([
        field(1, Buffer.from(name)),
        field(2, Buffer.from(contents)),
      ]),
    );
  const other = response("queries.ts", "export const query = 1;\n");
  assert.strictEqual(migration.migrate(other), other);
  const empty = Buffer.alloc(0);
  assert.strictEqual(migration.migrate(empty), empty);
  assert.throws(
    () => migration.migrate(response("runtime.ts", "unreviewed runtime")),
    /unreviewed historical runtime response/,
  );
  assert.throws(
    () => migration.migrate(Buffer.concat([other, Buffer.from([10, 127])])),
    /truncated frozen response field/,
  );
});

test("output migration audit resolves shared types and catches public regressions", () => {
  const uint = (value: number) => {
    const bytes: number[] = [];
    do {
      const byte = value & 127;
      value >>>= 7;
      bytes.push(byte | (value ? 128 : 0));
    } while (value);
    return Buffer.from(bytes);
  };
  const field = (key: number, bytes: Buffer) =>
    Buffer.concat([uint(key * 8 + 2), uint(bytes.length), bytes]);
  const response = (files: Record<string, string>) =>
    Buffer.concat(
      Object.entries(files).map(([name, source]) =>
        field(
          1,
          Buffer.concat([
            field(1, Buffer.from(name)),
            field(2, Buffer.from(source)),
          ]),
        ),
      ),
    );
  const sql =
    "export const readQuery = `-- name: Read :one\nSELECT 'brace } and quote \"'`;\n";
  const comment = '/** Keep \\"quotes\\" and { braces }. */\n';
  const old = response({
    "nested/query_sql.ts":
      'import type { Database as _old } from "../runtime.ts";\n' +
      sql +
      comment +
      'export interface ReadRow { id: number; "a\\"b": string | null; _short: boolean; }\n' +
      "export async function read(database: _old): Promise<ReadRow | null> { return null; }\n",
    "runtime.ts": "export interface Database {}\n",
  });
  const files = {
    "nested/query_sql.ts":
      'import type { Database as _db } from "../runtime_postgresql.ts";\n' +
      'import type { Shared as _short } from "../query_helpers.ts";\n' +
      sql +
      comment +
      "export interface ReadRow extends _short {}\n" +
      "export async function read(database: _db): Promise<ReadRow | null> { return null; }\n",
    "runtime_common.ts": "export const common = 1;\n",
    "runtime_postgresql.ts":
      'import { common } from "./runtime_common.ts";\nexport interface Database {}\n',
    "query_helpers.ts":
      'export interface Shared { id: number; "a\\"b": string | null; _short: boolean; }\n',
  };
  assertPreservedOutput(old, response(files));
  assert.throws(
    () =>
      assertPreservedOutput(
        old,
        response({
          ...files,
          "query_helpers.ts": files["query_helpers.ts"].replace(
            "string | null",
            "string",
          ),
        }),
      ),
    /public declarations changed/,
  );
  assert.throws(
    () =>
      assertPreservedOutput(
        old,
        response({
          ...files,
          "query_helpers.ts": files["query_helpers.ts"].replace(
            "id: number",
            "renamed: number",
          ),
        }),
      ),
    /public declarations changed/,
  );
  assert.throws(
    () =>
      assertPreservedOutput(
        old,
        response({
          ...files,
          "nested/query_sql.ts": files["nested/query_sql.ts"].replace(
            "SELECT",
            "DELETE",
          ),
        }),
      ),
    /public declarations changed|SQL text changed/,
  );
  for (const keyword of ["import", "export"]) {
    assert.throws(
      () =>
        assertPreservedOutput(
          old,
          response({
            ...files,
            "runtime_postgresql.ts": `${keyword} { common } from "./missing.ts";\nexport interface Database {}\n`,
          }),
        ),
      /missing generated import/,
    );
  }
  assert.throws(
    () =>
      assertPreservedOutput(
        old,
        response({
          ...files,
          "nested/query_sql.ts": files["nested/query_sql.ts"].replace(
            comment,
            "",
          ),
        }),
      ),
    /user comments changed/,
  );
});
