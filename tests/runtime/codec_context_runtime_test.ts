import assert from "node:assert/strict";
import { inspect } from "node:util";
import {
  codecContext,
  encodeSlice,
  type FieldContext,
  QueryCodecError,
  type QueryContext,
} from "./.generated/sqlite/codec_error.ts";
import * as sqlite from "./.generated/sqlite/runtime_sqlite.ts";
import * as server from "./.generated/server/runtime_postgresql.ts";
import { QueryCodecError as ServerQueryCodecError } from "./.generated/server/codec_error.ts";

const query = ["ReadEntries", "queries/entries.sql"] as const;
const field = ["entry.value", "number"] as const;

Deno.test("successful conversions do not read query or field metadata", () => {
  const unread = <T extends readonly string[]>(value: T): T =>
    new Proxy(value, {
      get() {
        throw new Error("Conversion read error metadata on success");
      },
    });
  const source: QueryContext = unread(query);
  const member: FieldContext = unread(field);
  const identity = { encode: (value: number) => value, decode: Number };
  assert.equal(sqlite.encodeValue("integer", 4, false, source, member), 4n);
  assert.equal(
    sqlite.decodeValue("integer", 4n, false, false, source, member),
    4n,
  );
  assert.equal(sqlite.encodeCustom(identity, 4, false, source, member), 4);
  assert.equal(
    sqlite.decodeCustom(identity, 4, false, false, source, member),
    4,
  );
  assert.equal(server.encodeValue("number", 4, false, source, member), 4);
  assert.equal(
    server.decodeValue("number", 4, false, false, source, member),
    4,
  );
  assert.equal(server.encodeCustom(identity, 4, false, source, member), 4);
  assert.equal(
    server.decodeCustom(identity, 4, false, false, source, member),
    4,
  );
  assert.deepEqual(
    server.encodeArray("number", [4], 1, false, source, member),
    [4],
  );
  assert.deepEqual(
    server.decodeArray("number", [4], 1, false, false, source, member),
    [4],
  );
  assert.deepEqual(
    server.encodeArrayCustom(identity, "number", [4], 1, false, source, member),
    [4],
  );
  assert.deepEqual(
    server.decodeArrayCustom(
      identity,
      "number",
      [4],
      1,
      false,
      false,
      source,
      member,
    ),
    [4],
  );
  assert.deepEqual(encodeSlice([4], Number, source, member), [4]);
  assert.equal(sqlite.encodeValue("integer", null, true, source, member), null);
  assert.equal(
    sqlite.decodeValue("integer", null, true, true, source, member),
    undefined,
  );
});

Deno.test("separate metadata retains conversion errors and keeps custom causes private", () => {
  const secret = "private-input-value";
  const cause = new Error(secret, { cause: { value: secret } });
  const codec = {
    encode(): never {
      throw cause;
    },
    decode(): never {
      throw cause;
    },
  };
  for (
    const [runtime, errorType] of [
      [sqlite, QueryCodecError],
      [server, ServerQueryCodecError],
    ] as const
  ) {
    for (const phase of ["encode", "decode"] as const) {
      const convert = () =>
        phase === "encode"
          ? runtime.encodeCustom(codec, secret, false, query, field)
          : runtime.decodeCustom(codec, secret, false, false, query, field);
      assert.throws(convert, (error: unknown) => {
        assert(error instanceof errorType);
        assert.equal(error.phase, phase);
        assert.equal(error.query, query[0]);
        assert.equal(error.file, query[1]);
        assert.equal(error.field, field[0]);
        assert.equal(error.expectedType, field[1]);
        assert.equal(error.originalCause(), cause);
        assert(!inspect(error).includes(secret));
        assert(!Deno.inspect(error).includes(secret));
        assert(!JSON.stringify(error).includes(secret));
        return true;
      });
    }
  }
});

Deno.test("slice failures retain matching errors and recontextualize other fields", () => {
  const cause = new Error("private-input-value");
  const inner = new QueryCodecError(
    codecContext(query, field),
    "encode",
    cause,
  );
  const convert = () => {
    throw inner;
  };
  assert.throws(() => encodeSlice([1], convert, query, field), (error) => {
    assert.equal(error, inner);
    return true;
  });
  const other = ["entry.other", "string"] as const;
  assert.throws(() => encodeSlice([1], convert, query, other), (error) => {
    assert(error instanceof QueryCodecError);
    assert.equal(error.field, other[0]);
    assert.equal(error.expectedType, other[1]);
    assert.equal(error.originalCause(), inner);
    return true;
  });
  assert.throws(() => encodeSlice(null, Number, query, field), (error) => {
    assert(error instanceof QueryCodecError);
    assert.equal(error.phase, "encode");
    assert.equal(error.field, field[0]);
    return true;
  });
  assert.throws(() => encodeSlice([1], convert), (error) => {
    assert.equal(error, inner);
    return true;
  });
});

Deno.test("separate metadata wraps built-in scalar and array failures", () => {
  const operations: [
    () => unknown,
    "encode" | "decode",
    typeof QueryCodecError,
  ][] = [
    [
      () => sqlite.encodeValue("integer", "bad", false, query, field),
      "encode",
      QueryCodecError,
    ],
    [
      () => sqlite.decodeValue("integer", "bad", false, false, query, field),
      "decode",
      QueryCodecError,
    ],
    [
      () => server.encodeValue("date", "bad", false, query, field),
      "encode",
      ServerQueryCodecError,
    ],
    [
      () => server.decodeValue("number", "bad", false, false, query, field),
      "decode",
      ServerQueryCodecError,
    ],
    [
      () => server.encodeArray("number", null, 1, false, query, field),
      "encode",
      ServerQueryCodecError,
    ],
    [
      () =>
        server.decodeArray("number", ["bad"], 1, false, false, query, field),
      "decode",
      ServerQueryCodecError,
    ],
  ];
  for (const [convert, phase, errorType] of operations) {
    assert.throws(convert, (error) => {
      assert(error instanceof errorType);
      assert.equal(error.phase, phase);
      assert.equal(error.query, query[0]);
      assert.equal(error.file, query[1]);
      assert.equal(error.field, field[0]);
      assert.equal(error.expectedType, field[1]);
      return true;
    });
  }
});
