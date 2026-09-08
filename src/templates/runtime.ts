/**
 * Driver sections are static output data, selected by the WASM generator.
 * See README.md before editing section markers.
 */

import type { JsonValue } from "./json.ts";
import { type CodecContext, withCodecContext } from "./codec_error.ts";
export {
  encodeSlice,
  QueryCodecError,
  withCodecContext,
} from "./codec_error.ts";
export type { CodecContext } from "./codec_error.ts";

/** checkedJson checks JSON recursively before a generated type assertion.
 * Rejecting unsupported nested values prevents JSON.stringify from silently
 * dropping undefined properties, turning non-finite numbers into null, or
 * invoking a class's toJSON method. Ancestor tracking rejects cycles while
 * allowing the same object to appear in more than one part of a document.
 */
function checkedJson(
  value: unknown,
  numberError = "Expected a JSON value",
): JsonValue {
  const ancestors = new Set<object>();
  const visit = (item: unknown): void => {
    if (
      item === null || typeof item === "string" || typeof item === "boolean"
    ) {
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        throw new TypeError(numberError);
      }
      return;
    }
    if (typeof item !== "object") throw new TypeError("Expected a JSON value");
    if (ancestors.has(item)) {
      throw new TypeError("Expected JSON without cycles");
    }
    const array = Array.isArray(item);
    if (
      !array && Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw new TypeError("Expected a plain JSON object");
    }
    ancestors.add(item);
    for (const child of array ? item : Object.values(item)) visit(child);
    ancestors.delete(item);
  };
  visit(value);
  return value as JsonValue;
}

// @if sqlite
/** SqliteValue is a bound or returned SQLite value before application conversion. */
export type SqliteValue = null | string | number | bigint | Uint8Array;

/** SqliteCodec converts a non-null custom type to and from SQLite values. */
export interface SqliteCodec<T> {
  /** encode returns a SQLite value; throw when the application value is invalid. */
  encode(value: T): SqliteValue;
  /** decode returns an application value; throw when the stored value is invalid. */
  decode(value: SqliteValue): T;
}

/** ExecResult reports changes and the connection's inserted row ID after a query. */
export interface ExecResult {
  /** rowsAffected counts rows directly changed by this statement. */
  rowsAffected: bigint;
  /** lastInsertId is the connection's last inserted row ID, read without rounding. */
  lastInsertId: bigint;
}

/** Kind names the built-in conversion selected from a SQLite column declaration. */
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

/** minInt64 is the smallest integer that SQLite can store without overflow. */
const minInt64 = -(1n << 63n);

/** maxInt64 is the largest integer that SQLite can store without overflow. */
const maxInt64 = (1n << 63n) - 1n;

/** utf8 converts stored JSON text to bytes without parsing or rewriting JSON. */
const utf8 = new TextEncoder();

/**
 * integer validates SQLite's signed 64-bit range and returns a bigint.
 * Safe integer numbers are also accepted for bindings and custom codecs.
 * @throws {TypeError} For non-integers or already-rounded JavaScript numbers.
 * @throws {RangeError} For values outside SQLite's signed 64-bit range.
 */
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

/**
 * finiteNumber validates a REAL or NUMERIC value and returns a JavaScript number.
 * A stored integer uses number precision under this mapping; use an integer
 * column or a custom codec when the application needs exact integer arithmetic.
 * Text remains invalid here. Generated CAST placeholders convert temporary
 * decimal text in SQLite before a result reaches this decoder.
 * @throws {TypeError} For values other than finite numbers or bigints.
 */
function finiteNumber(value: unknown): number {
  if (typeof value === "bigint") value = Number(integer(value));
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Expected a finite SQLite number");
  }
  return value;
}

/**
 * dateValue decodes ISO or SQLite date/time text, treating absent zones as UTC.
 * It validates the calendar before conversion; Date's parser alone normalizes
 * invalid dates such as February 30. Fractions beyond milliseconds are dropped
 * because JavaScript Date stores only millisecond precision.
 * @throws {TypeError} For numeric timestamps, invalid dates, or unsupported text.
 */
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

