import { generateAssets } from "../../tools/assets.ts";
import type {
  Column,
  Enum,
  Identifier,
  Schema,
  Table,
} from "./fixture_types.ts";
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

Deno.test("WAT scopes", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    build_enums: () => void;
    build_models: () => void;
    emit: (a0: number, a1: number) => void;
    emit_enum: (a0: number) => void;
    enum_for_column: (a0: number) => number;
    file_begin: (a0: number, a1: number) => void;
    file_count: { value: number };
    file_end: () => void;
    find_model: (a0: number) => number;
    format: (a0: number, a1: number, a2: number) => [number, number];
    gen_catalog: { value: number };
    gen_engine: { value: number };
    gen_enums: { value: number };
    gen_models: { value: number };
    gen_options: { value: number };
    gen_query_count: { value: number };
    gen_request: { value: number };
    get_text: (a0: number, a1: number) => [number, number];
    line: (a0: number, a1: number) => void;
    module_begin: (a0: number) => void;
    module_end: (a0: number) => void;
    module_import: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
      a4: number,
      a5: number,
    ) => [number, number];
    module_new: (a0: number, a1: number) => number;
    ms_base: { value: number };
    ms_sort: (a0: number, a1: number, a2: number) => void;
    name_cursor: { value: number };
    name_scope_id: { value: number };
    options_parse: (a0: number, a1: number) => number;
    out_cursor: { value: number };
    out_indent: { value: number };
    path_clean: (a0: number, a1: number, a2: number) => [number, number];
    path_dir: (a0: number, a1: number) => [number, number];
    path_relative: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
    ) => [number, number];
    pb_count: { value: number };
    pb_record: (a0: number) => number;
    query_filename: (a0: number, a1: number) => [number, number];
    reserve: (a0: number, a1: number, a2: number) => void;
    response_write: () => void;
    retain_cursor: { value: number };
    retain_text: (a0: number, a1: number) => [number, number];
    set_text: (a0: number, a1: number, a2: number, a3: number) => void;
    slot: (a0: number, a1: number) => number;
    table_key: (a0: number) => [number, number];
    text: (a0: number, a1: number) => [number, number];
    text_copy: (a0: number, a1: number) => [number, number];
    text_mark: () => number;
    text_reset: (a0: number) => void;
    without_ext: (a0: number, a1: number) => [number, number];
    work_cursor: { value: number };
    work_record: (a0: number) => number;
  }
  // Exact path, module, and catalog checks against the prior generator's frozen
  // reference results. Normal tests compile hand-written WAT only.
  const directory = await Deno.makeTempDir({ prefix: "sqlc-wat-scopes-" });
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
      "text_copy",
      "text_mark",
      "retain_text",
      "ms_sort",
      "work_record",
      "options_parse",
      "pb_record",
      "slot",
      "set_text",
      "get_text",
      "text",
      "module_new",
      "module_import",
      "module_begin",
      "module_end",
      "response_write",
      "file_begin",
      "file_end",
      "emit",
      "line",
      "reserve",
      "path_clean",
      "path_dir",
      "without_ext",
      "query_filename",
      "path_relative",
      "build_models",
      "build_enums",
      "find_model",
      "table_key",
      "enum_for_column",
      "emit_enum",
    ];
    const globals = [
      "pb_count",
      "work_cursor",
      "retain_cursor",
      "ms_base",
      "name_cursor",
      "name_scope_id",
      "gen_catalog",
      "gen_query_count",
      "gen_request",
      "gen_options",
      "gen_engine",
      "gen_models",
      "gen_enums",
      "out_cursor",
      "out_indent",
      "file_count",
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
  let stdout: Buffer[] = [];
  let writeChunk = Infinity;
  const { instance } = await WebAssembly.instantiate(wasm, {
    wasi_snapshot_preview1: {
      fd_read() {
        throw Error("unexpected read");
      },
      fd_write(fd: number, p: number, n: number, result: number) {
        const d = new DataView(e.memory.buffer);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const a = d.getUint32(p + i * 8, true),
            len = Math.min(
              d.getUint32(p + i * 8 + 4, true),
              writeChunk - total,
            );
          const bytes = Buffer.from(new Uint8Array(e.memory.buffer, a, len));
          if (fd === 1) stdout.push(bytes);
          else stderr += bytes.toString();
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
  const fixture = JSON.parse(
    await Deno.readTextFile(new URL("./fixtures/scopes.json", import.meta.url)),
  );
  const mismatches: {
    kind: string;
    index: number;
    got: unknown;
    want: unknown;
  }[] = [];
  let checked = 0;
  function check(kind: string, index: number, got: unknown, want: unknown) {
    checked++;
    try {
      assert.deepEqual(got, want);
    } catch {
      mismatches.push({ kind, index, got, want });
    }
  }
  function reset() {
    e.text_reset(20971520);
    e.pb_count.value = 0;
    e.work_cursor.value = 33554432;
    e.retain_cursor.value = 29376512;
    e.name_cursor.value = 32768;
    e.name_scope_id.value = 0;
    e.gen_models.value = 0;
    e.gen_enums.value = 0;
    e.out_cursor.value = 50331648;
    e.out_indent.value = 0;
    e.file_count.value = 0;
    stderr = "";
    stdout = [];
    writeChunk = Infinity;
    inputCursor = 40000000;
  }
  const errorText = (error: unknown) =>
    errorMessage(error).replace(/^error generating output: /, "").replace(
      /\n$/,
      "",
    );
  // Read the public protobuf response, so module checks remain independent of
  // whether the emitter stores a file in one span or several spans.
  function wireFields(bytes: Buffer) {
    let at = 0;
    function uint() {
      let n = 0, shift = 0, b;
      do {
        assert.ok(at < bytes.length && shift < 35);
        b = bytes[at++];
        n += (b & 127) * 2 ** shift;
        shift += 7;
      } while (b & 128);
      return n;
    }
    const fields: [number, Buffer][] = [];
    while (at < bytes.length) {
      const tag = uint();
      assert.equal(tag % 8, 2);
      const length = uint();
      assert.ok(length <= bytes.length - at);
      fields.push([tag >>> 3, bytes.subarray(at, at + length)]);
      at += length;
    }
    return fields;
  }
  function generatedFiles() {
    stdout = [];
    e.response_write();
    return wireFields(Buffer.concat(stdout)).map(([tag, bytes]) => {
      assert.equal(tag, 1);
      const fields = wireFields(bytes);
      assert.deepEqual(fields.map(([n]) => n), [1, 2]);
      return {
        name: fields[0][1].toString(),
        contents: fields[1][1].toString(),
      };
    });
  }

  for (const [i, c] of fixture.paths.entries()) {
    reset();
    const pair = put(c.input),
      got: Record<string, unknown> = { input: c.input };
    for (
      const [key, fn, args] of [
        ["clean", "path_clean", [0]],
        ["windows", "path_clean", [1]],
        ["dir", "path_dir", []],
        ["noext", "without_ext", []],
      ] as const
    ) got[key] = take((e[fn] as (...args: number[]) => Pair)(...pair, ...args));
    try {
      got.filename = take(e.query_filename(...pair));
      got.error = "";
    } catch (error) {
      got.filename = "";
      got.error = errorText(error);
    }
    check("path", i, got, c);
  }
  for (const [i, c] of fixture.relative.entries()) {
    reset();
    check(
      "relative",
      i,
      take(e.path_relative(...put(c.input[0]), ...put(c.input[1]))),
      c.result,
    );
  }
  for (const [i, c] of fixture.modules.entries()) {
    reset();
    const x = c.input, m = e.module_new(...put(x.Filename));
    for (const n of x.Reserved ?? []) {
      e.reserve(memory.readUInt32LE(m + 16), ...put(n));
    }
    // Every import gets fresh temporary strings, immediately overwritten after
    // its call. This also proves path/name/alias retention across query resets.
    const aliases = [];
    for (const im of x.Imports ?? []) {
      const mark = e.text_mark();
      const path = e.text_copy(...put(im.Path));
      const name = e.text_copy(...put(im.Name));
      aliases.push(
        take(e.module_import(m, ...path, ...name, Number(im.TypeOnly))),
      );
      e.text_reset(mark);
      memory.fill(88, mark, mark + 512);
    }
    memory.writeInt32LE(Number(x.Compatible), m + 24);
    e.module_begin(m);
    e.line(...put(x.Body));
    e.module_end(m);
    check("module", i, { aliases, source: generatedFiles()[0].contents }, {
      aliases: c.aliases,
      source: c.source,
    });
  }
  function list<T>(values: T[] | undefined, make: (value: T) => number) {
    let head = 0, tail = 0;
    for (const v of values ?? []) {
      const p = make(v);
      if (tail) memory.writeUInt32LE(p, tail + 4);
      else head = p;
      tail = p;
    }
    return head;
  }
  function link(r: number, f: number, child: number) {
    memory.writeUInt32LE(child, e.slot(r, f));
  }
  function table(v: Table) {
    const r = e.pb_record(10);
    link(r, 1, identifier(v.rel));
    link(r, 2, list(v.columns, column));
    return r;
  }
  function enumRecord(v: Enum) {
    const r = e.pb_record(9);
    e.set_text(r, 32 + 12, ...put(v.name));
    link(
      r,
      2,
      list(v.vals, (s: string) => {
        const p = e.pb_record(0);
        e.set_text(p, 44, ...put(s));
        return p;
      }),
    );
    return r;
  }
  function schema(v: Schema) {
    const r = e.pb_record(7);
    e.set_text(r, 32 + 24, ...put(v.name));
    link(r, 3, list(v.tables, table));
    link(r, 4, list(v.enums, enumRecord));
    return r;
  }
  function walk<T>(head: number, fn: (record: number) => T) {
    const result = [];
    for (let r = head; r; r = memory.readUInt32LE(r + 4)) result.push(fn(r));
    return result;
  }
  for (const [i, c] of fixture.catalogs.entries()) {
    reset();
    const x = c.input;
    let got: Record<string, unknown> = {};
    try {
      e.gen_engine.value =
        ({ sqlite: 1, postgresql: 2, mysql: 3 } as Record<string, number>)[
          x.Engine
        ];
      const json = Buffer.from(JSON.stringify(x.Options));
      memory.set(json, 35000000);
      e.gen_options.value = e.options_parse(35000000, json.length);
      e.gen_query_count.value = x.Queries;
      const cat = e.pb_record(6);
      e.gen_catalog.value = cat;
      e.set_text(cat, 56, ...put(x.Catalog.default_schema));
      link(cat, 4, list(x.Catalog.schemas, schema));
      e.build_models();
      e.build_enums();
      got.models = walk(
        e.gen_models.value,
        (m) => ({
          name: take(e.get_text(m, 16)),
          key: take(e.get_text(m, 24)),
          columns: walk(
            memory.readUInt32LE(m + 12),
            (col) => take(e.text(col, 1)),
          ),
        }),
      );
      got.enums = walk(e.gen_enums.value, (v: number) => ({
        schema: take(e.get_text(v, 8)),
        sql: take(e.get_text(v, 16)),
        name: take(e.get_text(v, 24)),
        valuesName: take(e.get_text(v, 32)),
        values: walk(
          memory.readUInt32LE(v + 40),
          (p: number) => take(e.text(p, 1)),
        ),
      }));
      const mod = e.module_new(...put("enums.ts"));
      e.module_begin(mod);
      walk(e.gen_enums.value, (v: number) => e.emit_enum(v));
      e.module_end(mod);
      got.source = generatedFiles()[0].contents;
      got.tables = (x.Tables ?? []).map((v: Identifier) => {
        const id = identifier(v), model = e.find_model(id);
        return {
          key: take(e.table_key(id)),
          name: model ? take(e.get_text(model, 16)) : "",
        };
      });
      got.types = (x.Types ?? []).map((v: Identifier) => {
        const col = e.pb_record(12);
        link(col, 12, identifier(v));
        const en = e.enum_for_column(col);
        return en ? take(e.get_text(en, 24)) : "";
      });
    } catch (error) {
      got = { error: errorText(error) };
    }
    const want = { ...c };
    delete want.input;
    check("catalog", i, got, want);
  }
  // The model pass sorts existing record payloads before any model reference
  // escapes. Compare complete original-index permutations, not just sorted keys:
  // duplicate keys must follow the reference sort's exact swap decisions.
  const sortCases = JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/model-sort.json", import.meta.url),
    ),
  );
  for (const [i, c] of sortCases.entries()) {
    reset();
    const base = e.work_cursor.value;
    e.ms_base.value = base;
    for (const [index, key] of c.keys.entries()) {
      const r = e.work_record(101);
      memory.writeUInt32LE(index, r + 8);
      e.set_text(r, 24, ...put(key));
    }
    e.ms_sort(
      0,
      c.keys.length,
      c.keys.length === 0 ? 0 : 32 - Math.clz32(c.keys.length),
    );
    check(
      "sort",
      i,
      c.keys.map((_: string, index: number) =>
        memory.readUInt32LE(base + index * 256 + 8)
      ),
      c.order,
    );
  }
  console.log(
    `scopes: ${
      checked - mismatches.length
    }/${checked} exact reference cases passed`,
  );
  const failuresPath = Deno.env.get("SCOPES_FAILURES");
  if (failuresPath) {
    await Deno.writeTextFile(failuresPath, JSON.stringify(mismatches));
  }
  for (
    const kind of ["path", "relative", "module", "catalog", "sort"] as const
  ) {
    for (
      const m of mismatches.filter((m) => m.kind === kind).slice(0, 2)
    ) console.log(JSON.stringify(m));
  }
  assert.equal(mismatches.length, 0, "path/module/catalog mismatch");

  // Finish modules through their public response, including bodies with no last
  // LF, only LFs, CRLF, NUL, and a large body. Finalization must keep the emitted
  // non-LF body bytes at their original address while adding imports afterward.
  const header = "// Code generated by sqlc. DO NOT EDIT.\n\n";
  const importLine =
    'import type { Codec as _sqlcImportCodec } from "pkg";\n\n';
  for (
    const body of [
      "",
      "\n\n",
      "x",
      "x\n\n",
      "x\r\n\n",
      "日本語\0",
      "abcdefg\n".repeat(65536),
    ] as const
  ) {
    for (const imports of [false, true] as const) {
      reset();
      const m = e.module_new(...put("q.ts"));
      e.module_begin(m);
      const start = e.out_cursor.value;
      e.emit(...put(body));
      if (imports) e.module_import(m, ...put("pkg"), ...put("Codec"), 1);
      e.module_end(m);
      const kept = Buffer.from(body.replace(/\n+$/, ""));
      assert.deepEqual(
        memory.subarray(start, start + kept.length),
        kept,
        "module_end moved body bytes",
      );
      assert.deepEqual(generatedFiles(), [{
        name: "q.ts",
        contents:
          (header + (imports ? importLine : "") + body).replace(/\n+$/, "") +
          "\n",
      }]);
    }
  }

  // Mix modules and ordinary files in reverse name order, with equal names and
  // distinct contents. Sort must retain both spans with each file, preserve equal
  // keys, and stop at the exact table capacity. Short writes cross every span.
  reset();
  const tableBase = 32768000, tableEnd = tableBase + 1024 * 32;
  memory.fill(0xa5, tableBase - 32, tableBase);
  memory.fill(0xb6, tableEnd, tableEnd + 32);
  const wanted = [];
  for (let i = 0; i < 1024; i++) {
    const name = `${String(Math.floor((1023 - i) / 2)).padStart(4, "0")}.ts`;
    const body = i % 5 === 0 ? "" : `value ${i}\n\n`;
    if (i % 2) {
      const m = e.module_new(...put(name));
      e.module_begin(m);
      e.emit(...put(body));
      e.module_import(m, ...put("pkg"), ...put("Codec"), 1);
      e.module_end(m);
      wanted.push({
        name,
        contents: (header + importLine + body).replace(/\n+$/, "") + "\n",
      });
    } else {
      e.file_begin(...put(name));
      e.emit(...put(body));
      e.file_end();
      wanted.push({ name, contents: body });
    }
  }
  wanted.sort((a, b) =>
    Buffer.compare(Buffer.from(a.name), Buffer.from(b.name))
  );
  writeChunk = 3;
  assert.deepEqual(generatedFiles(), wanted);
  assert.ok(
    memory.subarray(tableBase - 32, tableBase).every((b) => b === 0xa5),
  );
  assert.ok(memory.subarray(tableEnd, tableEnd + 32).every((b) => b === 0xb6));
  stdout = [];
  e.file_begin(...put("overflow.ts"));
  assert.throws(() => e.file_end(), /request exceeds fixed memory capacity/);
  assert.equal(stdout.length, 0);
  assert.equal(e.file_count.value, 1024);
  assert.ok(memory.subarray(tableEnd, tableEnd + 32).every((b) => b === 0xb6));

  // Finalize a module exactly at the output limit; one additional content byte
  // must fail without sending a partial response or trapping on a memory access.
  for (const extra of [0, 1] as const) {
    reset();
    e.out_cursor.value = memory.length - Buffer.byteLength(header) - 2;
    const m = e.module_new(...put("last.ts"));
    e.module_begin(m);
    e.emit(...put("x".repeat(1 + extra) + "\n"));
    if (extra) {
      assert.throws(
        () => e.module_end(m),
        /request exceeds fixed memory capacity/,
      );
      assert.equal(stdout.length, 0);
    } else {
      e.module_end(m);
      assert.equal(e.out_cursor.value, memory.length);
      assert.deepEqual(generatedFiles(), [{
        name: "last.ts",
        contents: header + "x\n",
      }]);
    }
  }
  console.log(
    "PASS module span lifetimes, newline rules, stable file sorting, short writes, and exact file/output capacities",
  );
});
