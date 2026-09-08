import assert from "node:assert/strict";
import { inspect } from "node:util";
import { Database } from "@bonakodo/sqlite";
import {
  type CodecContext,
  createJsonTextCodec,
  decodeCustom,
  decodeValue,
  encodeCustom,
  encodeSlice,
  encodeValue,
  epochMilliseconds,
  jsonText,
  QueryCodecError,
  safeInteger,
  sqliteBoolean,
} from "./.generated/sqlite/runtime.ts";
import * as server from "./.generated/server/runtime.ts";

const context: CodecContext = {
  query: "FindAuthors",
  file: "queries/authors.sql",
  field: "createdAt",
  expectedType: "Date",
};

Deno.test("codec type arguments reject mismatched application types", () => {
  const invalidCalls = () => {
    // @ts-expect-error A number codec cannot produce the configured string type.
    encodeCustom<string>(safeInteger, "value", false);
    server.encodeArrayCustom<string>(
      // @ts-expect-error Native array codecs convert declared scalar elements.
      safeInteger,
      "number",
      ["value"],
      1,
      false,
    );
    server.decodeArrayCustom<string[], string>(
      // @ts-expect-error A decoded array must use the configured scalar codec type.
      safeInteger,
      "number",
      [1],
      1,
      false,
      false,
    );
  };
  assert.equal(typeof invalidCalls, "function");
});

function codecError(
  operation: () => unknown,
  phase: "encode" | "decode",
  errorType: typeof QueryCodecError | typeof server.QueryCodecError =
    QueryCodecError,
) {
  let error: unknown;
  try {
    operation();
  } catch (cause) {
    error = cause;
  }
  assert(error instanceof errorType);
  assert(error instanceof TypeError);
  assert.equal(error.query, context.query);
  assert.equal(error.file, context.file);
  assert.equal(error.field, context.field);
  assert.equal(error.expectedType, context.expectedType);
  assert.equal(error.phase, phase);
  assert.match(error.message, /FindAuthors/);
  assert.match(error.message, /createdAt/);
  return error;
}

Deno.test("safe integer codec rejects rounded and out-of-range values", () => {
  for (
    const value of [
      0,
      -1,
      2 ** 32,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ]
  ) {
    assert.equal(safeInteger.encode(value), BigInt(value));
    assert.equal(safeInteger.decode(BigInt(value)), value);
    assert.equal(safeInteger.decode(value), value);
  }
  for (const value of [NaN, Infinity, 0.5, 2 ** 53, -(2 ** 53)]) {
    assert.throws(() => safeInteger.encode(value));
    assert.throws(() => safeInteger.decode(value));
  }
  for (const value of [1n << 53n, -(1n << 53n), 1n << 63n, "123"]) {
    assert.throws(() => safeInteger.decode(value));
  }
});

Deno.test("epoch milliseconds retain Date precision and validate Date's bounds", () => {
  for (const time of [0, -1, 1_788_688_139_074, 8_640_000_000_000_000]) {
    assert.equal(epochMilliseconds.encode(new Date(time)), BigInt(time));
    assert.equal(epochMilliseconds.decode(BigInt(time)).getTime(), time);
  }
  assert.throws(() => epochMilliseconds.encode(new Date(NaN)));
  assert.throws(() => epochMilliseconds.decode(8_640_000_000_000_001n));
  assert.throws(() => epochMilliseconds.decode("2026-09-08"));
});

Deno.test("SQLite boolean codec accepts only the two stored boolean values", () => {
  assert.equal(sqliteBoolean.encode(true), 1);
  assert.equal(sqliteBoolean.encode(false), 0);
  for (const value of [0, 0n]) assert.equal(sqliteBoolean.decode(value), false);
  for (const value of [1, 1n]) assert.equal(sqliteBoolean.decode(value), true);
  for (const value of [-1, 2, 0.5, "true", "1", null]) {
    assert.throws(() => sqliteBoolean.decode(value));
  }
});

Deno.test("JSON text preserves parsed JSON and distinguishes JSON null from SQL NULL", () => {
  const value = { text: "日本語", nested: [null, true, { count: 4 }] };
  assert.deepEqual(jsonText.decode(jsonText.encode(value)), value);
  assert.equal(encodeCustom(jsonText, null, false), "null");
  assert.equal(encodeCustom(jsonText, null, true), null);
  assert.equal(encodeCustom(jsonText, undefined, true), null);
  assert.equal(decodeCustom(jsonText, "null", false, true), null);
  assert.equal(decodeCustom(jsonText, null, true, true), undefined);
  assert.throws(() => encodeCustom(jsonText, undefined, false));
  assert.throws(() => decodeCustom(jsonText, null, false, false));
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  for (
    const invalid of [undefined, NaN, Infinity, 1n, new Date(), [undefined], {
      absent: undefined,
    }, cyclic]
  ) {
    assert.throws(() => jsonText.encode(invalid));
  }
  assert.throws(() => jsonText.decode("1e400"));
  assert.throws(() => jsonText.decode(new Uint8Array()));
});

Deno.test("JSON parser codecs validate application values on writes and reads", () => {
  const codec = createJsonTextCodec((value) => {
    if (
      typeof value !== "object" || value === null || !("name" in value) ||
      typeof value.name !== "string"
    ) {
      throw new Error("Application parser rejected a document");
    }
    return { name: value.name };
  });
  assert.equal(codec.encode({ name: "Test" }), '{"name":"Test"}');
  assert.deepEqual(codec.decode('{"name":"Test"}'), { name: "Test" });
  assert.throws(() => codec.decode('{"name":12}'));
  codecError(() => encodeCustom(codec, { name: 12 }, false, context), "encode");
  codecError(
    () => decodeCustom(codec, '{"name":12}', false, false, context),
    "decode",
  );
});

