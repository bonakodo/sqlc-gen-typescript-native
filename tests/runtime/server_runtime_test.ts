import { Buffer } from "node:buffer";
import {
  decodeArray,
  decodeArrayCustom,
  decodeCustom,
  decodeValue,
  encodeArray,
  encodeCustom,
  encodeValue,
  integerResult,
  parseArrayText,
} from "./.generated/server/runtime_postgresql.ts";
import {
  decodeValue as decodeMysqlValue,
  mysqlInsertId,
  mysqlInsertIdBigInt,
} from "./.generated/mysql/runtime_mysql.ts";

function equal(actual: unknown, expected: unknown): void {
  const json = (value: unknown) =>
    JSON.stringify(
      value,
      (_key, item: unknown) => typeof item === "bigint" ? `${item}n` : item,
    );
  if (json(actual) !== json(expected)) {
    throw new Error(`Expected ${json(expected)}, got ${json(actual)}`);
  }
}

function throws(operation: () => unknown): void {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error("Expected an error");
}

Deno.test("MySQL insert IDs honor both options without losing precision", () => {
  for (const value of [3, "3", 3n]) {
    equal(mysqlInsertId(value, false, false), 3);
    equal(mysqlInsertId(value, false, true), 3);
    equal(mysqlInsertId(value, true, false), 3);
    equal(mysqlInsertId(value, true, true), "3");
  }
  equal(mysqlInsertId("9007199254740991", false, false), 9007199254740991);
  equal(mysqlInsertId("9007199254740991", true, false), 9007199254740991);
  for (
    const value of [
      "9007199254740992",
      "9007199254740993",
      "9223372036854775807",
    ]
  ) {
    equal(mysqlInsertId(value, true, false), value);
    equal(mysqlInsertId(value, true, true), value);
    equal(mysqlInsertId(BigInt(value), true, true), value);
    throws(() => mysqlInsertId(value, false, false));
    throws(() => mysqlInsertId(value, false, true));
  }
  // A numeric driver result has already lost the source digits. Enabling either
  // output mode must not turn that rounded value into an apparently exact string.
  throws(() => mysqlInsertId(9007199254740992, true, false));
  throws(() => mysqlInsertId(9007199254740992, true, true));
});

Deno.test("MySQL ambiguous signed OK-packet IDs never return the wrong value", () => {
  for (const value of [-1, "-1", "-9223372036854775808"]) {
    throws(() => mysqlInsertIdBigInt(value));
    throws(() => mysqlInsertId(value, false, false));
    throws(() => mysqlInsertId(value, true, false));
    throws(() => mysqlInsertId(value, true, true));
  }
});

Deno.test("MySQL explicit ID signedness preserves both 64-bit ranges", () => {
  equal(mysqlInsertIdBigInt("-1", false), -1n);
  equal(
    mysqlInsertIdBigInt("-9223372036854775808", false),
    -9223372036854775808n,
  );
  equal(mysqlInsertId(-1, false, false, false), -1);
  equal(mysqlInsertId("-1", true, true, false), "-1");
  equal(
    mysqlInsertId("-9223372036854775808", true, false, false),
    "-9223372036854775808",
  );
  equal(
    mysqlInsertIdBigInt("-9223372036854775808", true),
    9223372036854775808n,
  );
  equal(
    mysqlInsertIdBigInt("-9223372036854775807", true),
    9223372036854775809n,
  );
  equal(mysqlInsertIdBigInt(-1, true), 18446744073709551615n);
  equal(
    mysqlInsertIdBigInt("18446744073709551615", true),
    18446744073709551615n,
  );
  equal(mysqlInsertId(-1, true, false, true), "18446744073709551615");
  equal(mysqlInsertId(-1, true, true, true), "18446744073709551615");
  throws(() => mysqlInsertId(-1, false, false, true));
  throws(() => mysqlInsertIdBigInt("9223372036854775808", false));
  throws(() => mysqlInsertIdBigInt("18446744073709551616", true));
  throws(() => mysqlInsertIdBigInt("-9223372036854775809", true));
  throws(() => mysqlInsertIdBigInt(9007199254740992, true));
});

Deno.test("server types follow driver defaults and retain large decimal strings", () => {
  const value = "9223372036854775807";
  equal(decodeValue("string", value, false, false), value);
  equal(encodeValue("string", value), value);
  equal(decodeMysqlValue("number-or-string", 3, false, false), 3);
  equal(decodeMysqlValue("number-or-string", value, false, false), value);
  throws(() => decodeValue("string", 3, false, false));
  throws(() => decodeValue("number", "3", false, false));
  throws(() => decodeValue("date", "2026-09-07", false, false));
  throws(() => decodeValue("boolean", 1, false, false));
  throws(() => decodeValue("buffer", new Uint8Array(), false, false));
  equal(
    decodeValue("buffer", Buffer.from([0, 255]), false, false),
    Buffer.from([0, 255]),
  );
});

