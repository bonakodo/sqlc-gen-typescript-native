import { Buffer } from "node:buffer";
import { command, errorMessage, type Pair, wabt } from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT embed", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    em_count: { value: number };
    em_qualifier: (a0: number, a1: number) => [number, number];
    em_select: () => number;
    em_targets: { value: number };
    em_tokens: (a0: number, a1: number) => number;
    embed_columns: (a0: number) => number;
    gen_catalog: { value: number };
    gen_engine: { value: number };
    gen_models: { value: number };
    gen_request: { value: number };
    pb_parse: (a0: number, a1: number) => number;
    text_reset: (a0: number) => void;
    txt_cursor: { value: number };
    work_cursor: { value: number };
    work_init: () => void;
    work_record: (a0: number) => number;
  }
  // Frozen reference cases for the narrow SELECT parser and embed nullability.
  const directory = await Deno.makeTempDir({ prefix: "sqlc-wat-embed-" });
  let wasm;
  try {
    const fragments = await Promise.all(
      [
        "core",
        "protocol",
        "unicode",
        "inflection-data",
        "text",
        "json",
        "options",
        "state",
        "bindings",
        "embed",
      ].map((n) =>
        Deno.readTextFile(new URL(`../../src/${n}.wat`, import.meta.url))
      ),
    );
    const funcs = [
      "pb_parse",
      "work_init",
      "work_record",
      "em_tokens",
      "em_select",
      "em_qualifier",
      "embed_columns",
      "text_reset",
    ];
    const globals = [
      "gen_request",
      "gen_catalog",
      "gen_engine",
      "gen_models",
      "work_cursor",
      "txt_cursor",
      "em_count",
      "em_targets",
    ];
    // Small test-only model lookup supplies the same table/schema identities
    // while keeping this parser test independent of model source emission.
    const findModel = `
(func $find_model (param $id i32) (result i32)
 (local $model i32) (local $actual i32) (local $f i32) (local $p i32) (local $n i32) (local $q i32) (local $m i32)
 (local.set $model (global.get $gen_models))
 (block $done (loop $model
  (br_if $done (i32.eqz (local.get $model)))
  (local.set $actual (i32.load offset=8 (local.get $model)))
  (local.set $f (i32.const 1))
  (block $different (loop $field
   (if (i32.gt_u (local.get $f) (i32.const 3)) (then (return (local.get $model))))
   (call $text (local.get $id) (local.get $f)) (local.set $n) (local.set $p)
   (call $text (local.get $actual) (local.get $f)) (local.set $m) (local.set $q)
   (if (i32.eq (local.get $f) (i32.const 2)) (then
    (if (i32.eqz (local.get $n)) (then (call $text (global.get $gen_catalog) (i32.const 2)) (local.set $n) (local.set $p)))
    (if (i32.eqz (local.get $m)) (then (call $text (global.get $gen_catalog) (i32.const 2)) (local.set $m) (local.set $q)))))
   (br_if $different (i32.eqz (call $eq (local.get $p) (local.get $n) (local.get $q) (local.get $m))))
   (local.set $f (i32.add (local.get $f) (i32.const 1))) (br $field)))
  (local.set $model (call $next (local.get $model))) (br $model)))
 (i32.const 0))
`;
    await Deno.writeTextFile(
      join(directory, "test.wat"),
      '(module\n(import "test" "error" (func $error (param i32 i32)))\n' +
        fragments.join("\n") + findModel + "\n" + funcs.map((n) =>
          `(export "${n}" (func $${n}))`
        ).join("\n") + "\n" + globals.map((n) =>
          `(export "${n}" (global $${n}))`
        ).join("\n") + "\n)",
    );
    const result = await command(wabt("wat2wasm"), [
      join(directory, "test.wat"),
      "-o",
      join(directory, "test.wasm"),
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    wasm = await Deno.readFile(join(directory, "test.wasm"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }

  const dec = new TextDecoder(), enc = new TextEncoder();
  const text = (p: number, n: number) =>
    dec.decode(new Uint8Array(e.memory.buffer, p, n));
  const { instance } = await WebAssembly.instantiate(wasm, {
    test: {
      error(p: number, n: number) {
        throw Error(text(p, n));
      },
    },
    wasi_snapshot_preview1: {
      fd_read() {
        throw Error("read");
      },
      fd_write() {
        return 0;
      },
      proc_exit(c: number) {
        throw Error("exit:" + c);
      },
    },
  });
  const e = instance.exports as unknown as Exports;
  const mem = new Uint8Array(e.memory.buffer),
    view = new DataView(e.memory.buffer);
  const word = (p: number, off = 0) => view.getUint32(p + off, true),
    put = (p: number, off: number, v: number) =>
      view.setUint32(p + off, v, true);
  const slot = (r: number, f: number) => r ? word(r, 32 + f * 12) : 0;
  const pair = (
    r: number,
    f: number,
  ): Pair => [slot(r, f), r ? word(r, 36 + f * 12) : 0];
  const rtext = (r: number, off: number) =>
    text(word(r, off), word(r, off + 4));
  const records = JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/embed.json", import.meta.url),
    ),
  ).cases;
  let passed = 0;
  const failed = [];
  for (const [index, c] of records.entries()) {
    try {
      e.text_reset(20971520);
      e.work_cursor.value = 35000000;
      e.gen_engine.value =
        ({ sqlite: 1, postgresql: 2, mysql: 3 } as Record<string, number>)[
          c.Engine
        ] || 1;
      if (!c.Stock) {
        const b = enc.encode(c.SQL);
        mem.set(b, 33554432);
        const tokenOK = Boolean(e.em_tokens(33554432, b.length));
        assert.equal(tokenOK, c.TokenOK, "tokens accepted");
        if (tokenOK) {
          const tokens = [];
          for (let i = 0; i < e.em_count.value; i++) {
            const p = 31719424 + i * 16;
            tokens.push({
              Text: rtext(p, 0),
              Identifier: Boolean(word(p, 8) & 1),
              Quoted: Boolean(word(p, 8) & 2),
            });
          }
          if (c.Tokens) assert.deepEqual(tokens, c.Tokens, "tokens");
          let rel = e.em_select();
          assert.equal(Boolean(rel), c.ParseOK, "parser accepted");
          if (rel) {
            const relations = [];
            while (rel) {
              const table = [];
              for (let i = 0; i < word(rel, 8); i++) {
                table.push(rtext(rel, 16 + i * 8));
              }
              relations.push({
                Table: table,
                Alias: rtext(rel, 40),
                Required: Boolean(word(rel, 12)),
              });
              rel = word(rel, 4);
            }
            assert.deepEqual(relations, c.Relations, "relations");
            const quals = [];
            let t = 1;
            for (let i = 0; i < e.em_targets.value; i++) {
              quals.push(text(...e.em_qualifier(t, 1)));
              t = word(31719424 + t * 16, 12) + 1;
            }
            assert.deepEqual(quals, c.Qualifiers, "qualifiers");
          }
        }
      }
      if (c.Full || c.Stock) {
        e.text_reset(20971520);
        const input = Buffer.from(c.Request, "base64");
        mem.set(input, 33554432);
        const req = e.pb_parse(33554432, input.length);
        e.gen_request.value = req;
        e.gen_catalog.value = slot(req, 2);
        e.gen_engine.value =
          ({ sqlite: 1, postgresql: 2, mysql: 3 } as Record<string, number>)[
            text(...pair(slot(req, 1), 2))
          ];
        e.work_init();
        let schema = slot(e.gen_catalog.value, 4);
        e.gen_models.value = 0;
        let tail = 0;
        while (schema) {
          let table = slot(schema, 3);
          while (table) {
            const model = e.work_record(101);
            put(model, 8, slot(table, 1));
            put(model, 12, slot(table, 2));
            if (tail) put(tail, 4, model);
            else e.gen_models.value = model;
            tail = model;
            table = word(table, 4);
          }
          schema = word(schema, 4);
        }
        let q = slot(req, 3);
        let i = 0;
        const mark = e.work_cursor.value, tm = e.txt_cursor.value;
        while (q) {
          const before = text(...pair(q, 1));
          let col = e.embed_columns(q);
          const got = [];
          while (col) {
            got.push(Boolean(slot(col, 3)));
            col = word(col, 4);
          }
          assert.deepEqual(got, c.Nullability[i], "embed nullability");
          assert.equal(text(...pair(q, 1)), before, "query text changed");
          assert.equal(before, c.QueryText[i]);
          assert.equal(e.work_cursor.value, mark, "record scratch not reset");
          assert.equal(e.txt_cursor.value, tm, "text scratch not reset");
          q = word(q, 4);
          i++;
        }
      }
      passed++;
    } catch (ex) {
      failed.push({
        index,
        sql: c.SQL,
        engine: c.Engine,
        error: errorMessage(ex),
      });
    }
  }
  console.log(`${passed}/${records.length} embed oracle checks passed`);
  for (const x of failed.slice(0, 25)) console.log(JSON.stringify(x));
  assert.equal(failed.length, 0);
});