/**
 * encodeValue converts one application value for SQLite binding.
 * Null and undefined bind as SQL NULL. Dates use UTC ISO text with millisecond
 * precision; JSON remains raw bytes. The returned byte array retains ownership
 * with the caller and must not change during the synchronous statement call.
 * Integer-valued REAL inputs outside JavaScript's safe integer range use decimal
 * text with the generator's CAST placeholder to preserve the shared REAL
 * binding representation across SQLite drivers.
 * SQLite's decimal conversion can round a huge value by one floating-point step;
 * fractional and subnormal inputs stay numeric to avoid that conversion.
 * @throws {TypeError} For invalid types, dates, nonfinite numbers, or unsafe
 * integer numbers supplied without a declared REAL/NUMERIC representation.
 * @throws {RangeError} For integers outside SQLite's signed 64-bit range.
 */
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
    case "sqlite-integer":
      if (typeof value === "bigint") return integer(value);
      if (typeof value === "number" && Number.isFinite(value)) {
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
          throw new TypeError("Expected a safe integer number or bigint");
        }
        return value;
      }
      throw new TypeError("Expected a SQLite number or bigint");
    case "integer":
      return integer(value);
    case "number": {
      if (typeof value !== "number") {
        throw new TypeError("Expected a finite JavaScript number");
      }
      const number = finiteNumber(value);
      return Number.isInteger(number) && !Number.isSafeInteger(number)
        ? String(number)
        : number;
    }
    case "boolean":
      if (typeof value !== "boolean") throw new TypeError("Expected a boolean");
      return value ? 1 : 0;
    case "date":
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw new TypeError("Expected a valid Date");
      }
      return value.toISOString();
    case "bytes":
    case "json":
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Expected Uint8Array");
      }
      return value;
    case "string":
      if (typeof value !== "string") throw new TypeError("Expected a string");
      return value;
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
  }
}

/**
 * decodeValue converts a SQLite result using its declared type and null policy.
 * The generator selects T from the same type mapping as kind. Integers always
 * become bigint; JSON text becomes UTF-8 bytes without parsing. Dates use UTC
 * for missing zones and retain millisecond precision. Returned bytes belong to
 * the result, so callers may retain them after the statement is finalized.
 * @throws {TypeError} For unexpected NULL, invalid stored types, or invalid dates.
 * @throws {RangeError} For stored integers outside SQLite's signed 64-bit range.
 */
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
    case "sqlite-integer":
      if (typeof value !== "number" && typeof value !== "bigint") {
        throw new TypeError("Expected a SQLite number or bigint");
      }
      result = typeof value === "bigint" ? integer(value) : finiteNumber(value);
      if (typeof result === "bigint" && Number.isSafeInteger(Number(result))) {
        result = Number(result);
      }
      break;
    case "integer":
      result = integer(value);
      break;
    case "number":
      result = finiteNumber(value);
      break;
    case "boolean":
      if (value !== 0 && value !== 1 && value !== 0n && value !== 1n) {
        throw new TypeError("Expected SQLite boolean 0 or 1");
      }
      result = value === 1 || value === 1n;
      break;
    case "date":
      result = dateValue(value);
      break;
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
    case "bytes":
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Expected SQLite bytes");
      }
      result = value;
      break;
    case "string":
      if (typeof value !== "string") {
        throw new TypeError("Expected SQLite text");
      }
      result = value;
      break;
    case "unknown":
      if (typeof value === "bigint") result = integer(value);
      else if (typeof value === "number") result = finiteNumber(value);
      else if (typeof value === "string" || value instanceof Uint8Array) {
        result = value;
      } else throw new TypeError("Expected a SQLite scalar value");
      break;
  }
  return result as T;
}

/**
 * encodeCustom applies a custom codec to a non-null argument and checks its SQL
 * value. Nullable null and undefined arguments bypass the codec and bind NULL.
 * @throws {TypeError} For missing required values or unsupported encoded values.
 * @throws Propagates codec errors and signed 64-bit range errors.
 */
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

