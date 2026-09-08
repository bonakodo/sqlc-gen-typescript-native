/** Each @part names a declaration; @when gates individual conversion kinds. */

// @part Database


// @part CodecContext common.CodecContext
import type { CodecContext } from "./runtime_common.ts";

// @part withCodecContext common.withCodecContext
import { withCodecContext } from "./runtime_common.ts";

// @part checkedJson common.checkedJson
import { checkedJson } from "./runtime_common.ts";

// @part JsonValue
import type { JsonValue } from "./json.ts";

// @part SqliteValue
export type SqliteValue = null | string | number | bigint | Uint8Array;

// @part SqliteCodec
export interface SqliteCodec<T> {
  encode(value: T): SqliteValue;
  decode(value: SqliteValue): T;
}

// @part ExecResult
export interface ExecResult {
  rowsAffected: bigint;
  lastInsertId: bigint;
}

// @part Kind
export type Kind =
  | "integer"
  | "sqlite-integer"
  | "number"
  | "boolean"
  | "date"
  | "bytes"
  | "json"
  | "string"
  | "unknown";

// @part minInt64
const minInt64 = -(1n << 63n);

// @part maxInt64
const maxInt64 = (1n << 63n) - 1n;

// @part utf8
const utf8 = new TextEncoder();

// @part integer
function integer(value: unknown): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Expected a safe integer number or bigint");
    }
    value = BigInt(value);
  }
  if (typeof value !== "bigint") {
    throw new TypeError("Expected a SQLite integer");
  }
  if (value < minInt64 || value > maxInt64) {
    throw new RangeError("Integer exceeds SQLite's signed 64-bit range");
  }
  return value;
}

// @part finiteNumber
function finiteNumber(value: unknown): number {
  if (typeof value === "bigint") value = Number(integer(value));
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Expected a finite SQLite number");
  }
  return value;
}

// @part dateValue
function dateValue(value: unknown): Date {
  if (typeof value !== "string") {
    throw new TypeError(
      "Expected date text; numeric timestamps need a custom codec",
    );
  }
  const match =
    /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?)?$/
      .exec(value);
  if (match === null) throw new TypeError("Invalid SQLite date text");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  const zone = match[8] ?? "Z";
  if (
    month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 ||
    minute > 59 || second > 59
  ) {
    throw new TypeError("Invalid SQLite date fields");
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  if (
    !Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) {
    throw new TypeError("Invalid SQLite calendar date");
  }
  if (zone !== "Z") {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) {
      throw new TypeError("Invalid SQLite date offset");
    }
    const sign = zone.startsWith("+") ? 1 : -1;
    date.setTime(date.getTime() - sign * (zoneHour * 60 + zoneMinute) * 60_000);
    if (!Number.isFinite(date.getTime())) {
      throw new TypeError("SQLite date exceeds Date's range");
    }
  }
  return date;
}

// @part encodeValueUnchecked
function encodeValueUnchecked(
  kind: Kind,
  value: unknown,
  nullable = true,
): SqliteValue {
  if (!nullable && (value === null || value === undefined)) {
    throw new TypeError("Missing a non-null argument");
  }
  if (value === null || value === undefined) return null;
  switch (kind) {
// @when sqlite-integer
    case "sqlite-integer":
      if (typeof value === "bigint") return integer(value);
      if (typeof value === "number" && Number.isFinite(value)) {
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
          throw new TypeError("Expected a safe integer number or bigint");
        }
        return value;
      }
      throw new TypeError("Expected a SQLite number or bigint");
// @endwhen
// @when integer
    case "integer":
      return integer(value);
// @endwhen
// @when number
    case "number": {
      if (typeof value !== "number") {
        throw new TypeError("Expected a finite JavaScript number");
      }
      const number = finiteNumber(value);
      return Number.isInteger(number) && !Number.isSafeInteger(number)
        ? String(number)
        : number;
    }
// @endwhen
// @when boolean
    case "boolean":
      if (typeof value !== "boolean") throw new TypeError("Expected a boolean");
      return value ? 1 : 0;
// @endwhen
// @when date
    case "date":
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw new TypeError("Expected a valid Date");
      }
      return value.toISOString();
// @endwhen
// @when bytes json
    case "bytes":
    case "json":
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Expected Uint8Array");
      }
      return value;
