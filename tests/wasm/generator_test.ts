import type { GeneratorCorpus } from "./fixture_types.ts";
import { createRuntimeMigration } from "./runtime_migration.ts";
interface Expected {
  status: number;
  response: Buffer;
  stderr: Buffer;
}
import { Buffer } from "node:buffer";
import { command, wabt } from "./test_helpers.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { type IOOptions, runPlugin } from "./wasi_test_host.ts";

Deno.test("WAT generator", async (t) => {
  // Whole-program compatibility checks against frozen reference responses. The test host
  // uses JavaScript allocations; the guest must retain its one fixed memory and
  // import only command arguments and byte-stream I/O.
  //
  // Usage: deno test -A tests/wasm/generator_test.ts -- [path/to/candidate.wasm]

  const binaryPath = Deno.args[0] ||
    "bin/sqlc-gen-typescript-native.wasm";
  const binary = await Deno.readFile(binaryPath);
  const module = await WebAssembly.compile(binary);
  const MEMORY_BYTES = 64 * 1024 * 1024;
  const INPUT_BYTES = 16 * 1024 * 1024;
  const sha256 = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

  assert.deepEqual(
    WebAssembly.Module.imports(module).map((i) =>
      `${i.module}.${i.name}:${i.kind}`
    ).sort(),
    [
      "args_get",
      "args_sizes_get",
      "fd_read",
      "fd_write",
      "proc_exit",
    ].map((name) => `wasi_snapshot_preview1.${name}:function`).sort(),
    "unexpected guest imports",
  );
  assert.deepEqual(
    WebAssembly.Module.exports(module).map((e) => `${e.name}:${e.kind}`).sort(),
    ["_start:function", "memory:memory"],
    "unexpected guest exports",
  );

  // Read the memory section, not an opcode-shaped byte that could occur in data
  // or an instruction operand. Equal minimum/maximum also limits host growth.
  let offset = 8;
  function uleb() {
    let value = 0, shift = 0;
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
    const section = binary[offset++], size = uleb(), end = offset + size;
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
  const printed = await command(wabt("wasm2wat"), [
    binaryPath,
  ], { encoding: "utf8" });
  assert.equal(printed.status, 0, printed.stderr);
  assert.doesNotMatch(
    printed.stdout,
    /\bmemory\.grow\b/,
    "guest contains memory.grow",
  );

  const runtimeMigration = await createRuntimeMigration();

  async function loadCorpus(name: string) {
    const corpus: GeneratorCorpus = JSON.parse(
      gunzipSync(
        await Deno.readFile(
          new URL(`./fixtures/${name}.json.gz`, import.meta.url),
        ),
      ).toString(),
    );
    assert.equal(corpus.format, 1, "unsupported fixture format");
    assert.match(corpus.provenance.source_commit, /^[a-f0-9]{40}$/);
    assert.match(corpus.provenance.source_sha256, /^[a-f0-9]{64}$/);
    const blobs = corpus.response_blobs.map((b) => Buffer.from(b, "base64"));
    return corpus.cases.map((c) => {
      const request = Buffer.from(c.request, "base64");
      const response = Buffer.concat(c.response_chunks.map((i: number) => {
        assert.ok(
          Number.isInteger(i) && i >= 0 && i < blobs.length,
          "invalid response chunk",
        );
        return blobs[i];
      }));
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
      return {
        ...c,
        request,
        // Verify the immutable old response hash above before changing only its
        // known runtime.ts body for the reviewed source-template merge.
        response: runtimeMigration.migrate(response),
        stderr: Buffer.from(c.stderr),
      };
    });
  }
  const cases = await loadCorpus("generator");
  const largeCases = await loadCorpus("generator-large");
  runtimeMigration.assertCoverage();

  function sameBytes(actual: Buffer, expected: Buffer, label: string) {
    if (actual.equals(expected)) return;
    let first = 0;
    while (
      first < Math.min(actual.length, expected.length) &&
      actual[first] === expected[first]
    ) first++;
    assert.fail(
      `${label}: first difference at byte ${first}; got ${actual.length} bytes, wanted ${expected.length}; ` +
        `got ${
          JSON.stringify(actual.subarray(first, first + 120).toString())
        }, ` +
        `wanted ${
          JSON.stringify(expected.subarray(first, first + 120).toString())
        }`,
    );
  }
  async function check(
    name: string,
    request: Uint8Array,
    args: string[],
    expected: Expected,
    io?: IOOptions,
  ) {
    await t.step(name, async () => {
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
    await check(c.name, c.request, c.args, c);
  }

  // Byte-at-a-time reads/writes cover fragmented protobuf headers, payloads,
  // response headers and diagnostics. The large fixture uses bounded short I/O
  // by default, without making millions of JavaScript calls.
  const success = cases.find((c) => c.name === "method/slash");
  assert.ok(success, "missing transport fixture");
  for (
    const name of [
      "method/slash",
      "method/bare",
      "method/unknown",
      "wire/invalid-utf8",
      "wire/zero-tag",
    ] as const
  ) {
    const c = cases.find((c) => c.name === name);
    assert.ok(c, `missing fixture ${name}`);
    for (const [readChunk, writeChunk] of [[1, 1], [37, 29]] as const) {
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
    c.stderr.includes("typescript options: typescript options:")
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
  const paddingLength = INPUT_BYTES - success.request.length -
    paddingTag.length - 4;
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
    await check(`failed stderr ${Object.keys(io)[0]}`, Buffer.from([0]), [], {
      status: 2,
      response: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    }, io);
  }
});

Deno.test("runtime fixture migration rejects unknown support and retains other files", async () => {
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
    /unreviewed historical runtime body/,
  );
  assert.throws(
    () => migration.migrate(Buffer.concat([other, Buffer.from([10, 127])])),
    /truncated frozen response field/,
  );
});
