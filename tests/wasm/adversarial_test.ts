import { Buffer } from "node:buffer";
import { createRuntimeMigration } from "./runtime_migration.ts";
import type { IOOptions, runPlugin } from "./wasi_test_host.ts";
type PluginResult = Awaited<ReturnType<typeof runPlugin>>;
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

Deno.test("WAT adversarial", async (t) => {
  // Adversarial full-plugin tests with fresh instances and bounded execution.
  // Usage: deno test -A tests/wasm/adversarial_test.ts -- [candidate.wasm] [name-filter]
  // Optional ORACLE=/path/to/native/plugin checks the marked small cases against
  // a fresh native reference. Capacity cases intentionally stay WASM-only.

  const binaryPath = Deno.args[0] ||
    "bin/sqlc-gen-typescript-native.wasm";
  const filter = Deno.args[1] || "";
  let oracleMigration:
    | Awaited<ReturnType<typeof createRuntimeMigration>>
    | undefined;
  const binary = await Deno.readFile(binaryPath);
  const INPUT = 16 * 1024 * 1024;
  const SEED = 0xa17e5eed;
  const hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");

  // A parent-side timer can stop synchronous Wasm, even if the guest never calls
  // an import again. Reuse compiled code, but never reuse guest memory/globals.
  type WorkerReply = { ready?: true; result?: PluginResult; error?: string };
  class Runner {
    worker: Worker;
    ready: Promise<WorkerReply>;
    constructor(bytes: Uint8Array) {
      this.worker = new Worker(
        new URL("./adversarial_worker.ts", import.meta.url).href,
        { type: "module" },
      );
      this.ready = this.receive(10000);
      this.worker.postMessage({ binary: bytes });
    }
    receive(timeout: number): Promise<WorkerReply> {
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          this.worker.removeEventListener("message", message);
          this.worker.removeEventListener("error", error);
        };
        const message = (event: MessageEvent<WorkerReply>) => {
          cleanup();
          resolve(event.data);
        };
        const error = (event: ErrorEvent) => {
          event.preventDefault();
          cleanup();
          reject(Error(event.message));
        };
        const timer = setTimeout(() => {
          cleanup();
          this.worker.terminate();
          reject(Error(`guest exceeded ${timeout} ms deadline`));
        }, timeout);
        this.worker.addEventListener("message", message, { once: true });
        this.worker.addEventListener("error", error, { once: true });
      });
    }
    async run(
      request: Uint8Array,
      args: string[] = [],
      io: IOOptions = {},
      timeout = 5000,
    ) {
      assert.deepEqual(await this.ready, { ready: true });
      const received = this.receive(timeout);
      this.worker.postMessage({ request, args, io });
      const { result, error } = await received;
      if (error) throw Error(error);
      assert.ok(result, "worker returned no result");
      return {
        ...result,
        stdout: Buffer.from(result.stdout),
        stderr: Buffer.from(result.stderr),
      };
    }
    close() {
      this.worker.terminate();
    }
  }

  function varint(value: number | bigint) {
    value = BigInt.asUintN(64, BigInt(value));
    const bytes = [];
    do {
      const low = Number(value & 127n);
      value >>= 7n;
      bytes.push(low | (value ? 128 : 0));
    } while (value);
    return Buffer.from(bytes);
  }
  type Bytes = string | Uint8Array;
  const join = (...parts: (Uint8Array | Uint8Array[])[]) =>
    Buffer.concat(parts.flat());
  const tag = (number: number, wire: number) =>
    varint(BigInt(number) * 8n + BigInt(wire));
  const bytesField = (number: number, value: Bytes) => {
    const bytes = Buffer.from(value);
    return join(tag(number, 2), varint(bytes.length), bytes);
  };
  const scalar = (number: number, value: number | bigint) =>
    join(tag(number, 0), varint(value));
  const id = (name: Bytes, schema = "public") =>
    join(bytesField(2, schema), bytesField(3, name));
  const column = (
    name: Bytes = "value",
    type: Bytes = "text",
    extra: Uint8Array[] = [],
  ) => join(bytesField(1, name), scalar(3, 1), bytesField(12, id(type)), extra);
  interface QueryOptions {
    name?: Bytes;
    sql?: Bytes;
    filename?: string;
    cmd?: string;
    columns?: Uint8Array[];
    params?: Uint8Array[];
    comments?: Bytes[];
  }
  function query(
    {
      name = "GetValue",
      sql = "SELECT 1",
      filename = "queries.sql",
      cmd = ":one",
      columns = [column()],
      params = [],
      comments = [],
    }: QueryOptions = {},
  ) {
    return join(
      bytesField(1, sql),
      bytesField(2, name),
      bytesField(3, cmd),
      columns.map((c) => bytesField(4, c)),
      params.map((p) => bytesField(5, p)),
      comments.map((c) => bytesField(6, c)),
      bytesField(7, filename),
    );
  }
  const settings = (engine = "postgresql", extra: Uint8Array[] = []) =>
    join(bytesField(2, engine), extra);
  const catalog = (tables: Uint8Array[] = [], enums: Uint8Array[] = []) =>
    join(
      bytesField(2, "public"),
      bytesField(
        4,
        join(
          bytesField(2, "public"),
          tables.map((t) => bytesField(3, t)),
          enums.map((e) => bytesField(4, e)),
        ),
      ),
    );
  const defaults = { driver: "pg", runtime: "node" };
  interface RequestOptions {
    queries?: Uint8Array[];
    tables?: Uint8Array[];
    enums?: Uint8Array[];
    options?: Record<string, unknown>;
    rawOptions?: Bytes;
    extra?: Uint8Array[];
    setting?: Uint8Array;
  }
  function request(
    {
      queries = [],
      tables = [],
      enums = [],
      options = defaults,
      rawOptions,
      extra = [],
      setting = settings(),
    }: RequestOptions = {},
  ) {
    return join(
      bytesField(1, setting),
      bytesField(2, catalog(tables, enums)),
      queries.map((q) => bytesField(3, q)),
      bytesField(5, rawOptions ?? JSON.stringify(options)),
      extra,
    );
  }

  // Validate the complete response independently of the guest's parser. Invalid
  // requests may fail; a success must contain well-formed, complete file records.
  function fields(bytes: Uint8Array) {
    let at = 0;
    const uint = () => {
      let value = 0, shift = 0, byte;
      do {
        assert.ok(
          at < bytes.length && shift < 35,
          "truncated/overflowing response integer",
        );
        byte = bytes[at++];
        value += (byte & 127) * 2 ** shift;
        shift += 7;
      } while (byte & 128);
      return value;
    };
    const result: [number, Uint8Array][] = [];
    while (at < bytes.length) {
      const key = uint();
      assert.equal(key % 8, 2, "unexpected response wire type");
      const length = uint();
      assert.ok(length <= bytes.length - at, "truncated response field");
      result.push([Math.floor(key / 8), bytes.subarray(at, at + length)]);
      at += length;
    }
    return result;
  }
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  interface GeneratedFile {
    name: string;
    contents: string;
  }
  function responseFiles(bytes: Uint8Array): GeneratedFile[] {
    const files = fields(bytes).map(([key, body]) => {
      assert.equal(key, 1);
      const file = fields(body);
      assert.deepEqual(file.map(([n]) => n), [1, 2]);
      const name = utf8.decode(file[0][1]);
      assert.ok(
        name.length > 0 && !name.includes("\0"),
        "invalid response filename",
      );
      return { name, contents: utf8.decode(file[1][1]) };
    });
    assert.ok(
      files.length > 0 && files.length <= 1024,
      "invalid response file count",
    );
    for (let i = 1; i < files.length; i++) {
      assert.ok(
        Buffer.compare(
          Buffer.from(files[i - 1].name),
          Buffer.from(files[i].name),
        ) <= 0,
        "unsorted response",
      );
    }
    return files;
  }

  const runner = new Runner(binary);
  let passed = 0, succeeded = 0, rejected = 0, oracleChecks = 0;
  const baseline = new Map<Uint8Array, PluginResult>();
  interface CheckOptions {
    status?: number;
    diagnostic?: RegExp;
    args?: string[];
    io?: IOOptions;
    same?: Uint8Array;
    inspect?: (files: GeneratedFile[]) => void;
    oracle?: boolean;
  }
  async function check(
    name: string,
    payload: Uint8Array,
    { status, diagnostic, args = [], io = {}, same, inspect, oracle = false }:
      CheckOptions = {},
  ) {
    if (filter && !name.includes(filter)) return;
    const ok = await t.step(name, async () => {
      try {
        const actual = await runner.run(payload, args, io);
        assert.ok(
          actual.status === 0 || actual.status === 2,
          `unexpected exit ${actual.status}`,
        );
        if (status !== undefined) {
          assert.equal(
            actual.status,
            status,
            actual.stderr.toString().slice(0, 500),
          );
        }
        if (actual.status === 0) {
          assert.equal(actual.stderr.length, 0, "success wrote stderr");
          const files = responseFiles(actual.stdout);
          if (inspect) inspect(files);
          succeeded++;
        } else {
          assert.equal(
            actual.stdout.length,
            0,
            "rejected request wrote partial stdout",
          );
          if (!io.stderrZero && !io.stderrError && !io.stderrOverreport) {
            assert.match(
              actual.stderr.toString(),
              /^error generating output: /,
            );
            assert.equal(actual.stderr.at(-1), 10, "unterminated diagnostic");
          }
          rejected++;
        }
        if (diagnostic) assert.match(actual.stderr.toString(), diagnostic);
        if (same) {
          if (!baseline.has(same)) baseline.set(same, await runner.run(same));
          const expected = baseline.get(same)!;
          assert.equal(actual.status, expected.status);
          assert.deepEqual(actual.stdout, expected.stdout);
          assert.deepEqual(actual.stderr, expected.stderr);
        }
        if (oracle && Deno.env.get("ORACLE")) {
          const child = new Deno.Command(Deno.env.get("ORACLE")!, {
            args,
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
          }).spawn();
          const timer = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch { /* Already exited. */ }
          }, 5000);
          let native: Deno.CommandOutput;
          try {
            const writer = child.stdin.getWriter();
            const write = async () => {
              try {
                await writer.write(payload);
              } finally {
                await writer.close();
              }
            };
            [native] = await Promise.all([child.output(), write()]);
          } finally {
            clearTimeout(timer);
          }
          assert.equal(native.signal, null);
          assert.equal(actual.status, native.code);
          oracleMigration ??= await createRuntimeMigration();
          assert.deepEqual(
            actual.stdout,
            oracleMigration.migrate(Buffer.from(native.stdout)),
          );
          assert.deepEqual(actual.stderr, Buffer.from(native.stderr));
          oracleChecks++;
        }
        passed++;
      } catch (error) {
        throw new Error(
          `${name} (seed 0x${
            SEED.toString(16)
          }, ${payload.length} bytes, sha256 ${hash(payload)}): ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
    });
    if (!ok) throw Error(`Stopped after failed case: ${name}`);
  }

  try {
    assert.deepEqual(await runner.ready, { ready: true });
    // Verify the watchdog using a tiny module whose _start never calls the host.
    // Reuse the candidate's section-free memory contract in direct Wasm bytes.
    const loopModule = Buffer.from(
      "0061736d01000000010401600000030201000506010180088008071302066d656d6f72790200065f737461727400000a0901070003400c000b0b",
      "hex",
    );
    const watchdog = new Runner(loopModule);
    try {
      await assert.rejects(
        () => watchdog.run(Buffer.alloc(0), [], {}, 100),
        /deadline/,
      );
    } finally {
      await watchdog.close();
    }

    // A trap must fail the harness, never masquerade as a clean proc_exit(2).
    const trapModule = Buffer.from(
      loopModule.toString("hex").replace(
        "0a0901070003400c000b0b",
        "0a05010300000b",
      ),
      "hex",
    );
    const trap = new Runner(trapModule);
    try {
      await assert.rejects(
        () => trap.run(Buffer.alloc(0)),
        /RuntimeError: unreachable/,
      );
    } finally {
      await trap.close();
    }

    const plain = request({ queries: [query()] });
    await check("valid/baseline", plain, { status: 0, oracle: true });
    const nul = "left\0right";
    const strange = [
      nul,
      "e\u0301",
      "é",
      "ſKİıß",
      "Σσς",
      "猫𐐨😀",
      "👩🏽‍💻",
      "\u202eabc\u202c",
      "\u2066abc\u2069",
      "\ufeff\u200b\u200d",
      "\u2028\u2029",
      "\ufffe\uffff",
      "\u{10ffff}",
      "__proto__",
      "constructor",
      'a*/b/*c` ${x} \\ "\r\n',
    ];
    for (const [i, text] of strange.entries()) {
      await check(
        `unicode/${i}/sql-name-column-comment`,
        request({
          queries: [
            query({
              name: `Read${text}`,
              sql: `SELECT '${text}'`,
              columns: [column(text)],
              comments: [text],
            }),
          ],
        }),
        { status: 0, oracle: true },
      );
      await check(
        `unicode/${i}/model-enum`,
        request({
          tables: [
            join(
              bytesField(1, id(`items${text}`)),
              bytesField(2, column(text)),
            ),
          ],
          enums: [
            join(
              bytesField(1, `state${text}`),
              bytesField(2, text),
              bytesField(2, "other"),
            ),
          ],
        }),
        { status: 0, oracle: true },
      );
    }
    await check(
      "nul/sql-is-not-truncated",
      request({ queries: [query({ sql: `SELECT '${nul}'` })] }),
      {
        status: 0,
        inspect: (files) =>
          assert.ok(files.some((f) =>
            f.contents.includes("left\\x00right") ||
            f.contents.includes("left\\0right") ||
            f.contents.includes("left\\u0000right")
          )),
        oracle: true,
      },
    );
    for (
      const filename of [
        "x\0.sql",
        "a#\0.sql",
        "../x.sql",
        "/x.sql",
        "C:\\x.sql",
        "..\\x.sql",
        "a%00.sql",
        "a?x.sql",
      ] as const
    ) {
      await check(
        `path/${JSON.stringify(filename)}`,
        request({ queries: [query({ filename })] }),
        { status: 2, oracle: true },
      );
    }
    for (
      const filename of [
        "日本語/猫.sql",
        "e\u0301/é.sql",
        "a/../b.sql",
        ".hidden/queries.sql",
        "a\\b.sql",
      ] as const
    ) {
      await check(
        `path/valid/${filename}`,
        request({ queries: [query({ filename })] }),
        { status: 0, oracle: true },
      );
    }

    // Malformed UTF-8 belongs in protobuf string fields; bytes/options fields
    // follow JSON's separate replacement rules instead of protobuf rejection.
    const badUtf8 = [
      [0x80],
      [0xff],
      [0xc0, 0x80],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xf5, 0x80, 0x80, 0x80],
      [0xc2],
      [0xe2, 0x82],
      [0xf0, 0x9f, 0x92],
    ];
    for (const [i, bytes] of badUtf8.entries()) {
      const raw = Buffer.from(bytes);
      await check(
        `utf8/${i}/query`,
        request({ queries: [query({ name: raw })] }),
        { status: 2, diagnostic: /invalid UTF-8/, oracle: true },
      );
      await check(
        `utf8/${i}/nested-column`,
        request({ queries: [query({ columns: [column(raw)] })] }),
        { status: 2, diagnostic: /invalid UTF-8/, oracle: true },
      );
      await check(
        `utf8/${i}/json-replacement`,
        request({
          rawOptions: join(
            Buffer.from('{"driver":"pg","out":"'),
            raw,
            Buffer.from('"}'),
          ),
        }),
        { status: 0, oracle: true },
      );
      await check(
        `utf8/${i}/opaque-unknown`,
        join(plain, bytesField(500, raw)),
        { status: 0, same: plain, oracle: true },
      );
    }
    for (
      const rawOptions of [
        '{"driver":"pg","out":"\\u0000"}',
        '{"driver":"pg","out":"\\ud800"}',
        '{"driver":"pg","out":"\\udfff"}',
        '{"DRIVER":"pg","TYPEſ_ONLY":true}',
        '{"driver":"pg","driver":null}',
        '{"driver":"bad","driver":"pg"}',
      ] as const
    ) {
      await check(`json/valid/${rawOptions}`, request({ rawOptions }), {
        status: 0,
        oracle: true,
      });
    }
    for (
      const rawOptions of [
        "\0",
        '{"driver":"pg"}\0',
        '{"driver":"p\0g"}',
        '{"driver":"pg","out":"\\x00"}',
        '{"driver":"pg","out":"\\u000g"}',
        '{"driver":"pg","__proto__":{}}',
        '{"driver":"pg"}{}',
      ] as const
    ) {
      await check(
        `json/invalid/${JSON.stringify(rawOptions)}`,
        request({ rawOptions }),
        { status: 2, oracle: true },
      );
    }
    for (const depth of [127, 128, 129, 1000, 10001] as const) {
      await check(
        `json/depth/${depth}`,
        request({ rawOptions: "[".repeat(depth) + "0" + "]".repeat(depth) }),
        { status: 2 },
      );
    }
    for (const count of [16377, 16378] as const) {
      await check(
        `json/tokens/${count + 7}`,
        request({
          rawOptions: '{"driver":"pg","types_only":true,"out":[' +
            Array(count).fill("null").join(",") + "]}",
        }),
        {
          status: 2,
          diagnostic: count === 16377
            ? /cannot unmarshal array/
            : /fixed memory capacity/,
        },
      );
    }
    for (
      const value of [
        -2147483648,
        -1,
        0,
        1,
        6,
        7,
        2147483647,
        0x100000000n,
        0xffffffffffffffffn,
      ] as const
    ) {
      const normalized = Number(BigInt.asIntN(32, BigInt(value)));
      await check(
        `integer/array-dimensions/${value}`,
        request({
          queries: [
            query({ columns: [column("value", "text", [scalar(17, value)])] }),
          ],
        }),
        { status: normalized >= 0 && normalized <= 6 ? 0 : 2, oracle: true },
      );
      await check(
        `integer/parameter-number/${value}`,
        request({
          queries: [
            query({
              sql: "SELECT $1",
              params: [join(scalar(1, value), bytesField(2, column()))],
            }),
          ],
        }),
      );
    }

    // Bad wire types, field numbers, varint overflows, non-minimal encodings,
    // embedded groups and every truncation of a valid complete request.
    for (
      const [i, bytes] of [
        [0],
        [0xff],
        [0x0f],
        [0x0e],
        [0x0c],
        [0x0a, 0xff, 0xff, 0xff, 0xff, 0x0f],
        [...Array(10).fill(0x80)],
        [...Array(9).fill(0xff), 2],
      ].entries()
    ) {
      await check(`wire/malformed/${i}`, Buffer.from(bytes), {
        status: 2,
        oracle: true,
      });
    }
    for (const number of [1, 5, 500, 536870911] as const) {
      for (const wire of [0, 1, 2, 5] as const) {
        const value = wire === 0
          ? varint(0xffffffffffffffffn)
          : wire === 1
          ? Buffer.alloc(8, 255)
          : wire === 5
          ? Buffer.alloc(4, 255)
          : join(varint(3), Buffer.from([0, 255, 128]));
        if (number <= 5 && wire === 2) continue;
        await check(
          `wire/unknown-or-wrong-type/${number}/${wire}`,
          join(plain, tag(number, wire), value),
          { status: 0, same: plain, oracle: true },
        );
      }
    }
    for (const depth of [1, 99, 100, 101, 1000] as const) {
      const group = join(
        Array(depth).fill(tag(500, 3)),
        scalar(501, 123),
        Array(depth).fill(tag(500, 4)),
      );
      await check(`wire/groups/${depth}`, join(plain, group), {
        status: depth < 100 ? 0 : 2,
        ...(depth < 100 ? { same: plain } : {}),
      });
    }
    await check("wire/group-mismatch", join(plain, tag(500, 3), tag(501, 4)), {
      status: 2,
      oracle: true,
    });
    await check(
      "wire/non-minimal-tag",
      join(plain, Buffer.from([0xa0, 0x9f, 0x80, 0x00, 0x80, 0x00])),
      { status: 0, same: plain, oracle: true },
    );
    for (let end = 0; end < plain.length; end++) {
      await check(`wire/truncation/${end}`, plain.subarray(0, end));
    }

    // Resource limits through _start, not by directly setting internal cursors.
    for (const count of [65532, 65533] as const) {
      const payload = request({
        setting: settings("postgresql", Array(count).fill(bytesField(3, ""))),
      });
      await check(`capacity/protobuf-records/${count + 4}`, payload, {
        status: count === 65532 ? 0 : 2,
      });
    }
    for (const delta of [-1, 0, 1] as const) {
      const length = INPUT + delta - plain.length - tag(500, 2).length - 4;
      const payload = join(plain, bytesField(500, Buffer.alloc(length, 0)));
      assert.equal(payload.length, INPUT + delta);
      await check(`capacity/input/${INPUT + delta}`, payload, {
        status: delta <= 0 ? 0 : 2,
        ...(delta <= 0
          ? { same: plain }
          : { diagnostic: /input exceeds fixed memory capacity/ }),
      });
    }
    await check(
      "capacity/large-opaque-nonzero",
      join(plain, bytesField(500, Buffer.alloc(1024 * 1024, 255))),
      { status: 0, same: plain },
    );
    await check(
      "capacity/large-sql",
      request({
        queries: [query({ sql: "SELECT '" + "a".repeat(256 * 1024) + "'" })],
      }),
      { status: 0 },
    );
    await check(
      "capacity/nul-escape-expansion",
      request({ queries: [query({ sql: "\0".repeat(3 * 1024 * 1024) })] }),
      { status: 2, diagnostic: /fixed memory capacity/ },
    );
    await check(
      "capacity/long-name",
      request({ queries: [query({ name: "a".repeat(1024 * 1024) })] }),
      { status: 2, diagnostic: /fixed memory capacity/ },
    );
    await check(
      "capacity/many-files",
      request({
        options: { ...defaults, types_only: true },
        queries: Array.from(
          { length: 1025 },
          (_, i) => query({ name: `Q${i}`, filename: `q${i}.sql` }),
        ),
      }),
      { status: 2, diagnostic: /fixed memory capacity/ },
    );

    for (
      const [i, io] of [
        { argsSizeError: true },
        { argsGetError: true },
        { argc: 0xffffffff },
        { argc: 4194304, argBytes: 1 },
        { methodPointer: 0 },
        { methodPointer: 67108864 },
        { unterminatedMethod: true },
        { readOverreport: true },
        { stdoutOverreport: true },
        { stdoutZero: true },
        { readError: true },
        { stdoutError: true },
      ].entries()
    ) {
      await check(`host/fault/${i}`, plain, {
        status: 2,
        args: ["/plugin.CodegenService/Generate"],
        io,
      });
    }
    for (
      const io of [{ stderrZero: true }, { stderrError: true }, {
        stderrOverreport: true,
      }] as const
    ) {
      await check(
        `host/error-reporting/${Object.keys(io)[0]}`,
        Buffer.from([0]),
        { status: 2, io },
      );
    }
    for (
      const text of [
        nul,
        "日本語😀",
        "\u202eunknown",
        "/plugin.CodegenService/GenerateX",
      ] as const
    ) {
      if (text.includes("\0")) continue; // WASI argv uses NUL termination, unlike protobuf text.
      await check(`args/unknown/${text}`, plain, {
        status: 2,
        args: [text],
        oracle: true,
      });
    }
    await check(
      "fragmented/unicode-nul",
      request({ queries: [query({ sql: `SELECT '${strange.join(" ")}'` })] }),
      { status: 0, io: { readChunk: 1, writeChunk: 1 }, oracle: true },
    );

    // Seeded mutation reaches valid nested messages as well as top-level errors.
    // Mutated requests may legitimately succeed; validate both outcomes strictly.
    const corpus = JSON.parse(
      gunzipSync(
        await Deno.readFile(
          new URL("./fixtures/generator.json.gz", import.meta.url),
        ),
      ).toString(),
    );
    const seeds = [
      plain,
      ...corpus.cases.map((c: { request: string }) =>
        Buffer.from(c.request, "base64")
      ).filter((b: Buffer) => b.length > 0 && b.length < 32768),
    ];
    let state = SEED;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    for (let i = 0; i < 1200; i++) {
      let payload = Buffer.from(seeds[random() % seeds.length]);
      for (let j = 0, n = 1 + random() % 4; j < n; j++) {
        const at = random() % (payload.length + 1), kind = random() % 5;
        if (kind === 0) payload = payload.subarray(0, at);
        else if (kind === 1 && at < payload.length) {
          payload[at] ^= 1 << (random() % 8);
        } else if (kind === 2) {
          payload = join(
            payload.subarray(0, at),
            Buffer.from([[0, 255, 128, 0xc0, 0xed, 0xf4][random() % 6]]),
            payload.subarray(at),
          );
        } else if (kind === 3) {
          payload = join(
            payload.subarray(0, at),
            payload.subarray(Math.min(at + 1, payload.length)),
          );
        } else {payload = join(
            payload,
            payload.subarray(at, Math.min(at + 16, payload.length)),
          );}
      }
      await check(`mutation/${i}`, payload);
    }
    for (let i = 0; i < 200; i++) {
      await check(
        `random/${i}`,
        Buffer.from(
          Array.from({ length: random() % 256 }, () => random() & 255),
        ),
      );
    }

    // Re-encode valid wire lengths after changing nested metadata. These cases
    // reach the generator instead of mostly stopping in protobuf validation.
    const dialects = [
      ["postgresql", "pg"],
      ["postgresql", "postgres"],
      ["mysql", "mysql2"],
      ["sqlite", "better-sqlite3"],
    ] as const;
    for (let i = 0; i < 240; i++) {
      const [engine, driver] = dialects[i % dialects.length];
      const text = strange[random() % strange.length] +
        strange[random() % strange.length];
      const badDimensions = i % 12 === 0;
      const dimensions = badDimensions
        ? 2147483647
        : engine === "postgresql"
        ? [0, 1, 2, 6][random() % 4]
        : 0;
      const fields = Array.from(
        { length: 1 + random() % 8 },
        (_, field) =>
          column(text, field % 2 ? "integer" : "text", [
            scalar(3, random() % 2),
            scalar(17, dimensions),
          ]),
      );
      await check(
        `structured/${engine}/${i}`,
        request({
          setting: settings(engine),
          options: {
            driver,
            runtime: ["node", "bun", "deno"][random() % 3],
            types_only: i % 5 === 0,
            emit_query_factory: true,
            emit_null_as_undefined: Boolean(random() % 2),
          },
          tables: [
            join(
              bytesField(1, id(`items${text}`)),
              fields.map((field) => bytesField(2, field)),
            ),
          ],
          queries: Array.from({ length: 1 + random() % 4 }, () =>
            query({
              name: `Read${text}`,
              sql: `SELECT '${text}'`,
              columns: fields,
              comments: [text],
            })),
        }),
        { status: badDimensions ? 2 : 0, oracle: true },
      );
    }
    assert.ok(passed > 0, "name filter matched no tests");
    console.log(
      `Adversarial WASM: ${passed} passed (${succeeded} success, ${rejected} clean rejection, ${oracleChecks} native comparisons); seed 0x${
        SEED.toString(16)
      }, ${binary.length} bytes`,
    );
  } finally {
    await runner.close();
  }
});