// @endwhen
// @when string
    case "string":
      if (typeof value !== "string") throw new TypeError("Expected a string");
      return value;
// @endwhen
// @when unknown
    case "unknown":
      if (typeof value === "bigint") return integer(value);
      if (typeof value === "number") {
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
          throw new TypeError(
            "Expected a number without unsafe integer rounding",
          );
        }
        return finiteNumber(value);
      }
      if (typeof value === "string" || value instanceof Uint8Array) {
        return value;
      }
      throw new TypeError("Expected a SQLite scalar value");
// @endwhen
  }
  throw new TypeError("SQL kind is not used by these queries: " + kind);
}

// @part decodeValueUnchecked
function decodeValueUnchecked<T>(
  kind: Kind,
  value: SqliteValue,
  nullable: boolean,
  undefinedNull: boolean,
): T {
  if (value === null) {
    if (!nullable) {
      throw new TypeError("Unexpected SQL NULL in a non-null column");
    }
    return (undefinedNull ? undefined : null) as T;
  }
  let result: unknown;
  switch (kind) {
// @when sqlite-integer
    case "sqlite-integer":
      if (typeof value !== "number" && typeof value !== "bigint") {
        throw new TypeError("Expected a SQLite number or bigint");
      }
      result = typeof value === "bigint" ? integer(value) : finiteNumber(value);
      if (typeof result === "bigint" && Number.isSafeInteger(Number(result))) {
        result = Number(result);
      }
      break;
// @endwhen
// @when integer
    case "integer":
      result = integer(value);
      break;
// @endwhen
// @when number
    case "number":
      result = finiteNumber(value);
      break;
// @endwhen
// @when boolean
    case "boolean":
      if (value !== 0 && value !== 1 && value !== 0n && value !== 1n) {
        throw new TypeError("Expected SQLite boolean 0 or 1");
      }
      result = value === 1 || value === 1n;
      break;
// @endwhen
// @when date
    case "date":
      result = dateValue(value);
      break;
// @endwhen
// @when json
    case "json":
      if (typeof value === "string") {
        result = utf8.encode(value);
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Expected raw JSON text or bytes");
      }
      result = value;
      break;
// @endwhen
// @when bytes
    case "bytes":
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Expected SQLite bytes");
      }
      result = value;
      break;
// @endwhen
// @when string
    case "string":
      if (typeof value !== "string") {
        throw new TypeError("Expected SQLite text");
      }
      result = value;
      break;
// @endwhen
// @when unknown
    case "unknown":
      if (typeof value === "bigint") result = integer(value);
      else if (typeof value === "number") result = finiteNumber(value);
      else if (typeof value === "string" || value instanceof Uint8Array) {
        result = value;
      } else throw new TypeError("Expected a SQLite scalar value");
      break;
// @endwhen
    default:
      throw new TypeError("SQL kind is not used by these queries: " + kind);
  }
  return result as T;
}

// @part encodeCustomUnchecked
// @kind unknown
function encodeCustomUnchecked<T>(
  codec: SqliteCodec<T>,
  value: unknown,
  nullable: boolean,
): SqliteValue {
  if (
    value === undefined ||
    (value === null && (nullable || !jsonCodecs.has(codec)))
  ) {
    if (!nullable) throw new TypeError("Missing a non-null custom argument");
    return null;
  }
  const encoded = encodeValue("unknown", codec.encode(value as T));
  if (encoded === null && !nullable) {
    throw new TypeError("Codec returned NULL for a non-null argument");
  }
  return encoded;
}

// @part decodeCustomUnchecked
function decodeCustomUnchecked<T>(
  codec: SqliteCodec<T>,
  value: SqliteValue,
  nullable: boolean,
  undefinedNull: boolean,
): T {
  if (value === null) {
    if (!nullable) {
      throw new TypeError("Unexpected SQL NULL in a non-null custom column");
    }
    return (undefinedNull ? undefined : null) as T;
  }
  return codec.decode(value);
}

// @part safeInteger
export const safeInteger: SqliteCodec<number> = {
  encode(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      throw new TypeError("Expected a safe integer number");
    }
    return BigInt(value);
  },
  decode(value) {
    const result = Number(integer(value));
    if (!Number.isSafeInteger(result)) {
      throw new RangeError("SQLite integer exceeds JavaScript's safe range");
    }
    return result;
  },
};