/**
 * decodeCustom applies a custom codec after handling SQL NULL. Codecs receive
 * non-null SQLite values; null output policy remains the generator's concern.
 * @throws {TypeError} For NULL in a non-null column.
 * @throws Propagates errors raised by the custom codec.
 */
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

/** Safe integer numbers retain exact precision in SQLite's bigint bindings. */
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

/** Dates bind as epoch milliseconds rather than SQLite date text. */
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

/** SQLite booleans accept exactly 0 and 1, including bigint driver results. */
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

const jsonCodecs = new WeakSet<object>();

/**
 * JSON text becomes parsed JSON. T describes the application's static shape;
 * createJsonTextCodec adds an application parser when that shape needs checking.
 * On required columns null encodes the JSON literal null; nullable columns keep
 * null as SQL NULL, just like other generated nullable values.
 */
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

/** The parser checks application shape on both writes and reads. */
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

type DriverValue = SqliteValue;
type DriverCodec<T> = SqliteCodec<T>;
// @endif

// @if bonakodo
/**
 * lastInsertId reads the connection's last inserted row ID without number loss.
 * It leaves database-wide options untouched and works in Database.transaction.
 * The helper owns and finalizes its statement even when execution or conversion
 * fails. A connection with no successful row insert returns 0n.
 * @throws Propagates database, statement, and integer conversion errors.
 */
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
// @endif

// @if better-sqlite3
/** Read the connection insert ID without changing database-wide options. */
export function lastInsertId(database: Database): bigint {
  const row = database.prepare("SELECT last_insert_rowid()").safeIntegers()
    .raw().get() as [SqliteValue] | undefined;
  if (row === undefined) {
    throw new Error("SQLite did not return last_insert_rowid()");
  }
  return integer(row[0]);
}
// @endif

// @if server
import { Buffer } from "node:buffer";

/** Kind names the representation returned by the driver's default type parser. */
export type Kind =
  | "string"
  | "number"
  | "number-or-string"
  | "boolean"
  | "date"
  | "bytes"
  | "buffer"
  | "json"
  | "unknown"
  | "point"
  | "box"
  | "circle"
  | "interval";

/** Codec converts a non-null custom type without changing the connection's parsers. */
export interface Codec<T> {
  encode(value: T): unknown;
  decode(value: unknown): T;
}

/** ExecResult reports changes and, for MySQL, the statement's inserted row ID. */
export interface ExecResult {
  rowsAffected: bigint;
  lastInsertId: bigint | null;
}

/** integerResult rejects driver counts that already lost integer precision. */
export function integerResult(value: number | string | bigint): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError(
      "Driver returned an unsafe integer; enable its big number string options",
    );
  }
  return BigInt(value);
}

/**
 * mysqlInsertIdBigInt rejects mysql2's ambiguous signed OK-packet values.
 * A negative value can represent either an explicit signed primary key or an
 * unsigned ID above 2^63 - 1. The packet and sqlc's catalog do not tell us which;
 * guessing would return the wrong ID for one of those valid table definitions.
 * Callers can declare their ID type to preserve signed values or restore all
 * 64 unsigned bits. This leaves affected-row counts and other drivers unchanged.
 */
export function mysqlInsertIdBigInt(
  value: number | string | bigint,
  unsigned?: boolean,
): bigint {
  const integer = integerResult(value);
  if (integer < -(1n << 63n) || integer >= (1n << 64n)) {
    throw new RangeError(
      "Driver returned an insert ID outside MySQL's 64-bit range",
    );
  }
  if (unsigned === true) return BigInt.asUintN(64, integer);
  if (unsigned === false && integer >= (1n << 63n)) {
    throw new RangeError(
      "Driver returned an insert ID outside MySQL's signed 64-bit range",
    );
  }
  if (integer < 0n && unsigned === undefined) {
    throw new RangeError(
      "mysql2 returned an ambiguous negative insert ID; set mysql2.insert_id_unsigned to match the SQL ID type",
    );
  }
  return integer;
}

