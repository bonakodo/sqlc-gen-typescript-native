import { Buffer } from "node:buffer";
import { command, errorMessage, type Pair, wabt } from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT overrides", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    gen_catalog: { value: number };
    gen_options: { value: number };
    gen_request: { value: number };
    matching_override: (a0: number) => number;
    options_parse: (a0: number, a1: number) => number;
    ov_pattern: (a0: number, a1: number, a2: number, a3: number) => number;
    override_codec_name: (a0: number) => [number, number];
    override_codec_path: (a0: number) => [number, number];
    override_import_name: (a0: number) => [number, number];
    override_import_path: (a0: number) => [number, number];
    override_preset: (a0: number) => [number, number];
    override_type: (a0: number) => [number, number];
    pb_parse: (a0: number, a1: number) => number;
    prepare_overrides: () => void;
    query_override: (a0: number, a1: number, a2: number) => [number, number];
    text_reset: (a0: number) => void;
    work_init: () => void;
  }
  // Handwritten override matchers checked against frozen reference results.
  // Tests assemble WAT and run it with Deno.
  const directory = await Deno.makeTempDir({ prefix: "sqlc-wat-overrides-" });
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
        "overrides",
      ].map((n) =>
        Deno.readTextFile(new URL(`../../src/${n}.wat`, import.meta.url))
      ),
    );
    const funcs = [
      "pb_parse",
      "work_init",
      "prepare_overrides",
      "matching_override",
      "query_override",
      "override_type",
      "override_codec_path",
      "override_codec_name",
      "override_preset",
      "override_import_path",
      "override_import_name",
      "ov_pattern",
      "text_reset",
      "options_parse",
    ];
    const globals = ["gen_request", "gen_catalog", "gen_options"];
    await Deno.writeTextFile(
      join(directory, "test.wat"),
      '(module\n(import "test" "error" (func $error (param i32 i32)))\n' +
        fragments.join("\n") + "\n" + funcs.map((n) =>
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

  let stderr = "";
  const dec = new TextDecoder();
  const enc = new TextEncoder();
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
        throw Error("unexpected read");
      },
      fd_write(_fd: number, p: number, n: number, out: number) {
        const d = new DataView(e.memory.buffer);
        let total = 0;
        for (let i = 0; i < n; i++) {
          const a = d.getUint32(p + i * 8, true),
            len = d.getUint32(p + i * 8 + 4, true);
          stderr += text(a, len);
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
  const mem = new Uint8Array(e.memory.buffer),
    view = new DataView(e.memory.buffer);
  const slot = (r: number, f: number) =>
    r ? view.getUint32(r + 32 + f * 12, true) : 0;
  const fieldtext = (
    r: number,
    f: number,
  ): Pair => [slot(r, f), r ? view.getUint32(r + 36 + f * 12, true) : 0];
  const records = JSON.parse(
    await Deno.readTextFile(
      new URL("./fixtures/overrides.json", import.meta.url),
    ),
  ).cases;
  let passed = 0;
  const failed = [];
  for (const r of records) {
    e.text_reset(20971520);
    stderr = "";
    let err, got;
    try {
      if (r.PatternCase) {
        const p = enc.encode(r.Pattern), v = enc.encode(r.Value);
        mem.set(p, 33554432);
        mem.set(v, 34000000);
        got = Boolean(e.ov_pattern(33554432, p.length, 34000000, v.length));
        assert.equal(got, r.PatternResult, "pattern");
      } else {
        const input = Buffer.from(r.Request, "base64");
        mem.set(input, 33554432);
        const req = e.pb_parse(33554432, input.length);
        e.gen_request.value = req;
        e.gen_catalog.value = slot(req, 2);
        e.gen_options.value = e.options_parse(...fieldtext(req, 5));
        e.work_init();
        e.prepare_overrides();
        const q = slot(req, 3),
          col = r.Parameter ? slot(slot(q, 5), 2) : slot(q, 4);
        const [mapping, nullable] = r.Query
          ? e.query_override(q, col, Number(r.Parameter))
          : [e.matching_override(col), -1];
        got = {
          Found: mapping >= 0,
          Nullable: nullable,
          Type: text(...e.override_type(mapping)),
          CodecPath: text(...e.override_codec_path(mapping)),
          CodecName: text(...e.override_codec_name(mapping)),
          ImportPath: text(...e.override_import_path(mapping)),
          ImportName: text(...e.override_import_name(mapping)),
          Preset: text(...e.override_preset(mapping)),
        };
        for (const [k, v] of Object.entries(got)) assert.equal(v, r[k], k);
      }
    } catch (ex) {
      err = errorMessage(ex);
    }
    if ((err || "") !== r.Error) {
      failed.push({
        pattern: r.PatternCase ? { p: r.Pattern, v: r.Value } : undefined,
        options: r.PatternCase ? undefined : r.Options,
        column: r.Column,
        want: r.Error || r.Type,
        got,
        error: err,
      });
    } else passed++;
  }
  console.log(
    `${passed}/${records.length} override/pattern exact oracle checks passed`,
  );
  for (const f of failed.slice(0, 25)) console.log(JSON.stringify(f));
  assert.equal(failed.length, 0);

  // A second implementation uses JavaScript's Unicode regexp mode. Its class
  // excludes only LF, matching Go's dot behavior rather than JavaScript's dot.
  function goPattern(source: string) {
    let out = "";
    let escaped = false;
    for (const c of Buffer.from(source)) {
      const s = String.fromCodePoint(c);
      if (escaped) {
        out += "\\" + s;
        escaped = false;
      } else if (c === 92) escaped = true;
      else if (c === 42) out += "[^\\n]*";
      else if (c === 63) out += "[^\\n]";
      else out += /[.*+?^${}()|[\]\\]/.test(s) ? "\\" + s : s;
    }
    return new RegExp("^(?:" + out + ")(?![\\s\\S])", "u");
  }
  let seed = 0x57987523;
  const random = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const parts = ["a", "b", "*", "?", "\\*", "\\?", "\\\\", "\n", "😀"];
  const chars = ["a", "b", "*", "?", "\\", "\n", "\r", "\u2028", "😀"];
  for (let i = 0; i < 10000; i++) {
    let p = "", v = "";
    for (let n = random(10); n--;) p += parts[random(parts.length)];
    for (let n = random(12); n--;) v += chars[random(chars.length)];
    const pb = enc.encode(p), vb = enc.encode(v);
    mem.set(pb, 33554432);
    mem.set(vb, 34000000);
    assert.equal(
      Boolean(e.ov_pattern(33554432, pb.length, 34000000, vb.length)),
      goPattern(p).test(v),
      JSON.stringify({ p, v }),
    );
  }
  console.log(
    "Override wildcard matcher: 10000 seeded Unicode/newline differential cases passed",
  );
});
