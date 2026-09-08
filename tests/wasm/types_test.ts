import { generateAssets } from "../../tools/assets.ts";
import type { Column, Identifier } from "./fixture_types.ts";
import { Buffer } from "node:buffer";
import {
  command,
  errorMessage,
  legacyOutputHarness,
  type Pair,
  wabt,
} from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT types", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    argument_type_text: (a0: number) => [number, number];
    decode_context: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
      a4: number,
      a5: number,
    ) => [number, number];
    emit_interface: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
      a4: number,
    ) => void;
    encode_context: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
      a4: number,
      a5: number,
    ) => [number, number];
    field_name: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
    ) => [number, number];
    format: (a0: number, a1: number, a2: number) => [number, number];
    gen_catalog: { value: number };
    gen_engine: { value: number };
    gen_enums: { value: number };
    gen_models: { value: number };
    gen_options: { value: number };
    gen_request: { value: number };
    get_text: (a0: number, a1: number) => [number, number];
    kind_text: (a0: number) => [number, number];
    module_new: (a0: number, a1: number) => number;
    name_cursor: { value: number };
    name_scope_id: { value: number };
    options_parse: (a0: number, a1: number) => number;
    out_cursor: { value: number };
    out_indent: { value: number };
    pb_count: { value: number };
    pb_record: (a0: number) => number;
    prepare_overrides: () => void;
    resolve_query_type: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
      a4: number,
    ) => number;
    resolve_type: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
      a4: number,
    ) => number;
    set_text: (a0: number, a1: number, a2: number, a3: number) => void;
    slot: (a0: number, a1: number) => number;
    text: (a0: number, a1: number) => [number, number];
    text_reset: (a0: number) => void;
    type_text: (a0: number) => [number, number];
    work_cursor: { value: number };
  }
  // Exact type/conversion checks against the prior generator's frozen
  // reference results. Normal tests compile hand-written WAT only.
  const directory = await Deno.makeTempDir({ prefix: "sqlc-wat-types-" });
  let wasm;
  try {
    const assets = await generateAssets();
    const names = [
      "core",
      "unicode",
      "inflection-data",
      "text",
      "protocol",
      "json",
      "options",
      "state",
      "format",
      "output",
      "paths",
      "module",
      "catalog",
      "typeexpr",
      "overrides",
      "types-data",
      "types",
    ];
    const fragments = await Promise.all(
      names.map((n) =>
        Deno.readTextFile(new URL(`../../src/${n}.wat`, import.meta.url))
      ),
    );
    const funcs = [
      "text_reset",
      "options_parse",
      "prepare_overrides",
      "pb_record",
      "slot",
      "set_text",
      "module_new",
      "resolve_type",
      "resolve_query_type",
      "type_text",
      "argument_type_text",
      "encode_context",
      "decode_context",
      "kind_text",
      "get_text",
      "field_name",
      "emit_interface",
    ];
    const globals = [
      "pb_count",
      "work_cursor",
      "name_cursor",
      "name_scope_id",
      "gen_catalog",
      "gen_request",
      "gen_options",
      "gen_engine",
      "gen_models",
      "gen_enums",
      "out_cursor",
      "out_indent",
    ];
    const source = "(module\n" + fragments.join("\n") + legacyOutputHarness +
      "\n" +
      assets + "\n" +
      funcs.map((n) => `(export "${n}" (func $${n}))`).join("\n") + "\n" +
      globals.map((n) => `(export "${n}" (global $${n}))`).join("\n") + "\n)";
    await Deno.writeTextFile(join(directory, "types.wat"), source);
    const compile = await command(wabt("wat2wasm"), [
      join(directory, "types.wat"),
      "-o",
      join(directory, "types.wasm"),
    ], { encoding: "utf8" });
    assert.equal(compile.status, 0, compile.stderr);
    wasm = await Deno.readFile(join(directory, "types.wasm"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }

  let stderr = "";
  const { instance } = await WebAssembly.instantiate(wasm, {
    wasi_snapshot_preview1: {
      fd_read() {
        throw Error("unexpected read");
      },
      fd_write(_fd: number, p: number, n: number, result: number) {
        const d = new DataView(e.memory.buffer);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const a = d.getUint32(p + i * 8, true),
            len = d.getUint32(p + i * 8 + 4, true);
          stderr += Buffer.from(e.memory.buffer, a, len).toString();
          total += len;
        }
        d.setUint32(result, total, true);
        return 0;
      },
      proc_exit() {
        throw Error(stderr);
      },
    },
  });
  const e = instance.exports as unknown as Exports;
  const memory = Buffer.from(e.memory.buffer);
  let inputCursor: number;
  const put = (s: string) => {
    const b = Buffer.from(s ?? "");
    const p = inputCursor;
    memory.set(b, p);
    inputCursor += b.length + 1;
    return [p, b.length] as Pair;
  };
  const take = ([p, n]: Pair) => memory.subarray(p, p + n).toString();
  function identifier(v?: Identifier) {
    if (!v) return 0;
    const p = e.pb_record(11);
    for (
      const [k, f] of [["catalog", 1], ["schema", 2], ["name", 3]] as const
    ) if (v[k] !== undefined) e.set_text(p, 32 + f * 12, ...put(v[k] ?? ""));
    return p;
  }
  function column(v?: Column) {
    if (!v) return 0;
    const p = e.pb_record(12);
    for (
      const [k, f] of [["name", 1], ["comment", 5], ["scope", 9], [
        "table_alias",
        11,
      ], ["original_name", 15]] as const
    ) if (v[k] !== undefined) e.set_text(p, 32 + f * 12, ...put(v[k] ?? ""));
    for (
      const [k, f] of [
        ["not_null", 3],
        ["is_array", 4],
        ["length", 6],
        ["is_named_param", 7],
        ["is_func_call", 8],
        ["is_sqlc_slice", 13],
        ["unsigned", 16],
        ["array_dims", 17],
      ] as const
    ) memory.writeInt32LE(Number(v[k] ?? 0), e.slot(p, f));
    for (
      const [k, f] of [["table", 10], ["type", 12], [
        "embed_table",
        14,
      ]] as const
    ) memory.writeInt32LE(identifier(v[k]), e.slot(p, f));
    return p;
  }
  const cases = JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/types.json", import.meta.url),
    ),
  ).cases;
  const mismatches = [];
  for (const [i, want] of cases.entries()) {
    e.text_reset(20971520);
    e.pb_count.value = 0;
    e.work_cursor.value = 33554432;
    e.name_cursor.value = 32768;
    e.name_scope_id.value = 0;
    e.gen_models.value = 0;
    e.gen_enums.value = 0;
    e.out_cursor.value = 50331648;
    e.out_indent.value = 0;
    stderr = "";
    inputCursor = 40000000;
    const input = want.input;
    let got: Record<string, unknown> = {};
    try {
      e.gen_engine.value =
        ({ sqlite: 1, postgresql: 2, mysql: 3 } as Record<string, number>)[
          input.Engine
        ];
      const json = Buffer.from(JSON.stringify(input.Options));
      memory.set(json, 35000000);
      e.gen_options.value = e.options_parse(35000000, json.length);
      e.gen_catalog.value = e.pb_record(6);
      e.set_text(e.gen_catalog.value, 32 + 2 * 12, ...put("public"));
      const col = column(input.Column);
      let query = 0;
      if (input.Query) {
        query = e.pb_record(13);
        e.set_text(query, 32 + 2 * 12, ...put("MyQuery"));
        memory.writeUInt32LE(col, e.slot(query, 4));
      }
      e.gen_request.value = e.pb_record(15);
      memory.writeUInt32LE(query, e.slot(e.gen_request.value, 3));
      e.prepare_overrides();
      const mod = e.module_new(...put("nested/queries.ts"));
      const field = e.resolve_query_type(
        mod,
        query,
        col,
        Number(input.Force),
        0,
      );
      got.kind = take(e.kind_text(memory.readInt32LE(field + 32)));
      got.base = take(e.get_text(field, 24));
      got.type = take(e.type_text(field));
      got.argument = take(e.argument_type_text(field));
      const expression = put("args.value"),
        row = put("row[0]"),
        context = put("context");
      got.encode = take(e.encode_context(mod, field, ...expression, 0, 0));
      got.encode_context = take(
        e.encode_context(mod, field, ...expression, ...context),
      );
      got.decode = take(e.decode_context(mod, field, ...row, 0, 0));
      got.decode_context = take(
        e.decode_context(mod, field, ...row, ...context),
      );
      const name = input.Column?.name ?? "";
      e.set_text(field, 16, ...e.field_name(...put(name), ...put("col1")));
      e.emit_interface(mod, ...put("Result"), field, 0);
      got.interface = memory.subarray(50331648, e.out_cursor.value).toString();
    } catch (error) {
      got = {
        error: errorMessage(error).replace(/^error generating output: /, "")
          .replace(/\n$/, ""),
      };
    }
    const expected = { ...want };
    delete expected.input;
    try {
      assert.deepEqual(got, expected);
    } catch {
      mismatches.push({ index: i, input, want: expected, got });
    }
  }
  console.log(
    `types: ${
      cases.length - mismatches.length
    }/${cases.length} exact reference cases passed`,
  );
  for (const mismatch of mismatches.slice(0, 20)) {
    console.log(JSON.stringify(mismatch));
  }
  assert.equal(mismatches.length, 0, "SQL type/conversion mismatch");
});