/**
 * mysqlInsertId applies the generated API's big-number options to an OK packet.
 * mysql2 decodes insertId with connection options, not the statement's options,
 * and may return a string even though ResultSetHeader declares a number.
 * Normalizing that value here keeps small IDs and large IDs consistent with the
 * declared result type. With support disabled, an unsafe ID throws after the
 * statement has executed; callers should enable support before inserting it.
 */
export function mysqlInsertId(
  value: number | string | bigint,
  supportBigNumbers: false,
  bigNumberStrings: boolean,
  unsigned?: boolean,
): number;
export function mysqlInsertId(
  value: number | string | bigint,
  supportBigNumbers: true,
  bigNumberStrings: true,
  unsigned?: boolean,
): string;
export function mysqlInsertId(
  value: number | string | bigint,
  supportBigNumbers: true,
  bigNumberStrings: false,
  unsigned?: boolean,
): number | string;
export function mysqlInsertId(
  value: number | string | bigint,
  supportBigNumbers: boolean,
  bigNumberStrings: boolean,
  unsigned?: boolean,
): number | string {
  const integer = mysqlInsertIdBigInt(value, unsigned);
  if (supportBigNumbers && bigNumberStrings) return integer.toString();
  const number = Number(integer);
  if (Number.isSafeInteger(number)) return number;
  if (supportBigNumbers) return integer.toString();
  throw new RangeError(
    "Insert ID exceeds JavaScript's safe integer range; enable mysql2.support_big_numbers",
  );
}

/** scalar checks driver output without inventing conversions for custom parsers. */
function scalar(kind: Kind, value: unknown): unknown {
  switch (kind) {
    case "box":
    case "string":
      if (typeof value !== "string") {
        throw new TypeError("Expected a SQL string");
      }
      return value;
    case "number":
      if (typeof value !== "number") {
        throw new TypeError("Expected a SQL number");
      }
      return value;
    case "number-or-string":
      if (typeof value !== "number" && typeof value !== "string") {
        throw new TypeError("Expected a SQL number or string");
      }
      return value;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new TypeError("Expected a SQL boolean");
      }
      return value;
    case "date":
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw new TypeError("Expected a valid Date from the SQL driver");
      }
      return value;
    case "buffer":
      if (!Buffer.isBuffer(value)) throw new TypeError("Expected a SQL Buffer");
      return value;
    case "bytes":
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Expected SQL bytes");
      }
      return value;
    case "point":
    case "circle": {
      if (
        typeof value !== "object" || value === null || !("x" in value) ||
        !("y" in value) ||
        typeof value.x !== "number" || typeof value.y !== "number" ||
        (kind === "circle" &&
          (!("radius" in value) || typeof value.radius !== "number"))
      ) {
        throw new TypeError("Expected a PostgreSQL " + kind);
      }
      return value;
    }
    case "interval":
      if (
        typeof value !== "object" || value === null ||
        !("toPostgres" in value) ||
        typeof value.toPostgres !== "function"
      ) throw new TypeError("Expected a PostgreSQL interval");
      return value;
    case "json":
      return jsonValue(value);
    case "unknown":
      return value;
  }
}

/** Validate parsed JSON without accepting driver-specific scalar values. */
export function jsonValue(value: unknown): JsonValue {
  return checkedJson(value, "Expected a finite JSON number");
}

/** encodeValue maps an omitted nullable argument to SQL NULL before binding. */
function encodeValueUnchecked(
  kind: Kind,
  value: unknown,
  nullable = true,
): unknown {
  if (
    !nullable && (value === undefined || (value === null && kind !== "json"))
  ) {
    throw new TypeError("Missing a non-null argument");
  }
  if (kind === "json" && (value !== null || !nullable) && value !== undefined) {
    const json = JSON.stringify(jsonValue(value));
    if (json === undefined) throw new TypeError("Expected a JSON value");
    if (jsonDriver === "postgres") {
      // postgres.js serializes JSON with the server's inferred parameter OID.
      // Its Bind path sends a bare null as SQL NULL before calling that parser.
      // A non-null object with toJSON keeps required JSON null distinct.
      return value === null ? { toJSON: () => null } : value;
    }
    return json;
  }
  if (value === null || value === undefined) return null;
  const checked = scalar(kind, value);
  // pg serializes ordinary objects as JSON. Its geometric input syntax differs.
  if (kind === "point" || kind === "circle") {
    const point = checked as { x: number; y: number; radius?: number };
    const pair = `(${point.x},${point.y})`;
    return kind === "circle" ? `<${pair},${point.radius}>` : pair;
  }
  return checked;
}