Deno.test("null rules and codecs leave absent values outside custom code", () => {
  equal(encodeValue("string", undefined), null);
  equal(decodeValue("string", null, true, false), null);
  equal(decodeValue("string", null, true, true), undefined);
  equal(decodeValue("json", null, false, true), null);
  throws(() => decodeValue("string", null, false, false));
  throws(() => decodeValue("unknown", undefined, false, false));
  const codec = {
    encode: (value: Date) => value.toISOString(),
    decode: (value: unknown) => new Date(String(value)),
  };
  equal(
    encodeCustom(codec, new Date("2026-09-07T00:00:00Z"), false),
    "2026-09-07T00:00:00.000Z",
  );
  equal(decodeCustom(codec, null, true, true), undefined);
  throws(() => encodeCustom(codec, undefined, false));
  throws(() => encodeCustom({ encode: () => null, decode: () => 0 }, 1, false));
});

Deno.test("pg geometry binds PostgreSQL text and decodes objects", () => {
  equal(encodeValue("point", { x: 1, y: 2 }), "(1,2)");
  equal(encodeValue("circle", { x: 1, y: 2, radius: 3 }), "<(1,2),3>");
  equal(encodeArray("point", [{ x: 1, y: 2 }, null], 1), ["(1,2)", null]);
  equal(decodeValue("point", { x: 1, y: 2 }, false, false), { x: 1, y: 2 });
  throws(() => encodeValue("point", { x: "1", y: 2 }));
});

Deno.test("pg arrays keep nested NULL elements and parse unknown enum array OIDs", () => {
  equal(parseArrayText('{"a,b","NULL",NULL,"a\\"b","a\\\\b"}'), [
    "a,b",
    "NULL",
    null,
    'a"b',
    "a\\b",
  ]);
  equal(parseArrayText("[0:1][2:3]={{a,b},{c,d}}"), [["a", "b"], ["c", "d"]]);
  equal(parseArrayText("{}"), []);
  equal(decodeArray("string", '{"draft","live",NULL}', 1, false, false), [
    "draft",
    "live",
    null,
  ]);
  equal(decodeArray("number", [[1, null], [2, 3]], 2, false, true), [[
    1,
    undefined,
  ], [2, 3]]);
  equal(decodeArray("circle", '{"<(1,2),3>"}', 1, false, false), [{
    x: 1,
    y: 2,
    radius: 3,
  }]);
  equal(
    decodeArrayCustom(
      {
        encode: String,
        decode: (value: unknown) => String(value).toUpperCase(),
      },
      "string",
      "{a,NULL}",
      1,
      false,
      true,
    ),
    ["A", undefined],
  );
  for (const text of ["{", "{a,}", '{"a}', "{a}tail", "{,a}", '{"a"x}', "{a"]) {
    throws(() => parseArrayText(text));
  }
  throws(() => decodeArray("number", null, 1, false, false));
  throws(() => decodeArray("number", ["1"], 1, false, false));
});

Deno.test("execution metadata never turns an already rounded count into a bigint", () => {
  equal(integerResult(3), 3n);
  equal(integerResult("9007199254740993"), 9007199254740993n);
  throws(() => integerResult(9007199254740992));
});

Deno.test("JSON binds serialize scalars and arrays without using pg array syntax", () => {
  equal(encodeValue("json", [1, "two", null], false), '[1,"two",null]');
  equal(encodeValue("json", "quoted", false), '"quoted"');
  equal(encodeValue("json", { ok: true }, false), '{"ok":true}');
  equal(encodeValue("json", null, false), "null");
  equal(encodeValue("json", null, true), null);
  equal(
    encodeArray("json", [[1, 2], { ok: true }], 1),
    '{"[1,2]","{\\"ok\\":true}"}',
  );
  throws(() => encodeValue("json", () => 1, false));
  throws(() => encodeValue("json", 1n, false));
});

Deno.test("raw PostgreSQL arrays decode scalar values before custom codecs", () => {
  const codec = {
    encode: (x: number) => x,
    decode: (x: unknown) => {
      if (typeof x !== "number") throw new TypeError("Expected parsed number");
      return x + 1;
    },
  };
  equal(decodeArrayCustom(codec, "number", "{1,NULL,3}", 1, false, false), [
    2,
    null,
    4,
  ]);
});

Deno.test("box arrays bind and decode their PostgreSQL semicolon delimiter", () => {
  const boxes = ["(3,4),(1,2)", null, "(7,8),(5,6)"];
  equal(encodeArray("box", boxes, 1), '{"(3,4),(1,2)";NULL;"(7,8),(5,6)"}');
  equal(
    decodeArray("box", "{(3,4),(1,2);NULL;(7,8),(5,6)}", 1, false, false),
    boxes,
  );
  equal(
    decodeArray("box", '{"(3,4),(1,2)";NULL;"(7,8),(5,6)"}', 1, false, false),
    boxes,
  );
});
