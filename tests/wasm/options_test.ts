import type { Options } from "./fixture_types.ts";
import { Buffer } from "node:buffer";
import {
  command,
  errorMessage,
  type Json,
  type Pair,
  wabt,
} from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT options", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    json_at: (a0: number, a1: number) => number;
    json_eq: (a0: number, a1: number, a2: number) => number;
    json_get: (a0: number, a1: number, a2: number) => number;
    json_kind: (a0: number) => number;
    json_len: (a0: number) => number;
    json_parse: (a0: number, a1: number) => number;
    json_ptr: (a0: number) => number;
    opt_bool: (a0: number, a1: number, a2: number) => number;
    opt_count: (a0: number) => number;
    opt_driver: { value: number };
    opt_driver_name: () => [number, number];
    opt_driver_specifier: () => [number, number];
    opt_factory: { value: number };
    opt_get: (a0: number, a1: number, a2: number) => number;
    opt_mode_native: { value: number };
    opt_mysql_insert_unsigned: { value: number };
    opt_mysql_strings: { value: number };
    opt_mysql_support: { value: number };
    opt_null_undefined: { value: number };
    opt_optional_args: { value: number };
    opt_root: { value: number };
    opt_runtime: { value: number };
    opt_sql_const: { value: number };
    opt_string: (a0: number, a1: number, a2: number) => [number, number];
    opt_types_only: { value: number };
    opt_validate_engine: (a0: number, a1: number) => void;
    options_parse: (a0: number, a1: number) => number;
    text_reset: (a0: number) => void;
  }
  // Compile handwritten WAT and compare against frozen options parser results.
  const directory = await Deno.makeTempDir({ prefix: "sqlc-wat-options-" });
  let wasm;
  try {
    const fragments = await Promise.all(
      ["core", "unicode", "inflection-data", "text", "json", "options"].map(
        (n) =>
          Deno.readTextFile(new URL(`../../src/${n}.wat`, import.meta.url)),
      ),
    );
    const funcs = [
      "text_reset",
      "options_parse",
      "opt_get",
      "opt_string",
      "opt_bool",
      "opt_count",
      "opt_driver_name",
      "opt_driver_specifier",
      "opt_validate_engine",
      "json_parse",
      "json_kind",
      "json_ptr",
      "json_len",
      "json_get",
      "json_at",
      "json_eq",
    ];
    const globals = [
      "opt_root",
      "opt_runtime",
      "opt_driver",
      "opt_mode_native",
      "opt_types_only",
      "opt_null_undefined",
      "opt_optional_args",
      "opt_factory",
      "opt_sql_const",
      "opt_mysql_support",
      "opt_mysql_strings",
      "opt_mysql_insert_unsigned",
    ];
    const source =
      '(module\n(import "test" "error" (func $error (param i32 i32)))\n' +
      fragments.join("\n") + "\n" + funcs.map((n) =>
        `(export "${n}" (func $${n}))`
      ).join("\n") + "\n" + globals.map((n) =>
        `(export "${n}" (global $${n}))`
      ).join("\n") + "\n)";
    await Deno.writeTextFile(join(directory, "test.wat"), source);
    const compile = await command(wabt("wat2wasm"), [
      join(directory, "test.wat"),
      "-o",
      join(directory, "test.wasm"),
    ], { encoding: "utf8" });
    assert.equal(compile.status, 0, compile.stderr);
    wasm = await Deno.readFile(join(directory, "test.wasm"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  let stderr = "";
  const mem = () => new Uint8Array(e.memory.buffer);
  const decode = (p: number, n: number) =>
    decoder.decode(new Uint8Array(e.memory.buffer, p, n));
  const { instance } = await WebAssembly.instantiate(wasm, {
    test: {
      error(p: number, n: number) {
        throw Error(decode(p, n));
      },
    },
    wasi_snapshot_preview1: {
      fd_read() {
        throw Error("unexpected read");
      },
      fd_write(_fd: number, p: number, n: number, out: number) {
        const d = new DataView(e.memory.buffer);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const a = d.getUint32(p + i * 8, true),
            len = d.getUint32(p + i * 8 + 4, true);
          stderr += decode(a, len);
          total += len;
        }
        d.setUint32(out, total, true);
        return 0;
      },
      proc_exit(c: number) {
        throw Error("exit:" + c + ":" + stderr);
      },
    },
  });
  const e = instance.exports as unknown as Exports;
  function parse(s: string) {
    stderr = "";
    e.text_reset(20971520);
    const b = encoder.encode(s);
    mem().set(b, 33554432);
    return e.options_parse(33554432, b.length);
  }
  function key(s: string) {
    const b = encoder.encode(s);
    mem().set(b, 0);
    return [0, b.length] as Pair;
  }
  function str(obj: number, s: string) {
    return decode(...e.opt_string(obj, ...key(s)));
  }
  function opt(obj: number, s: string) {
    return e.opt_get(obj, ...key(s));
  }
  function flags(o: Options) {
    return {
      opt_runtime: { node: 1, bun: 2, deno: 3 }[o.runtime],
      opt_driver: {
        pg: 1,
        postgres: 2,
        mysql2: 3,
        "better-sqlite3": 4,
        "@bonakodo/sqlite": 5,
      }[o._driver_name],
      opt_mode_native: Number(o.sqlite_type_mode === "native"),
      opt_types_only: Number(Boolean(o.types_only)),
      opt_null_undefined: Number(Boolean(o.emit_null_as_undefined)),
      opt_optional_args: Number(
        o.optional_nullable_args ?? o.emit_null_as_undefined ?? false,
      ),
      opt_factory: Number(Boolean(o.emit_query_factory)),
      opt_sql_const: Number(o.emit_sql_as_const ?? true),
      opt_mysql_support: Number(Boolean(o.mysql2?.support_big_numbers)),
      opt_mysql_strings: Number(Boolean(o.mysql2?.big_number_strings)),
      opt_mysql_insert_unsigned: o.mysql2?.insert_id_unsigned == null
        ? -1
        : Number(o.mysql2.insert_id_unsigned),
    };
  }
  const records = JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/options.json", import.meta.url),
    ),
  ).cases;
  let passed = 0;
  const mismatch = [];
  for (const r of records) {
    let root, error;
    try {
      root = parse(r.input);
    } catch (ex) {
      error = errorMessage(ex);
    }
    if (error !== r.error) {
      mismatch.push({
        input: r.input,
        want: r.error ?? "SUCCESS",
        got: error ?? "SUCCESS",
      });
      continue;
    }
    if (!error) {
      try {
        assert.ok(root !== undefined);
        const o = { ...r.options, _driver_name: r.driver_name };
        for (const [name, value] of Object.entries(flags(o))) {
          assert.equal(
            (e[name as keyof Exports] as { value: number }).value,
            value,
            name,
          );
        }
        assert.equal(decode(...e.opt_driver_name()), r.driver_name);
        assert.equal(decode(...e.opt_driver_specifier()), r.driver_specifier);
        assert.equal(str(root, "driver"), o.driver);
        if (o.mysql2?.support_big_numbers) {
          assert.equal(
            e.opt_bool(opt(root, "mysql2"), ...key("support_big_numbers")),
            1,
          );
        }
        passed++;
      } catch (ex) {
        mismatch.push({
          input: r.input,
          want: r.options,
          got: errorMessage(ex),
        });
      }
    } else passed++;
  }
  console.log(
    `${passed}/${records.length} exact oracle checks passed; Wasm ${wasm.length} bytes`,
  );
  for (const v of mismatch.slice(0, 30)) console.log(JSON.stringify(v));
  assert.equal(mismatch.length, 0, "option output/error oracle mismatches");

  // JSON tests exercise token views separately from option semantics.
  {
    const exports = e;
    const p = 33554432;
    const enc = encoder;
    const parse = (s: string | Uint8Array) => {
      const bytes = typeof s === "string" ? enc.encode(s) : s;
      new Uint8Array(exports.memory.buffer, p, bytes.length).set(bytes);
      return exports.json_parse(p, bytes.length);
    };
    const bytes = (i: number) => {
      return decoder.decode(
        new Uint8Array(
          exports.memory.buffer,
          exports.json_ptr(i),
          exports.json_len(i),
        ),
      );
    };
    const word = (i: number, off: number) => {
      return new DataView(exports.memory.buffer).getUint32(
        1048576 + i * 24 + off,
        true,
      );
    };
    const value = (i: number): Json => {
      const k = exports.json_kind(i);
      if (k === 1) {
        const out = {};
        const end = word(i, 12);
        for (let j = i + 1; j < end;) {
          Object.defineProperty(out, bytes(j), {
            value: value(j + 1),
            writable: true,
            enumerable: true,
            configurable: true,
          });
          j = word(j + 1, 12);
        }
        return out;
      }
      if (k === 2) {
        const a = [];
        for (let n = 0; n < word(i, 16); n++) {
          a.push(value(exports.json_at(i, n)));
        }
        return a;
      }
      if (k === 3) return bytes(i);
      if (k === 4) return Number(bytes(i));
      return k === 5 ? true : k === 6 ? false : null;
    };
    const valid = [
      "null",
      "true",
      "false",
      "0",
      "-0",
      "123",
      "-44.25e+3",
      "1E-10",
      "[0, -1, 3.2, 4E2]",
      "{}",
      "[]",
      '{"a":1,"a":2}',
      '{"a":[1,{"b":"日本語\\n\\u0000\\uD83D\\uDE00"},null],"b":false}',
      '"\\"\\\\\\/\\b\\f\\n\\r\\t"',
      '"\\u0000\\u007f\\u0080\\u07ff\\u0800\\uffff\\ud800\\udc00\\udbff\\udfff"',
      ' \r\n\t {"x": [ true , false ] } \t ',
    ];
    for (const s of valid) assert.deepEqual(value(parse(s)), JSON.parse(s), s);
    const invalid = [
      "",
      " ",
      "undefined",
      "NaN",
      "Infinity",
      "+0",
      "00",
      "-01",
      ".1",
      "1.",
      "1e",
      "1e+",
      "1x",
      "truefalse",
      "nul",
      "[1,]",
      "[,1]",
      "[1 2]",
      '{"x":1,}',
      '{"x" 1}',
      "{1:2}",
      '"a\nb"',
      '"\\x41"',
      '"\\u123x"',
      '"\\ud800"',
      '"\\udc00"',
      '"\\ud800\\u0041"',
      '"unterminated',
      "{} []",
      "[",
      "{",
      '"\\',
    ];
    for (
      const s of invalid.filter((s) =>
        !s.includes("ud800") && !s.includes("udc00")
      )
    ) assert.throws(() => parse(s), s);
    for (const s of ['"\\ud800"', '"\\udc00"', '"\\ud800\\u0041"'] as const) {
      assert.equal(value(parse(s)), JSON.parse(s).toWellFormed());
    }
    for (
      const b of [[34, 0xff, 34], [34, 0xc0, 0x80, 34], [
        34,
        0xed,
        0xa0,
        0x80,
        34,
      ], [34, 0xf4, 0x90, 0x80, 0x80, 34]] as const
    ) {
      assert.equal(
        value(parse(Uint8Array.from(b))),
        new TextDecoder().decode(Uint8Array.from(b).slice(1, -1)),
      );
    }
    assert.doesNotThrow(() => parse("[".repeat(128) + "0" + "]".repeat(128)));
    assert.throws(() => parse("[".repeat(129) + "0" + "]".repeat(129)));
    assert.doesNotThrow(() =>
      parse("[" + Array(16383).fill("0").join(",") + "]")
    );
    assert.throws(() => parse("[" + Array(16384).fill("0").join(",") + "]"));
    assert.throws(() => exports.json_parse(1048576, 1));
    assert.throws(() => exports.json_parse(0xfffffff0, 64));
    assert.throws(() => exports.json_parse(67108860, 64));
    const root = parse('{"key":1,"other":[0,{"nested":true}],"key":{"v":3}}');
    new Uint8Array(exports.memory.buffer, 0, 3).set(enc.encode("key"));
    assert.deepEqual(value(exports.json_get(root, 0, 3)), { v: 3 });
    new Uint8Array(exports.memory.buffer, 0, 7).set(enc.encode("missing"));
    assert.equal(exports.json_get(root, 0, 7), -1);
    assert.equal(exports.json_kind(-1), 0);
    assert.equal(exports.json_ptr(-1), 0);
    assert.equal(exports.json_len(-1), 0);
    assert.equal(exports.json_at(-1, 0), -1);
    let state = 0x315765;
    const rnd = (n: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % n;
    };
    const chars = ["a", "日本語", "😀", "\n", "\t", "\\", '"', "\0", "é", "𝄞"];
    const randomValue = (d = 0): Json => {
      const t = rnd(d < 5 ? 7 : 5);
      if (t === 0) return null;
      if (t === 1) return Boolean(rnd(2));
      if (t === 2) return (rnd(100000) - 50000) / 100;
      if (t === 3 || t === 4) {
        let s = "";
        for (let i = rnd(12); i--;) s += chars[rnd(chars.length)];
        return s;
      }
      if (t === 5) {
        const a = [];
        for (let i = rnd(6); i--;) a.push(randomValue(d + 1));
        return a;
      }
      const a: Record<string, Json> = {};
      for (let i = rnd(6); i--;) a["key" + rnd(12)] = randomValue(d + 1);
      return a;
    };
    for (let i = 0; i < 10000; i++) {
      const v = randomValue();
      const json = JSON.stringify(v);
      assert.deepEqual(value(parse(json)), v, json);
    }
    console.log(
      `PASS: ${valid.length} valid cases, ${invalid.length} invalid cases, UTF-8, capacity, depth, lookup, and 10000 random trees; wasm ${wasm.length} bytes`,
    );
    let mutations = 0;
    const seeds = valid.filter((s) => s.length < 200);
    const alphabet = '{}[],:"\\0123456789-.eE+truefalsnul \t\r\nabcdefghij';
    for (let n = 0; n < 50000; n++) {
      let s = seeds[rnd(seeds.length)];
      for (let j = rnd(5) + 1; j--;) {
        const i = rnd(s.length + 1);
        if (rnd(3) === 0) s = s.slice(0, i) + s.slice(i + 1);
        else {s = s.slice(0, i) + alphabet[rnd(alphabet.length)] +
            s.slice(i + Number(rnd(2)));}
      }
      let expected, ok = true;
      try {
        expected = JSON.parse(s);
      } catch {
        ok = false;
      }
      let actual, accepted = true;
      try {
        actual = value(parse(s));
      } catch {
        accepted = false;
      }
      if (accepted !== ok) {
        if (ok && /\\u[dD][89a-fA-F]/.test(s)) continue;
        assert.equal(accepted, ok, s);
      }
      if (ok && accepted && typeof expected === "string") {
        expected = expected.toWellFormed();
      }
      if (ok && accepted) assert.deepEqual(actual, expected, s);
      mutations++;
    }
    console.log(
      "PASS: " + mutations +
        " mutated JSON documents match JSON.parse acceptance and values",
    );
  }

  // A malformed raw byte expands to three bytes. Exhaustion must stop before a
  // write leaves the separate fixed scratch region or returns a partial token.
  {
    const p = 33554432;
    const raw = Buffer.concat([
      Buffer.from('"'),
      Buffer.alloc(218453, 255),
      Buffer.from('"'),
    ]);
    mem().set(raw, p);
    assert.equal(e.json_len(e.json_parse(p, raw.length)), 655359);
    const tooLarge = Buffer.concat([
      raw.subarray(0, -1),
      Buffer.from([255, 34]),
    ]);
    mem().set(tooLarge, p);
    assert.throws(() => e.json_parse(p, tooLarge.length));
  }
});
