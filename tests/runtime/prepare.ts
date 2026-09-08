/** Produce the modules under test through the real WASM generator. */
import { assert, assertEquals } from "@std/assert";
import { Buffer } from "node:buffer";
import { runPlugin } from "../wasm/wasi_test_host.ts";

function varint(value: number): Buffer {
  const bytes: number[] = [];
  do {
    const low = value & 127;
    value = Math.floor(value / 128);
    bytes.push(low | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}

function field(number: number, value: string | Uint8Array): Buffer {
  const bytes = Buffer.from(value);
  return Buffer.concat([varint(number * 8 + 2), varint(bytes.length), bytes]);
}

function integerField(number: number, value: number): Buffer {
  return Buffer.concat([varint(number * 8), varint(value)]);
}

// Runtime unit tests exercise the union of these query needs. Keep the request
// explicit so pruning stays enabled and missing dependencies remain visible.
function request(engine: string, driver: string): Buffer {
  const schema = engine === "sqlite" ? "main" : "public";
  const queries: Buffer[] = [];
  const queryOverrides: Record<string, unknown>[] = [];
  function echo(name: string, type: string, array = false, slice = false) {
    const column = Buffer.concat([
      field(1, "value"),
      integerField(3, 1),
      integerField(7, 1),
      field(12, field(3, type)),
      ...(array ? [integerField(4, 1), integerField(17, 1)] : []),
      ...(slice ? [integerField(13, 1)] : []),
    ]);
    const parameter = engine === "postgresql"
      ? "$1"
      : slice
      ? "/*SLICE:value*/?"
      : "?";
    queries.push(Buffer.concat([
      field(1, `SELECT ${parameter} AS value`),
      field(2, name),
      field(3, ":one"),
      field(4, column),
      field(5, Buffer.concat([integerField(1, 1), field(2, column)])),
      field(7, "query.sql"),
    ]));
  }
  const kinds = engine === "sqlite"
    ? ["INTEGER", "REAL", "BOOLEAN", "DATE", "BLOB", "JSON", "TEXT", "custom"]
    : engine === "postgresql"
    ? [
      "int4",
      "text",
      "bool",
      "timestamptz",
      "bytea",
      "jsonb",
      "point",
      "circle",
      "box",
      "custom",
    ]
    : ["int", "bigint", "text", "bool", "datetime", "blob", "json", "custom"];
  for (const [index, type] of kinds.entries()) {
    echo(`Scalar${index}`, type);
    if (engine === "postgresql") echo(`Array${index}`, type, true);
  }
  if (engine === "sqlite") {
    for (
      const [index, preset] of [
        "safe_integer",
        "epoch_milliseconds",
        "sqlite_boolean",
        "json_text",
      ].entries()
    ) {
      const query = `Preset${index}`;
      echo(query, preset === "json_text" ? "TEXT" : "INTEGER");
      queryOverrides.push(
        { query, column: "value", preset },
        { query, parameter: "value", preset },
      );
    }
  } else {
    for (const array of engine === "postgresql" ? [false, true] : [false]) {
      const query = array ? "CustomArray" : "CustomScalar";
      echo(query, engine === "postgresql" ? "int4" : "int", array);
      const custom = {
        ts_type: "number",
        codec: { path: "../test_codecs.ts", name: "valueCodec" },
      };
      queryOverrides.push(
        { query, column: "value", ...custom },
        { query, parameter: "value", ...custom },
      );
    }
  }
  if (engine !== "postgresql") echo("Slice", "INTEGER", false, true);
  for (
    const command of engine === "postgresql"
      ? [":execresult"]
      : [":execlastid", ":execresult"]
  ) {
    queries.push(Buffer.concat([
      field(1, "INSERT INTO entries DEFAULT VALUES"),
      field(2, command === ":execlastid" ? "InsertID" : "InsertResult"),
      field(3, command),
      field(7, "query.sql"),
    ]));
  }
  return Buffer.concat([
    field(1, field(2, engine)),
    field(2, Buffer.concat([field(2, schema), field(4, field(2, schema))])),
    ...queries.map((query) => field(3, query)),
    field(
      5,
      JSON.stringify({
        driver,
        runtime: "deno",
        ...(engine === "sqlite" ? { sqlite_type_mode: "native" } : {}),
        ...(engine === "mysql"
          ? { mysql2: { support_big_numbers: true, big_number_strings: false } }
          : {}),
        query_overrides: queryOverrides,
      }),
    ),
  ]);
}

// GenerateResponse and File contain only length-delimited fields. Validate all
// lengths and filenames before writing the small, fixed set of support files.
function fields(bytes: Uint8Array): [number, Uint8Array][] {
  let offset = 0;
  function uint(): number {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = bytes[offset++];
      assert(byte !== undefined, "truncated protobuf integer");
      value += (byte & 127) * 2 ** shift;
      assert(value <= 0xffffffff, "overflowing protobuf integer");
      if (!(byte & 128)) return value;
    }
    throw new Error("overflowing protobuf integer");
  }
  const result: [number, Uint8Array][] = [];
  while (offset < bytes.length) {
    const tag = uint();
    assertEquals(tag % 8, 2, "unexpected response wire type");
    const size = uint();
    assert(size <= bytes.length - offset, "truncated response field");
    result.push([Math.floor(tag / 8), bytes.subarray(offset, offset + size)]);
    offset += size;
  }
  return result;
}

const binary = await Deno.readFile(
  new URL("../../bin/sqlc-gen-typescript-native.wasm", import.meta.url),
);
const module = await WebAssembly.compile(binary);
const output = new URL("./.generated/", import.meta.url);
const utf8 = new TextDecoder("utf-8", { fatal: true });

for (
  const [name, engine, driver] of [
    ["sqlite", "sqlite", "@bonakodo/sqlite"],
    ["server", "postgresql", "pg"],
    ["postgres", "postgresql", "postgres"],
    ["mysql", "mysql", "mysql2"],
  ] as const
) {
  const generated = await runPlugin(module, request(engine, driver));
  assertEquals(generated.status, 0, generated.stderr.toString());
  assertEquals(generated.stderr.length, 0);
  const files = new Map<string, Uint8Array>();
  for (const [number, body] of fields(generated.stdout)) {
    assertEquals(number, 1);
    const file = fields(body);
    assertEquals(file.map(([number]) => number), [1, 2]);
    const filename = utf8.decode(file[0]![1]);
    assert(!files.has(filename), `duplicate generated file: ${filename}`);
    files.set(filename, file[1]![1]);
  }
  const directory = new URL(`${name}/`, output);
  await Deno.remove(directory, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(directory, { recursive: true });
  for (
    const filename of [
      "codec_error.ts",
      "json.ts",
      "runtime_common.ts",
      `runtime_${engine}.ts`,
    ]
  ) {
    const contents = files.get(filename);
    assert(contents, `missing generated support file: ${filename}`);
    // A malformed UTF-8 response must not become a silently repaired fixture.
    utf8.decode(contents);
    await Deno.writeFile(new URL(filename, directory), contents);
  }
  console.log(`Prepared ${name} runtime from WASM (${driver})`);
}