// @part epochMilliseconds
export const epochMilliseconds: SqliteCodec<Date> = {
  encode(value) {
    if (!(value instanceof Date)) throw new TypeError("Expected a valid Date");
    return safeInteger.encode(value.getTime());
  },
  decode(value) {
    const result = new Date(safeInteger.decode(value));
    if (!Number.isFinite(result.getTime())) {
      throw new RangeError("SQLite timestamp exceeds Date's range");
    }
    return result;
  },
};

// @part sqliteBoolean
export const sqliteBoolean: SqliteCodec<boolean> = {
  encode(value) {
    if (typeof value !== "boolean") throw new TypeError("Expected a boolean");
    return value ? 1 : 0;
  },
  decode(value) {
    if (value !== 0 && value !== 1 && value !== 0n && value !== 1n) {
      throw new TypeError("Expected SQLite boolean 0 or 1");
    }
    return value === 1 || value === 1n;
  },
};

// @part jsonCodecs
const jsonCodecs = new WeakSet<object>();

// @part jsonText createJsonTextCodec
export const jsonText = {
  encode(value: unknown): SqliteValue {
    return JSON.stringify(checkedJson(value));
  },
  decode<T = JsonValue>(value: SqliteValue): T {
    if (typeof value !== "string") {
      throw new TypeError("Expected SQLite JSON text");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      // JSON.parse errors can include excerpts of the original document.
      throw new TypeError("Invalid SQLite JSON text");
    }
    return checkedJson(parsed) as T;
  },
};
jsonCodecs.add(jsonText);

// @part createJsonTextCodec
export function createJsonTextCodec<T>(
  parse: (value: unknown) => T,
): SqliteCodec<T> {
  const codec: SqliteCodec<T> = {
    encode(value) {
      return jsonText.encode(parse(value));
    },
    decode(value) {
      return parse(jsonText.decode(value));
    },
  };
  jsonCodecs.add(codec);
  return codec;
}

// @part DriverValue
type DriverValue = SqliteValue;

// @part DriverCodec
type DriverCodec<T> = SqliteCodec<T>;

// @part encodeValue
export function encodeValue(
  kind: Kind,
  value: unknown,
  nullable = true,
  context?: CodecContext,
): DriverValue {
  return withCodecContext(
    context,
    "encode",
    () => encodeValueUnchecked(kind, value, nullable),
  );
}

// @part decodeValue
export function decodeValue<T>(
  kind: Kind,
  value: DriverValue,
  nullable: boolean,
  undefinedNull: boolean,
  context?: CodecContext,
): T {
  return withCodecContext(
    context,
    "decode",
    () => decodeValueUnchecked<T>(kind, value, nullable, undefinedNull),
  );
}

// @part encodeCustom
export function encodeCustom<T>(
  codec: DriverCodec<T>,
  value: unknown,
  nullable: boolean,
  context?: CodecContext,
): DriverValue {
  return withCodecContext(
    context,
    "encode",
    () => encodeCustomUnchecked(codec, value, nullable),
  );
}

// @part decodeCustom
export function decodeCustom<T>(
  codec: DriverCodec<T>,
  value: DriverValue,
  nullable: boolean,
  undefinedNull: boolean,
  context?: CodecContext,
): T {
  return withCodecContext(
    context,
    "decode",
    () => decodeCustomUnchecked(codec, value, nullable, undefinedNull),
  );
}

// @part lastInsertId @bonakodo
export function lastInsertId(database: Database): bigint {
  const statement = database.prepare("SELECT last_insert_rowid()");
  try {
    statement.safeIntegers();
    const row = statement.raw().get();
    if (row === undefined) {
      throw new Error("SQLite did not return last_insert_rowid()");
    }
    return integer(row[0]);
  } finally {
    statement[Symbol.dispose]();
  }
}

// @part lastInsertId @better-sqlite3
export function lastInsertId(database: Database): bigint {
  const row = database.prepare("SELECT last_insert_rowid()").safeIntegers()
    .raw().get() as [SqliteValue] | undefined;
  if (row === undefined) {
    throw new Error("SQLite did not return last_insert_rowid()");
  }
  return integer(row[0]);
}


// @part externalCodecs safeInteger epochMilliseconds sqliteBoolean jsonText