/** decodeValue checks nullability and the default driver representation. */
function decodeValueUnchecked<T>(
  kind: Kind,
  value: unknown,
  nullable: boolean,
  undefinedNull: boolean,
): T {
  if (value === null) {
    if (!nullable && kind !== "json") {
      throw new TypeError("Unexpected SQL NULL in a non-null column");
    }
    // JSON null and SQL NULL share the driver's null value. Preserve JSON null
    // for a NOT NULL JSON column; a nullable column follows the chosen policy.
    return (nullable && undefinedNull ? undefined : null) as T;
  }
  if (value === undefined) {
    throw new TypeError("SQL driver omitted a result value");
  }
  return scalar(kind, value) as T;
}

/** encodeCustom calls a codec only for a present application value. */
function encodeCustomUnchecked<T>(
  codec: Codec<T>,
  value: unknown,
  nullable: boolean,
): unknown {
  if (value === null || value === undefined) {
    if (!nullable) throw new TypeError("Missing a non-null custom argument");
    return null;
  }
  const encoded = codec.encode(value as T);
  if (encoded === undefined || (encoded === null && !nullable)) {
    throw new TypeError("Codec returned no value for a non-null argument");
  }
  return encoded;
}

/** decodeCustom leaves SQL null handling outside the caller's codec. */
function decodeCustomUnchecked<T>(
  codec: Codec<T>,
  value: unknown,
  nullable: boolean,
  undefinedNull: boolean,
): T {
  if (value === null) {
    if (!nullable) {
      throw new TypeError("Unexpected SQL NULL in a non-null custom column");
    }
    return (undefinedNull ? undefined : null) as T;
  }
  if (value === undefined) {
    throw new TypeError("SQL driver omitted a custom result value");
  }
  return codec.decode(value);
}

/** mapArray preserves rank and nullable elements in PostgreSQL arrays. */
function mapArray(
  value: unknown,
  dimensions: number,
  convert: (value: unknown) => unknown,
  undefinedNull: boolean,
): unknown {
  if (value === null || value === undefined) {
    return undefinedNull ? undefined : null;
  }
  if (!Array.isArray(value)) throw new TypeError("Expected a PostgreSQL array");
  return value.map((element: unknown) => {
    if (element === null || element === undefined) {
      return undefinedNull ? undefined : null;
    }
    return dimensions > 1
      ? mapArray(element, dimensions - 1, convert, undefinedNull)
      : convert(element);
  });
}

/** encodeArray binds one PostgreSQL array without expanding SQL placeholders. */
function encodeArrayUnchecked(
  kind: Kind,
  value: unknown,
  dimensions: number,
): unknown {
  const encoded = mapArray(
    value,
    dimensions,
    (element) =>
      kind === "json"
        ? JSON.stringify(jsonValue(element))
        : encodeValue(kind, element),
    false,
  );
  // JSON arrays are scalar elements inside a SQL array. Encoding PostgreSQL
  // array text keeps postgres.js from treating a JSON array as another SQL
  // dimension, while preserving SQL NULL elements and JSON string escaping.
  if (kind === "json") return encodeArrayText(encoded, ",");
  return kind === "box" ? encodeArrayText(encoded, ";") : encoded;
}

