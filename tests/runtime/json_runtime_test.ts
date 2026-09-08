import assert from "node:assert/strict";
import {
  decodeArray,
  decodeValue,
  encodeArray,
  encodeValue,
  jsonValue,
} from "./.generated/server/runtime.ts";
import { encodeValue as encodePostgresValue } from "./.generated/postgres/runtime.ts";

Deno.test("generated pg and postgres.js runtimes keep their distinct JSON bindings", () => {
  for (
    const value of [{ nested: [null, true, "text"] }, [1, 2], "text", 42, true]
  ) {
    assert.equal(encodeValue("json", value, false), JSON.stringify(value));
    assert.strictEqual(encodePostgresValue("json", value, false), value);
  }
  const requiredNull = encodePostgresValue("json", null, false);
  assert.notEqual(requiredNull, null);
  assert.equal(JSON.stringify(requiredNull), "null");
  assert.equal(encodePostgresValue("json", null, true), null);
  assert.equal(encodePostgresValue("json", undefined, true), null);
  assert.throws(
    () => encodePostgresValue("json", { missing: undefined }, false),
    TypeError,
  );
});

Deno.test("JSON values retain nested arrays, objects, and JSON null", () => {
  const shared = { nested: [null, true, "text", 2.5] };
  const value = { first: shared, second: shared };
  assert.strictEqual(jsonValue(value), value);
  assert.strictEqual(decodeValue("json", value, false, false), value);
  assert.equal(encodeValue("json", value, false), JSON.stringify(value));
  assert.equal(encodeValue("json", null, false), "null");
  assert.equal(decodeValue("json", null, false, true), null);
});

Deno.test("JSON rejects nested values that serialization would silently change", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (
    const value of [
      { missing: undefined },
      [undefined],
      new Array(1),
      { invalid: Infinity },
      { invalid: NaN },
      { invalid: 1n },
      { invalid: () => 1 },
      { invalid: Symbol("value") },
      { invalid: new Date() },
      cycle,
    ]
  ) {
    assert.throws(() => encodeValue("json", value, false), TypeError);
    assert.throws(() => decodeValue("json", value, false, false), TypeError);
  }
});

Deno.test("JSON keeps the driver's nullable-column policy without shape checks", () => {
  assert.equal(encodeValue("json", undefined, true), null);
  assert.equal(encodeValue("json", null, true), null);
  assert.equal(decodeValue("json", null, true, false), null);
  // Drivers use the same null for JSON null and SQL NULL on nullable columns.
  assert.equal(decodeValue("json", null, true, true), undefined);
  // An application shape override is a static contract. Only a codec checks it.
  const unexpectedShape = { unexpected: true };
  assert.strictEqual(
    decodeValue("json", unexpectedShape, false, false),
    unexpectedShape,
  );
});

Deno.test("SQL JSON arrays preserve scalar JSON arrays and nullable SQL elements", () => {
  const values = [[1, [2, null]], { text: 'comma, quote" brace}' }, null];
  const encoded = encodeArray("json", values, 1);
  assert.equal(typeof encoded, "string");
  assert.deepEqual(decodeArray("json", encoded, 1, false, false), values);
  assert.deepEqual(decodeArray("json", encoded, 1, false, true), [
    values[0],
    values[1],
    undefined,
  ]);
  const matrix = [[values[0], values[1]], [values[1], null]];
  assert.deepEqual(
    decodeArray("json", encodeArray("json", matrix, 2), 2, false, false),
    matrix,
  );
  // Raw array text distinguishes the JSON null literal from a SQL NULL member.
  assert.deepEqual(decodeArray("json", '{"null",NULL}', 1, false, true), [
    null,
    undefined,
  ]);
});