Deno.test("SQLite conversion errors attach source metadata without exposing values", () => {
  const secret = "medical-fixture-do-not-log";
  codecError(() => encodeValue("date", secret, false, context), "encode");
  codecError(() => encodeValue("date", null, false, context), "encode");
  codecError(
    () => decodeValue("integer", secret, false, false, context),
    "decode",
  );
  const error = codecError(
    () => decodeCustom(epochMilliseconds, secret, false, false, context),
    "decode",
  );
  for (
    const text of [
      error.message,
      error.stack,
      JSON.stringify(error),
      inspect(error),
      Deno.inspect(error),
    ]
  ) {
    assert(!text?.includes(secret));
  }
  const jsonError = codecError(
    () => decodeCustom(jsonText, `{"${secret}":}`, false, false, context),
    "decode",
  );
  assert(!inspect(jsonError.originalCause()).includes(secret));
});

Deno.test("custom codec causes remain available only through explicit access", () => {
  const secret = "medical-fixture-do-not-log";
  const cause = new Error(secret, { cause: { body: secret } });
  const codec = {
    encode() {
      throw cause;
    },
    decode() {
      throw cause;
    },
  };
  for (
    const runtime of [{ encodeCustom, decodeCustom, QueryCodecError }, server]
  ) {
    const encodeError = codecError(
      () => runtime.encodeCustom(codec, secret, false, context),
      "encode",
      runtime.QueryCodecError,
    );
    const decodeError = codecError(
      () => runtime.decodeCustom(codec, secret, false, false, context),
      "decode",
      runtime.QueryCodecError,
    );
    for (const error of [encodeError, decodeError]) {
      assert.equal(error.originalCause(), cause);
      assert(error.cause instanceof Error);
      assert(!inspect(error).includes(secret));
      assert(!Deno.inspect(error).includes(secret));
      assert(!JSON.stringify(error).includes(secret));
    }
  }
});

Deno.test("server scalar and array conversions carry the same safe context", () => {
  codecError(
    () => server.encodeValue("date", "bad", false, context),
    "encode",
    server.QueryCodecError,
  );
  codecError(
    () => server.decodeValue("number", "bad", false, false, context),
    "decode",
    server.QueryCodecError,
  );
  codecError(
    () => server.encodeArray("number", ["bad"], 1, false, context),
    "encode",
    server.QueryCodecError,
  );
  codecError(
    () => server.encodeArray("number", null, 1, false, context),
    "encode",
    server.QueryCodecError,
  );
  codecError(
    () => server.decodeArray("number", ["bad"], 1, false, false, context),
    "decode",
    server.QueryCodecError,
  );
  const codec = {
    encode() {
      throw new Error("bad");
    },
    decode() {
      throw new Error("bad");
    },
  };
  codecError(
    () => server.encodeArrayCustom(codec, "number", [4], 1, false, context),
    "encode",
    server.QueryCodecError,
  );
  codecError(
    () =>
      server.decodeArrayCustom(codec, "number", [4], 1, false, false, context),
    "decode",
    server.QueryCodecError,
  );
});

Deno.test("SQL slices validate their outer array and preserve element context", () => {
  codecError(
    () =>
      encodeSlice(
        null,
        (value) => encodeCustom(safeInteger, value, false),
        context,
      ),
    "encode",
  );
  assert.deepEqual(encodeSlice([], (value) => value, context), []);
  const original = new Error("medical-fixture-do-not-log");
  const codec = {
    encode() {
      throw original;
    },
    decode() {
      throw original;
    },
  };
  const error = codecError(
    () =>
      encodeSlice(
        [1],
        (value) => encodeCustom(codec, value, false, context),
        context,
      ),
    "encode",
  );
  assert.equal(error.originalCause(), original);
  assert(!inspect(error).includes(original.message));
});

Deno.test("built-in codecs roundtrip their intended SQLite storage classes", () => {
  using db = new Database(":memory:");
  db.exec(
    "CREATE TABLE records (counter INTEGER, happened_at INTEGER, enabled INTEGER, payload TEXT)",
  );
  using insert = db.prepare("INSERT INTO records VALUES (?, ?, ?, ?)");
  const now = new Date("2026-09-08T01:02:03.456Z");
  insert.run([
    encodeCustom(safeInteger, 2 ** 40, false, context),
    encodeCustom(epochMilliseconds, now, false, context),
    encodeCustom(sqliteBoolean, true, false, context),
    encodeCustom(jsonText, { valid: true }, false, context),
  ]);
  using select = db.prepare(
    "SELECT counter, happened_at, enabled, payload FROM records",
  ).safeIntegers();
  const row = select.raw().get();
  assert(
    row && row[0] !== undefined && row[1] !== undefined &&
      row[2] !== undefined && row[3] !== undefined,
  );
  assert.equal(
    decodeCustom(safeInteger, row[0], false, false, context),
    2 ** 40,
  );
  assert.equal(
    decodeCustom(epochMilliseconds, row[1], false, false, context).getTime(),
    now.getTime(),
  );
  assert.equal(
    decodeCustom(sqliteBoolean, row[2], false, false, context),
    true,
  );
  assert.deepEqual(decodeCustom(jsonText, row[3], false, false, context), {
    valid: true,
  });
  using storage = db.prepare(
    "SELECT typeof(counter), typeof(happened_at), typeof(enabled), typeof(payload) FROM records",
  );
  assert.deepEqual(storage.raw().get(), [
    "integer",
    "integer",
    "integer",
    "text",
  ]);
});