/** decodeArray checks the outer column separately from nullable array elements. */
function decodeArrayUnchecked<T>(
  kind: Kind,
  value: unknown,
  dimensions: number,
  nullable: boolean,
  undefinedNull: boolean,
): T {
  if (value === null && !nullable) {
    throw new TypeError("Unexpected SQL NULL array");
  }
  if (value === undefined) throw new TypeError("SQL driver omitted an array");
  const raw = typeof value === "string";
  return mapArray(
    raw ? parseArrayText(value, kind === "box" ? ";" : ",") : value,
    dimensions,
    (element) => raw ? arrayTextScalar(kind, element) : scalar(kind, element),
    undefinedNull,
  ) as T;
}

/** encodeArrayCustom applies a scalar codec to each non-null array element. */
function encodeArrayCustomUnchecked<T>(
  codec: Codec<T>,
  kind: Kind,
  value: unknown,
  dimensions: number,
  nullable: boolean,
): unknown {
  if ((value === null || value === undefined) && !nullable) {
    throw new TypeError("Missing a non-null array");
  }
  const encoded = mapArray(
    value,
    dimensions,
    (element) => encodeCustom(codec, element, true),
    false,
  );
  return kind === "box" ? encodeArrayText(encoded, ";") : encoded;
}

/** decodeArrayCustom preserves null elements while decoding custom array types. */
function decodeArrayCustomUnchecked<T>(
  codec: Codec<unknown>,
  kind: Kind,
  value: unknown,
  dimensions: number,
  nullable: boolean,
  undefinedNull: boolean,
): T {
  if (value === null && !nullable) {
    throw new TypeError("Unexpected SQL NULL array");
  }
  if (value === undefined) throw new TypeError("SQL driver omitted an array");
  const raw = typeof value === "string";
  return mapArray(
    raw ? parseArrayText(value, kind === "box" ? ";" : ",") : value,
    dimensions,
    (element) => codec.decode(raw ? arrayTextScalar(kind, element) : element),
    undefinedNull,
  ) as T;
}

/** parseArrayText reads PostgreSQL's text fallback for unregistered array OIDs.
 * Quoted NULL is text; bare NULL is absent. Escapes and nested arrays must be
 * read before splitting so an enum label may contain commas, braces, or quotes.
 * The optional [lower:upper] prefix carries bounds that JavaScript arrays omit.
 */
export function parseArrayText(text: string, delimiter = ","): unknown[] {
  let offset = 0;
  const bounds = /^(?:\[-?\d+:-?\d+\])+=/.exec(text);
  if (bounds !== null) offset = bounds[0].length;
  const whitespace = () => {
    while (/\s/.test(text[offset] ?? "") && offset < text.length) offset++;
  };
  const read = (): unknown[] => {
    whitespace();
    if (text[offset++] !== "{") {
      throw new TypeError("Invalid PostgreSQL array text");
    }
    const values: unknown[] = [];
    whitespace();
    if (text[offset] === "}") {
      offset++;
      return values;
    }
    while (offset < text.length) {
      whitespace();
      if (text[offset] === "{") values.push(read());
      else {
        let value = "";
        const quoted = text[offset] === '"';
        if (quoted) offset++;
        let closed = !quoted;
        while (offset < text.length) {
          const char = text[offset];
          if (char === "\\") {
            offset++;
            if (offset >= text.length) {
              throw new TypeError("Incomplete PostgreSQL array escape");
            }
            value += text[offset++];
          } else if (quoted && char === '"') {
            offset++;
            closed = true;
            break;
          } else if (!quoted && (char === delimiter || char === "}")) break;
          else {
            value += char;
            offset++;
          }
        }
        if (!closed) throw new TypeError("Unclosed PostgreSQL array string");
        if (!quoted) value = value.trim();
        if (!quoted && value === "") {
          throw new TypeError("Empty PostgreSQL array element");
        }
        values.push(!quoted && value === "NULL" ? null : value);
      }
      whitespace();
      const separator = text[offset++];
      if (separator === "}") return values;
      if (separator !== delimiter) {
        throw new TypeError("Invalid PostgreSQL array separator");
      }
    }
    throw new TypeError("Unclosed PostgreSQL array");
  };
  const result = read();
  whitespace();
  if (offset !== text.length) {
    throw new TypeError("Trailing PostgreSQL array text");
  }
  return result;
}

