import { Database } from "@bonakodo/sqlite";
import {
  decodeCustom,
  decodeValue,
  encodeCustom,
  encodeValue,
  lastInsertId,
  type SqliteCodec,
} from "./.generated/sqlite/runtime.ts";

/** assertEqual compares scalar values without coercion. */
function assertEqual(actual: unknown, expected: unknown): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

/** assertThrows requires a synchronous operation to reject an invalid value. */
function assertThrows(operation: () => unknown): void {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error("Expected an error");
}

Deno.test("integer conversion preserves signed 64-bit values and rejects rounding", () => {
  for (const value of [0n, 1n, -(1n << 63n), (1n << 63n) - 1n]) {
    assertEqual(encodeValue("integer", value), value);
    assertEqual(decodeValue("integer", value, false, false), value);
  }
  assertEqual(decodeValue("integer", 42, false, false), 42n);
  for (
    const value of [
      1n << 63n,
      -(1n << 63n) - 1n,
      2 ** 53,
      1.1,
      NaN,
      Infinity,
      "1",
      true,
    ]
  ) {
    assertThrows(() => encodeValue("integer", value));
  }
  assertThrows(() => encodeValue("unknown", 2 ** 53));
  assertEqual(decodeValue("number", 7n, false, false), 7);
  assertEqual(encodeValue("number", 0.25), 0.25);
});

Deno.test("REAL conversion preserves large, fractional, and subnormal numbers", () => {
  const database = new Database(":memory:");
  const statement = database.prepare("SELECT CAST(? AS REAL)");
  try {
    statement.safeIntegers();
    for (
      const value of [
        2 ** 53,
        1e20,
        -1e20,
        2 ** 63,
        -(2 ** 63),
        Number.MAX_VALUE,
        -Number.MAX_VALUE,
      ]
    ) {
      const binding = encodeValue("number", value);
      assertEqual(typeof binding, "string");
      assertEqual(binding, String(value));
      const row = statement.raw().get([binding]);
      if (row?.[0] === undefined) throw new Error("Expected a REAL result row");
      assertEqual(decodeValue<number>("number", row[0], false, false), value);
    }
    for (const value of [42, 0.25, 1e-300, Number.MIN_VALUE]) {
      const binding = encodeValue("number", value);
      assertEqual(typeof binding, "number");
      assertEqual(binding, value);
      const row = statement.raw().get([binding]);
      if (row?.[0] === undefined) throw new Error("Expected a REAL result row");
      assertEqual(decodeValue<number>("number", row[0], false, false), value);
    }

    // SQLite's decimal parser may choose the adjacent representable value.
    // Require a finite result within one relative rounding step, so an int64
    // wrap cannot pass while SQLite versions may improve decimal conversion.
    const huge = 2.0954167789372665e229;
    const row = statement.raw().get([encodeValue("number", huge)]);
    if (row?.[0] === undefined) {
      throw new Error("Expected a huge REAL result row");
    }
    const decoded = decodeValue<number>("number", row[0], false, false);
    if (
      !Number.isFinite(decoded) ||
      Math.abs((decoded - huge) / huge) > Number.EPSILON
    ) {
      throw new Error(
        "SQLite REAL conversion changed the value beyond rounding",
      );
    }
  } finally {
    statement[Symbol.dispose]();
    database.close();
  }
  for (const value of [NaN, Infinity, -Infinity, 1n, "1.5"]) {
    assertThrows(() => encodeValue("number", value));
  }
  for (const value of [2 ** 53, 1e20, Number.MAX_VALUE]) {
    assertThrows(() => encodeValue("unknown", value));
    assertThrows(() =>
      encodeCustom(
        {
          /** encode supplies the unsafe value without a REAL storage declaration. */
          encode: () => value,
          /** decode is unused because this test exercises argument validation. */
          decode: () => value,
        },
        value,
        false,
      )
    );
  }
});

Deno.test("NULL remains distinct from empty text and bytes", () => {
  assertEqual(encodeValue("string", undefined), null);
  assertEqual(encodeValue("string", null), null);
  assertEqual(encodeValue("string", ""), "");
  assertEqual(decodeValue("string", "", true, false), "");
  assertEqual(decodeValue("string", null, true, false), null);
  assertEqual(decodeValue("string", null, true, true), undefined);
  assertThrows(() => decodeValue("string", null, false, false));
  const empty = new Uint8Array();
  assertEqual(encodeValue("bytes", empty), empty);
  assertEqual(decodeValue("bytes", empty, true, false), empty);
});

Deno.test("boolean conversion accepts only 0 and 1 from SQLite", () => {
  assertEqual(encodeValue("boolean", true), 1);
  assertEqual(encodeValue("boolean", false), 0);
  for (const value of [0, 0n]) {
    assertEqual(decodeValue("boolean", value, false, false), false);
  }
  for (const value of [1, 1n]) {
    assertEqual(decodeValue("boolean", value, false, false), true);
  }
  for (const value of [2, -1, "false", "0"]) {
    assertThrows(() => decodeValue("boolean", value, false, false));
  }
  assertThrows(() => encodeValue("boolean", 0));
});

