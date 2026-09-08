/** Each @part names a declaration; @when gates individual conversion kinds. */

// @part Database


// @part Kind common.Kind
export type { Kind } from "./runtime_common.ts";

// @part Codec common.Codec
export type { Codec } from "./runtime_common.ts";

// @part ExecResult common.ExecResult
export type { ExecResult } from "./runtime_common.ts";

// @part integerResult common.integerResult
import { integerResult } from "./runtime_common.ts";
export { integerResult };

// @part mysqlInsertIdBigInt
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

// @part mysqlInsertId
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

// @part jsonValue common.jsonValue
export { jsonValue } from "./runtime_common.ts";

// @part encodeValue common.encodeValue
export { encodeValue } from "./runtime_common.ts";

// @part decodeValue common.decodeValue
export { decodeValue } from "./runtime_common.ts";

// @part encodeCustom common.encodeCustom
export { encodeCustom } from "./runtime_common.ts";

// @part decodeCustom common.decodeCustom
export { decodeCustom } from "./runtime_common.ts";
