/** Each @part names a declaration; @when gates individual conversion kinds. */

// @part Database


// @part DriverParameters @postgres


// @part CodecContext common.CodecContext
import type { CodecContext } from "./runtime_common.ts";

// @part withCodecContext common.withCodecContext
import { withCodecContext } from "./runtime_common.ts";

// @part Buffer
import { Buffer } from "node:buffer";

// @part Kind common.Kind
import type { Kind } from "./runtime_common.ts";
export type { Kind };

// @part Codec common.Codec
import type { Codec } from "./runtime_common.ts";
export type { Codec };

// @part ExecResult common.ExecResult
export type { ExecResult } from "./runtime_common.ts";

// @part integerResult common.integerResult
export { integerResult } from "./runtime_common.ts";

// @part scalar common.scalar
import { scalar } from "./runtime_common.ts";

// @part jsonValue common.jsonValue
import { jsonValue } from "./runtime_common.ts";
export { jsonValue };

// @part mapArray
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

// @part encodeArrayUnchecked
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

// @part decodeArrayUnchecked
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

// @part encodeArrayCustomUnchecked
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

// @part decodeArrayCustomUnchecked
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

// @part parseArrayText
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

// @part arrayTextScalar
function arrayTextScalar(kind: Kind, value: unknown): unknown {
  if (typeof value !== "string") return scalar(kind, value);
  switch (kind) {
// @when number
    case "number":
      return scalar(kind, Number(value));
// @endwhen
// @when boolean
    case "boolean":
      if (value !== "t" && value !== "f") {
        throw new TypeError("Invalid PostgreSQL array boolean");
      }
      return value === "t";
// @endwhen
// @when date
    case "date":
      return scalar(kind, new Date(value));
// @endwhen
// @when buffer
    case "buffer":
      if (!value.startsWith("\\x")) {
        throw new TypeError("Expected hexadecimal PostgreSQL bytea");
      }
      return Buffer.from(value.slice(2), "hex");
// @endwhen
// @when json
    case "json":
      return jsonValue(JSON.parse(value));
// @endwhen
// @when point circle
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
// @endwhen
    default:
      return scalar(kind, value);
  }
}

// @part encodeArrayText
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

// @part encodeArray
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

// @part decodeArray
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

// @part encodeArrayCustom
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

// @part decodeArrayCustom
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

// @part encodeValue common.encodeValue
import { encodeValue } from "./runtime_common.ts";
export { encodeValue };

// @part decodeValue common.decodeValue
export { decodeValue } from "./runtime_common.ts";

// @part encodeCustom common.encodeCustom
import { encodeCustom } from "./runtime_common.ts";
export { encodeCustom };

// @part decodeCustom common.decodeCustom
export { decodeCustom } from "./runtime_common.ts";
