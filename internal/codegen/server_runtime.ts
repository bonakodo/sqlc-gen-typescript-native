import { Buffer } from "node:buffer";
import type { JsonValue } from "./json.ts";

// The generator selects the JSON binding contract without changing driver parsers.
const jsonDriver: string = "generic";

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

/** jsonValue checks JSON recursively before a generated type assertion.
 * Rejecting unsupported nested values prevents JSON.stringify from silently
 * dropping undefined properties, turning non-finite numbers into null, or
 * invoking a class's toJSON method. Ancestor tracking rejects cycles while
 * allowing the same object to appear in more than one part of a document.
 */
export function jsonValue(value: unknown): JsonValue {
  const ancestors = new Set<object>();
  const visit = (item: unknown): void => {
    if (
      item === null || typeof item === "string" || typeof item === "boolean"
    ) {
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        throw new TypeError("Expected a finite JSON number");
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

/** encodeValue maps an omitted nullable argument to SQL NULL before binding. */
export function encodeValue(
  kind: Kind,
  value: unknown,
  nullable = true,
): unknown {
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
export function decodeValue<T>(
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
export function encodeCustom<T>(
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
export function decodeCustom<T>(
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
export function encodeArray(
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
export function decodeArray<T>(
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
export function encodeArrayCustom<T>(
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
export function decodeArrayCustom<T>(
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
