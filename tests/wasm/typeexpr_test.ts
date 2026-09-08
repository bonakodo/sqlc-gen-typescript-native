import { Buffer } from "node:buffer";
import { command, wabt } from "./test_helpers.ts";
import assert from "node:assert/strict";
import { join } from "node:path";

Deno.test("WAT typeexpr", async () => {
  interface Exports {
    memory: WebAssembly.Memory;
    cursor: { value: number };
    error_n: { value: number };
    error_p: { value: number };
    parse: (
      a0: number,
      a1: number,
      a2: number,
      a3: number,
      a4: number,
      a5: number,
    ) => [number, number, number];
  }
  // Compare the typeexpr implementation with the frozen reference corpus.
  const corpusPath = new URL("./fixtures/typeexpr.json", import.meta.url);

  const directory = await Deno.makeTempDir({ prefix: "sqlc-typeexpr-wat-" });
  let module: WebAssembly.Module;
  try {
    const fragments = await Promise.all(
      ["core", "unicode", "inflection-data", "text", "typeexpr"].map((name) =>
        Deno.readTextFile(new URL(`../../src/${name}.wat`, import.meta.url))
      ),
    );
    await Deno.writeTextFile(
      join(directory, "test.wat"),
      `(module\n${
        fragments.join("\n")
      }\n(export "parse" (func $parse_type))(export "error_p" (global $type_error_p))(export "error_n" (global $type_error_n))(export "cursor" (global $txt_cursor)))`,
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

  const instance: WebAssembly.Instance = new WebAssembly.Instance(module, {
    wasi_snapshot_preview1: {
      proc_exit(code: number) {
        throw new Error(`Unexpected exit ${code}`);
      },
      fd_read() {
        throw new Error("Unexpected input");
      },
      fd_write(_fd: number, p: number, _n: number, _out: number) {
        const view = new DataView(
          (instance.exports.memory as WebAssembly.Memory).buffer,
        );
        const address = view.getUint32(p, true),
          length = view.getUint32(p + 4, true);
        throw new Error(
          `Unexpected diagnostic: ${Buffer.from(view.buffer, address, length)}`,
        );
      },
    },
  });
  const api = instance.exports as unknown as Exports;
  const memory = new Uint8Array(api.memory.buffer);
  const text = (p: number, n: number) =>
    Buffer.from(memory.subarray(p, p + n)).toString("utf8");
  const records = JSON.parse(await Deno.readTextFile(corpusPath));
  let failures = 0;
  for (const [i, record] of records.entries()) {
    api.cursor.value = 20971520;
    const source = Buffer.from(record.Source, "base64");
    memory.set(source, 33554432);
    memory.set(Buffer.from(record.Old), 33700000);
    memory.set(Buffer.from(record.New), 33701000);
    const [ok, p, n] = api.parse(
      33554432,
      source.length,
      33700000,
      Buffer.byteLength(record.Old),
      33701000,
      Buffer.byteLength(record.New),
    );
    const got = ok ? text(p, n) : "";
    const error = ok ? "" : text(api.error_p.value, api.error_n.value);
    if (got !== record.Got || error !== record.Error) {
      failures++;
      if (failures <= 20) {
        console.error(
          JSON.stringify({
            i,
            source: source.toString(),
            got,
            want: record.Got,
            error,
            wantError: record.Error,
          }),
        );
      }
    }
  }
  assert.equal(
    failures,
    0,
    `${failures} type-expression differential cases failed`,
  );
  console.log(
    `WAT type expressions: ${records.length} exact output/error checks passed`,
  );
});