/** arrayTextScalar decodes elements only when the driver returned raw array text. */
function arrayTextScalar(kind: Kind, value: unknown): unknown {
  if (typeof value !== "string") return scalar(kind, value);
  switch (kind) {
    case "number":
      return scalar(kind, Number(value));
    case "boolean":
      if (value !== "t" && value !== "f") {
        throw new TypeError("Invalid PostgreSQL array boolean");
      }
      return value === "t";
    case "date":
      return scalar(kind, new Date(value));
    case "buffer":
      if (!value.startsWith("\\x")) {
        throw new TypeError("Expected hexadecimal PostgreSQL bytea");
      }
      return Buffer.from(value.slice(2), "hex");
    case "json":
      return jsonValue(JSON.parse(value));
    case "point":
    case "circle": {
      const match = kind === "point"
        ? /^\(([^,]+),([^,]+)\)$/.exec(value)
        : /^<\(([^,]+),([^,]+)\),([^>]+)>$/.exec(value);
      if (match === null) {
        throw new TypeError("Invalid PostgreSQL geometry array element");
      }
      const point = { x: Number(match[1]), y: Number(match[2]) };
      return kind === "circle" ? { ...point, radius: Number(match[3]) } : point;
    }
    default:
      return scalar(kind, value);
  }
}

/** encodeArrayText supplies PostgreSQL array syntax when a type uses a delimiter
 * the pg driver's generic array serializer does not support (notably box[]).
 * Each scalar is quoted and escaped; a null element stays the SQL NULL token.
 */
function encodeArrayText(value: unknown, delimiter: string): string | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new TypeError("Expected a PostgreSQL array");
  return "{" + value.map((item: unknown): string => {
    if (item === null) return "NULL";
    if (Array.isArray(item)) return encodeArrayText(item, delimiter)!;
    return '"' + String(item).replaceAll("\\", "\\\\").replaceAll('"', '\\"') +
      '"';
  }).join(delimiter) + "}";
}

type DriverValue = unknown;
type DriverCodec<T> = Codec<T>;

export function encodeArray(
  kind: Kind,
  value: unknown,
  dimensions: number,
  nullable = true,
  context?: CodecContext,
): unknown {
  return withCodecContext(
    context,
    "encode",
    () => {
      if (!nullable && (value === null || value === undefined)) {
        throw new TypeError("Missing a non-null array");
      }
      return encodeArrayUnchecked(kind, value, dimensions);
    },
  );
}

export function decodeArray<T>(
  kind: Kind,
  value: unknown,
  dimensions: number,
  nullable: boolean,
  undefinedNull: boolean,
  context?: CodecContext,
): T {
  return withCodecContext(
    context,
    "decode",
    () =>
      decodeArrayUnchecked<T>(kind, value, dimensions, nullable, undefinedNull),
  );
}

export function encodeArrayCustom<T>(
  codec: Codec<T>,
  kind: Kind,
  value: unknown,
  dimensions: number,
  nullable: boolean,
  context?: CodecContext,
): unknown {
  return withCodecContext(
    context,
    "encode",
    () => encodeArrayCustomUnchecked(codec, kind, value, dimensions, nullable),
  );
}

export function decodeArrayCustom<T, Element = unknown>(
  codec: Codec<Element>,
  kind: Kind,
  value: unknown,
  dimensions: number,
  nullable: boolean,
  undefinedNull: boolean,
  context?: CodecContext,
): T {
  return withCodecContext(
    context,
    "decode",
    () =>
      decodeArrayCustomUnchecked<T>(
        codec,
        kind,
        value,
        dimensions,
        nullable,
        undefinedNull,
      ),
  );
}
// @endif

/** Converts an argument with optional generated query diagnostics. */
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

/** Converts a result with optional generated query diagnostics. */
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

/** Converts custom arguments without exposing codec errors to normal logging. */
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

/** Converts custom results without exposing codec errors to normal logging. */
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
