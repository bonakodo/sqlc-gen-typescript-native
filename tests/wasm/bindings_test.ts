import { Buffer } from "node:buffer";
import { command, type Pair, wabt } from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT bindings", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    engine: { value: number };
    errorn: { value: number };
    errorp: { value: number };
    plan: (a0: number) => void;
    record: (a0: number) => number;
    settings: { value: number };
    text: { value: number };
    work: { value: number };
  }
  // Compare the bindings implementation with the frozen reference corpus.
  const corpusPath = new URL("./fixtures/bindings.json", import.meta.url);
  const directory = await Deno.makeTempDir({ prefix: "sqlc-binding-wat-" });
  let module: WebAssembly.Module;
  try {
    const fragments = await Promise.all(
      [
        "core",
        "unicode",
        "inflection-data",
        "text",
        "protocol",
        "state",
        "bindings",
      ].map((name) =>
        Deno.readTextFile(new URL(`../../src/${name}.wat`, import.meta.url))
      ),
    );
    await Deno.writeTextFile(
      join(directory, "test.wat"),
      `(module\n${fragments.join("\n")}
    (global $opt_types_only i32 (i32.const 0))(global $opt_factory i32 (i32.const 0))
    (global $test_errorp (mut i32) (i32.const 0))(global $test_errorn (mut i32) (i32.const 0))
    (func $error (param $p i32)(param $n i32)(global.set $test_errorp(local.get $p))(global.set $test_errorn(local.get $n))(call $wasi_proc_exit(i32.const 2)))
    (export "plan" (func $plan_bindings))(export "record" (func $work_record))
    (export "engine" (global $gen_engine))(export "settings" (global $gen_settings))
    (export "work" (global $work_cursor))(export "text" (global $txt_cursor))
    (export "errorp" (global $test_errorp))(export "errorn" (global $test_errorn))
  )`,
    );
    const result = await command(wabt("wat2wasm"), [
      join(directory, "test.wat"),
      "-o",
      join(directory, "test.wasm"),
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    module = await WebAssembly.compile(
      await Deno.readFile(join(directory, "test.wasm")),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
  class Exit extends Error {
    constructor(readonly code: number) {
      super(`Exit ${code}`);
    }
  }
  const instance = new WebAssembly.Instance(module, {
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        throw new Exit(code);
      },
      fd_read() {
        throw new Error("Unexpected input");
      },
      fd_write() {
        throw new Error("Unexpected output");
      },
    },
  });
  const api = instance.exports as unknown as Exports;
  const mem = new Uint8Array(api.memory.buffer),
    view = new DataView(api.memory.buffer);
  const word = (p: number, v: number) => view.setUint32(p, v, true),
    load = (p: number) => view.getUint32(p, true);
  let cursor = 35000000;
  const put = (s: string | Uint8Array) => {
    const b = typeof s === "string" ? Buffer.from(s) : Buffer.from(s),
      p = cursor;
    mem.set(b, p);
    cursor += b.length + 1;
    return [p, b.length] as Pair;
  };
  const pair = (p: number, s: string | Uint8Array) => {
    const [a, n] = put(s);
    word(p, a);
    word(p + 4, n);
  };
  const get = (p: number, n: number) =>
    Buffer.from(mem.subarray(p, p + n)).toString("utf8");
  const records = JSON.parse(await Deno.readTextFile(corpusPath));
  let failures = 0;
  for (const [i, c] of records.entries()) {
    api.work.value = 40000000;
    api.text.value = 20971520;
    api.errorp.value = 0;
    api.errorn.value = 0;
    cursor = 35000000;
    api.engine.value =
      ({ sqlite: 1, postgresql: 2, mysql: 3 } as Record<string, number>)[
        c.Engine
      ] || 0;
    const settings = api.record(2);
    api.settings.value = settings;
    pair(settings + 32 + 2 * 12, c.Engine);
    const query = api.record(13);
    pair(query + 32 + 12, Buffer.from(c.SQL, "base64"));
    const plan = api.record(106);
    word(plan + 8, query);
    let previous = 0;
    for (const p of c.Parameters) {
      const field = api.record(105);
      word(field + 64, p.Number);
      word(field + 44, Number(p.Slice));
      word(field + 32, p.Kind === "number" ? 2 : 0);
      word(field + 60, Number(p.Codec));
      if (!p.NilColumn && !p.NilParameter) {
        const column = api.record(12);
        pair(column + 44, p.Name);
        word(field + 8, column);
      }
      if (previous) word(previous + 4, field);
      else word(plan + 48, field);
      previous = field;
    }
    let error = "";
    try {
      api.plan(plan);
    } catch (e) {
      if (!(e instanceof Exit) || e.code !== 2) throw e;
      error = get(api.errorp.value, api.errorn.value);
    }
    if (error !== c.Error) {
      failures++;
      if (failures <= 15) {
        console.error(
          JSON.stringify({
            i,
            sql: Buffer.from(c.SQL, "base64").toString(),
            error,
            want: c.Error,
          }),
        );
      }
      continue;
    }
    if (error) continue;
    const parts = [];
    for (let p = load(plan + 56); p; p = load(p + 4)) {
      assert.ok(parts.length < 65536);
      parts.push({
        Text: get(load(p + 8), load(p + 12)),
        Number: load(p + 16),
      });
    }
    const text = get(load(plan + 64), load(plan + 68)),
      dynamic = Boolean(load(plan + 60));
    try {
      assert.deepEqual({ parts, text, dynamic }, {
        parts: c.Parts,
        text: c.Text,
        dynamic: c.Dynamic,
      });
    } catch {
      failures++;
      if (failures <= 15) {
        console.error(
          JSON.stringify({
            i,
            text,
            want: c.Text,
            parts,
            wantParts: c.Parts,
            dynamic,
            wantDynamic: c.Dynamic,
          }),
        );
      }
    }
  }
  assert.equal(failures, 0, `${failures} binding cases failed`);
  console.log(
    `WAT bindings: ${records.length} exact SQL/parts/error checks passed`,
  );
});
