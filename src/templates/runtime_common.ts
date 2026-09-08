/** Each @part names a declaration; @when gates individual conversion kinds. */

// @part JsonValue
import type { JsonValue } from "./json.ts";

// @part CodecContext
import type { CodecContext } from "./codec_error.ts";
export type { CodecContext };

// @part withCodecContext
import { withCodecContext } from "./codec_error.ts";
export { withCodecContext };

// @part QueryCodecError
export { QueryCodecError } from "./codec_error.ts";

// @part encodeSlice
export { encodeSlice } from "./codec_error.ts";

// @part checkedJson
export function checkedJson(
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

// @part QueryContext
export type { QueryContext } from "./codec_error.ts";

// @part FieldContext
export type { FieldContext } from "./codec_error.ts";

// @part codecContext
export { codecContext } from "./codec_error.ts";

// @part Buffer @pg @postgres @mysql2
import { Buffer } from "node:buffer";

// @part jsonDriver @pg @mysql2
const jsonDriver: string = "generic";

// @part jsonDriver @postgres
const jsonDriver: string = "postgres";

// @part Kind @pg @postgres @mysql2 postgresql.Kind mysql.Kind
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

// @part Codec @pg @postgres @mysql2 postgresql.Codec mysql.Codec
export interface Codec<T> {
  encode(value: T): unknown;
  decode(value: unknown): T;
}

// @part ExecResult @pg @postgres @mysql2 postgresql.ExecResult mysql.ExecResult
export interface ExecResult {
  rowsAffected: bigint;
  lastInsertId: bigint | null;
}

// @part integerResult @pg @postgres @mysql2 postgresql.integerResult mysql.integerResult
export function integerResult(value: number | string | bigint): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError(
      "Driver returned an unsafe integer; enable its big number string options",
    );
  }
  return BigInt(value);
}

// @part scalar @pg @postgres @mysql2
export function scalar(kind: Kind, value: unknown): unknown {
  switch (kind) {
// @when box string
    case "box":
    case "string":
      if (typeof value !== "string") {
        throw new TypeError("Expected a SQL string");
      }
      return value;
// @endwhen
// @when number
    case "number":
      if (typeof value !== "number") {
        throw new TypeError("Expected a SQL number");
      }
      return value;
// @endwhen
// @when number-or-string
    case "number-or-string":
      if (typeof value !== "number" && typeof value !== "string") {
        throw new TypeError("Expected a SQL number or string");
      }
      return value;
// @endwhen
// @when boolean
    case "boolean":
      if (typeof value !== "boolean") {
        throw new TypeError("Expected a SQL boolean");
      }
      return value;
// @endwhen
// @when date
    case "date":
      if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw new TypeError("Expected a valid Date from the SQL driver");
      }
      return value;
// @endwhen
// @when buffer
    case "buffer":
      if (!Buffer.isBuffer(value)) throw new TypeError("Expected a SQL Buffer");
      return value;
// @endwhen
// @when bytes
    case "bytes":
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Expected SQL bytes");
      }
      return value;
// @endwhen
// @when point circle
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
// @endwhen
// @when interval
    case "interval":
      if (
        typeof value !== "object" || value === null ||
        !("toPostgres" in value) ||
        typeof value.toPostgres !== "function"
      ) throw new TypeError("Expected a PostgreSQL interval");
      return value;
// @endwhen
// @when json
    case "json":
      return jsonValue(value);
// @endwhen
// @when unknown
    case "unknown":
      return value;
// @endwhen
  }
  throw new TypeError("SQL kind is not used by these queries: " + kind);
}

// @part jsonValue @pg @postgres @mysql2 postgresql.jsonValue mysql.jsonValue
export function jsonValue(value: unknown): JsonValue {
  return checkedJson(value, "Expected a finite JSON number");
}

// @part encodeValueUnchecked @pg @postgres @mysql2
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
// @when json
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
// @endwhen
  if (value === null || value === undefined) return null;
  const checked = scalar(kind, value);
  // pg serializes ordinary objects as JSON. Its geometric input syntax differs.
// @when point circle
  if (kind === "point" || kind === "circle") {
    const point = checked as { x: number; y: number; radius?: number };
    const pair = `(${point.x},${point.y})`;
    return kind === "circle" ? `<${pair},${point.radius}>` : pair;
  }
// @endwhen
  return checked;
  throw new TypeError("SQL kind is not used by these queries: " + kind);
}

// @part decodeValueUnchecked @pg @postgres @mysql2
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

// @part encodeCustomUnchecked @pg @postgres @mysql2
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

// @part decodeCustomUnchecked @pg @postgres @mysql2
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

// @part DriverValue @pg @postgres @mysql2
type DriverValue = unknown;

// @part DriverCodec @pg @postgres @mysql2
type DriverCodec<T> = Codec<T>;

// @part encodeValue @pg @postgres @mysql2 postgresql.encodeValue mysql.encodeValue
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

// @part decodeValue @pg @postgres @mysql2 postgresql.decodeValue mysql.decodeValue
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

// @part encodeCustom @pg @postgres @mysql2 postgresql.encodeCustom mysql.encodeCustom
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

// @part decodeCustom @pg @postgres @mysql2 postgresql.decodeCustom mysql.decodeCustom
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
