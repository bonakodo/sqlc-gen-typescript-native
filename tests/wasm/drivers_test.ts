import { generateAssets } from "../../tools/assets.ts";
import type { DriverField } from "./fixture_types.ts";
import { Buffer } from "node:buffer";
import {
  command,
  legacyOutputHarness,
  type Pair,
  wabt,
} from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT drivers", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    driver: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
      a4: number,
      a5: number,
    ) => void;
    engine: { value: number };
    format: (a0: number, a1: number, a2: number) => [number, number];
    indent: { value: number };
    module: (a0: number, a1: number) => number;
    names: { value: number };
    options: (a0: number, a1: number) => number;
    output: { value: number };
    record: (a0: number) => number;
    reserve: (a0: number, a1: number, a2: number) => void;
    scopes: { value: number };
    text: { value: number };
    work: { value: number };
  }
  // Compare the drivers implementation with the frozen reference corpus.
  const corpusPath = new URL("./fixtures/drivers.json", import.meta.url);
  const directory = await Deno.makeTempDir({ prefix: "sqlc-driver-wat-" });
  let module: WebAssembly.Module;
  try {
    const assets = await generateAssets();
    const names = [
      "unicode",
      "inflection-data",
      "text",
      "protocol",
      "format",
      "json",
      "options",
      "state",
      "paths",
      "output",
      "module",
      "catalog",
      "typeexpr",
      "types-data",
      "types",
      "overrides",
      "bindings",
      "drivers",
    ];
    const fragments = await Promise.all(
      names.map((name) =>
        Deno.readTextFile(new URL(`../../src/${name}.wat`, import.meta.url))
      ),
    );
    const core = await Deno.readTextFile(
      new URL("../../src/core.wat", import.meta.url),
    );
    await Deno.writeTextFile(
      join(directory, "test.wat"),
      `(module\n${core}\n${assets}\n${legacyOutputHarness}\n${
        fragments.join("\n")
      }
    (export "driver" (func $emit_driver_query))(export "options" (func $options_parse))
    (export "record" (func $work_record))(export "module" (func $module_new))(export "reserve" (func $reserve))
    (export "engine" (global $gen_engine))(export "work" (global $work_cursor))(export "text" (global $txt_cursor))
    (export "names" (global $name_cursor))(export "scopes" (global $name_scope_id))
    (export "output" (global $out_cursor))(export "indent" (global $out_indent))
  )`,
    );
    const compile = await command(wabt("wat2wasm"), [
      join(directory, "test.wat"),
      "-o",
      join(directory, "test.wasm"),
    ], { encoding: "utf8" });
    assert.equal(compile.status, 0, compile.stderr);
    module = await WebAssembly.compile(
      await Deno.readFile(join(directory, "test.wasm")),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }

  const instance: WebAssembly.Instance = new WebAssembly.Instance(module, {
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        throw new Error(`Unexpected exit ${code}`);
      },
      fd_read() {
        throw new Error("Unexpected stdin");
      },
      fd_write(_fd: number, p: number, _n: number, _out: number) {
        const view = new DataView(
          (instance.exports.memory as WebAssembly.Memory).buffer,
        );
        throw new Error(
          `Unexpected diagnostic: ${
            Buffer.from(
              view.buffer,
              view.getUint32(p, true),
              view.getUint32(p + 4, true),
            )
          }`,
        );
      },
    },
  });
  const api = instance.exports as unknown as Exports,
    memory = new Uint8Array(api.memory.buffer),
    view = new DataView(api.memory.buffer);
  const set = (p: number, v: number) => view.setUint32(p, v, true),
    get = (p: number) => view.getUint32(p, true);
  let cursor: number;
  const put = (source: string) => {
    const bytes = Buffer.from(source), p = cursor;
    memory.set(bytes, p);
    cursor += bytes.length + 1;
    return [p, bytes.length] as Pair;
  };
  const pair = (p: number, s: string) => {
    const [address, length] = put(s);
    set(p, address);
    set(p + 4, length);
  };
  const string = (p: number, n: number) =>
    Buffer.from(memory.subarray(p, p + n)).toString("utf8");
  const readPair = (p: number) => string(get(p), get(p + 4));
  const kinds: Record<string, number> = {
    integer: 1,
    number: 2,
    boolean: 3,
    date: 4,
    bytes: 5,
    json: 6,
    string: 7,
    unknown: 8,
    buffer: 9,
    point: 10,
    circle: 11,
    interval: 12,
    box: 13,
    "number-or-string": 14,
    "sqlite-integer": 15,
  };
  const commands: Record<string, number> = {
    ":one": 1,
    ":many": 2,
    ":exec": 3,
    ":execrows": 4,
    ":execlastid": 5,
    ":execresult": 6,
  };
  function fields(input: DriverField[]) {
    let head = 0, last = 0;
    for (const field of input) {
      const p = api.record(105);
      if (last) set(last + 4, p);
      else head = p;
      last = p;
      pair(p + 16, field.Name);
      pair(p + 24, field.Type);
      set(p + 32, kinds[field.Kind] || 0);
      set(p + 36, Number(field.Nullable));
      set(p + 40, field.Dims);
      set(p + 44, Number(field.Slice));
      if (field.Codec) {
        pair(p + 48, field.Codec.path);
        pair(p + 56, field.Codec.name);
      }
      set(p + 12, fields(field.Children));
    }
    return head;
  }
  function imports(head: number) {
    const rows = [];
    for (let p = head; p; p = get(p + 4)) {
      rows.push({
        Path: readPair(p + 8),
        Name: readPair(p + 16),
        Alias: readPair(p + 24),
        TypeOnly: Boolean(get(p + 32)),
      });
    }
    return rows.sort((a, b) =>
      a.Path < b.Path
        ? -1
        : a.Path > b.Path
        ? 1
        : a.Name < b.Name
        ? -1
        : a.Name > b.Name
        ? 1
        : 0
    );
  }
  let failures = 0;
  const records = JSON.parse(await Deno.readTextFile(corpusPath));
  for (const [i, c] of records.entries()) {
    cursor = 35000000;
    api.work.value = 40000000;
    api.text.value = 20971520;
    api.names.value = 32768;
    api.scopes.value = 0;
    api.output.value = 50331648;
    api.indent.value = c.Indent;
    const [opts, n] = put(JSON.stringify(c.Options));
    api.options(opts, n);
    api.engine.value =
      ({ sqlite: 1, postgresql: 2, mysql: 3 } as Record<string, number>)[
        c.Engine
      ] || 0;
    const m = api.module(...put(c.Filename));
    set(m + 24, Number(c.Compatible));
    for (const name of c.Names) api.reserve(get(m + 16), ...put(name));
    let previous = 0;
    for (const entry of c.BeforeImports) {
      const p = api.record(104);
      pair(p + 8, entry.Path);
      pair(p + 16, entry.Name);
      pair(p + 24, entry.Alias);
      set(p + 32, Number(entry.TypeOnly));
      if (previous) set(previous + 4, p);
      else set(m + 20, p);
      previous = p;
    }
    const query = api.record(13);
    pair(query + 32 + 2 * 12, c.QueryName);
    pair(query + 32 + 7 * 12, c.QueryFilename);
    const plan = api.record(106);
    set(plan + 8, query);
    set(plan + 12, commands[c.Cmd]);
    pair(plan + 40, c.RowName);
    set(plan + 52, fields(c.Fields));
    api.driver(m, plan, ...put(c.Bindings), ...put(c.SQL));
    const body = string(50331648, api.output.value - 50331648),
      after = imports(get(m + 20));
    try {
      assert.equal(body, c.Body);
      assert.deepEqual(after, c.AfterImports);
      assert.equal(api.indent.value, c.Indent);
    } catch (_error) {
      failures++;
      if (failures <= 10) {
        console.error(
          JSON.stringify({
            i,
            driver: c.Options.driver,
            cmd: c.Cmd,
            body,
            want: c.Body,
            imports: after,
            wantImports: c.AfterImports,
          }),
        );
      }
    }
  }
  assert.equal(failures, 0, `${failures} driver cases failed`);
  console.log(`WAT drivers: ${records.length} exact body/import checks passed`);
});