Deno.test("date conversion validates calendar fields and uses UTC", () => {
  for (
    const [input, expected] of [
      ["2024-02-29", "2024-02-29T00:00:00.000Z"],
      ["2024-02-29 12:34", "2024-02-29T12:34:00.000Z"],
      ["2024-02-29 12:34:56.123456", "2024-02-29T12:34:56.123Z"],
      ["2024-02-29T12:34:56+09:00", "2024-02-29T03:34:56.000Z"],
      ["0099-01-01", "0099-01-01T00:00:00.000Z"],
      ["+010000-01-01T00:00:00.000Z", "+010000-01-01T00:00:00.000Z"],
    ] as const
  ) {
    const date = decodeValue<Date>("date", input, false, false);
    assertEqual(date.toISOString(), expected);
    assertEqual(encodeValue("date", date), expected);
  }
  for (
    const input of [
      "2023-02-29",
      "2024-02-30",
      "2024-13-01",
      "2024-00-01",
      "2024-01-00",
      "2024-01-01T24:00:00",
      "2024-01-01T01:60:00",
      "2024-01-01T01:00:60",
      "2024-01-01T01:00:00+24:00",
      "September 7, 2026",
      "1720000000",
      1720000000,
      1720000000n,
    ]
  ) {
    assertThrows(() => decodeValue("date", input, false, false));
  }
  assertThrows(() => encodeValue("date", new Date(NaN)));
  assertThrows(() => encodeValue("date", "2024-01-01"));
});

Deno.test("JSON conversion keeps source bytes and whitespace intact", () => {
  const text = ' { "name": "東京", "unsafe": 9007199254740993 }\n';
  const bytes = decodeValue<Uint8Array>("json", text, false, false);
  assertEqual(new TextDecoder().decode(bytes), text);
  assertEqual(encodeValue("json", bytes), bytes);
  assertEqual(decodeValue("json", bytes, false, false), bytes);
  assertThrows(() => encodeValue("json", { name: "Tokyo" }));
  assertThrows(() => decodeValue("json", 1, false, false));
});

Deno.test("custom codecs receive non-null values and obey null policy", () => {
  let calls = 0;
  const codec: SqliteCodec<Date> = {
    /** encode stores exact Unix milliseconds through a custom representation. */
    encode(value) {
      calls++;
      return BigInt(value.getTime());
    },
    /** decode constructs a Date from the custom integer timestamp. */
    decode(value) {
      calls++;
      return new Date(Number(value));
    },
  };
  const date = new Date("2024-01-01T00:00:00.000Z");
  const stored = encodeCustom(codec, date, false);
  assertEqual(
    decodeCustom(codec, stored, false, false).toISOString(),
    date.toISOString(),
  );
  assertEqual(calls, 2);
  assertEqual(encodeCustom(codec, null, true), null);
  assertEqual(encodeCustom(codec, undefined, true), null);
  assertEqual(decodeCustom(codec, null, true, false), null);
  assertEqual(decodeCustom(codec, null, true, true), undefined);
  assertEqual(calls, 2);
  assertThrows(() => encodeCustom(codec, null, false));
  assertThrows(() => decodeCustom(codec, null, false, false));
  assertThrows(() =>
    encodeCustom({ ...codec, encode: () => 1n << 63n }, date, false)
  );
});

Deno.test("lastInsertId reads large IDs without changing database settings", () => {
  const database = new Database(":memory:");
  try {
    database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, data BLOB)");
    assertEqual(lastInsertId(database), 0n);
    const insert = database.prepare(
      "INSERT INTO items (id, data) VALUES (?, ?)",
    );
    try {
      insert.run(9_007_199_254_740_993n, new Uint8Array());
    } finally {
      insert[Symbol.dispose]();
    }
    assertEqual(lastInsertId(database), 9_007_199_254_740_993n);
    const ordinary = database.prepare("SELECT 9007199254740993");
    try {
      assertEqual(typeof ordinary.raw().get()?.[0], "number");
    } finally {
      ordinary[Symbol.dispose]();
    }
    const rollback = database.transaction(() => {
      database.exec("INSERT INTO items (id) VALUES (12)");
      assertEqual(lastInsertId(database), 12n);
      throw new Error("rollback");
    });
    assertThrows(rollback);
    const count = database.prepare("SELECT count(*) FROM items");
    try {
      assertEqual(count.raw().get()?.[0], 1);
    } finally {
      count[Symbol.dispose]();
    }
  } finally {
    database.close();
  }
});

Deno.test("lastInsertId finalizes after setup, execution, and conversion errors", () => {
  for (
    const stage of ["safeIntegers", "raw", "get", "decode", "none"] as const
  ) {
    let finalized = 0;
    const database = {
      /** prepare returns a statement that fails at the selected lifecycle step. */
      prepare() {
        return {
          /** safeIntegers simulates integer setup. */
          safeIntegers() {
            if (stage === "safeIntegers") throw new Error("safeIntegers");
          },
          /** raw simulates row setup. */
          raw() {
            if (stage === "raw") throw new Error("raw");
            return this;
          },
          /** get simulates execution and malformed integer results. */
          get() {
            if (stage === "get") throw new Error("get");
            return stage === "none" ? undefined : ["invalid"];
          },
          /** Symbol.dispose counts statement cleanup. */
          [Symbol.dispose]() {
            finalized++;
          },
        };
      },
    } as unknown as Database;
    assertThrows(() => lastInsertId(database));
    assertEqual(finalized, 1);
  }
});
