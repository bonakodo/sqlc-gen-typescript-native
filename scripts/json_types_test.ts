import type {
  JsonArray,
  JsonObject,
  JsonValue,
} from "./.integration/node-pg/wasm/index.ts";
import type { GetRecordRow } from "./.integration/node-pg/wasm/query_sql.ts";
import type { GetRecordRow as CustomRow } from "./.integration/json-custom/wasm/query_sql.ts";
import type { GetRecordRow as TypesOnlyRow } from "./.integration/json-types-only/wasm/query_sql.ts";
import type { Document } from "./json_domain.ts";

type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertFalse<T extends false> = T;

/** Compilation fails if default server JSON ever becomes any again. */
export type JSONIsTyped = AssertFalse<IsAny<GetRecordRow["document"]>>;

export const jsonObject: JsonObject = { name: "Ada", nested: [1, true, null] };
export const jsonArray: JsonArray = [jsonObject, "value", null];
export const jsonValue: JsonValue = jsonArray;
export const jsonNull: JsonValue = null;

// @ts-expect-error JSON cannot contain undefined.
export const badUndefined: JsonValue = { value: undefined };
// @ts-expect-error JSON cannot contain bigint.
export const badBigint: JsonValue = { value: 1n };
// @ts-expect-error Date needs an explicit conversion to a JSON value.
export const badDate: JsonValue = new Date();
// @ts-expect-error Default JSON cannot be assigned to a string without checking.
export const badString: string = jsonValue;

export const document: Document = { title: "Typed JSON", tags: ["sqlc"] };
export const customDocument: CustomRow["document"] = document;
export const typesOnlyDocument: TypesOnlyRow["document"] = document;

// @ts-expect-error The custom shape retains its required fields.
export const badCustomDocument: CustomRow["document"] = {
  title: "Missing tags",
};

/** A domain interface without an index signature survives types_only output. */
export function documentTitle(value: TypesOnlyRow["document"]): string | null {
  return value === null ? null : value.title;
}
