/** JsonValue is a parsed JSON value, including the JSON literal null.
 * SQL NOT NULL does not exclude JSON null. JSON numbers use JavaScript numbers;
 * use a codec when the application needs exact decimal or large-integer values.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonArray;

/** JsonObject has string keys whose values are valid JSON values. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** JsonArray preserves the order and value of each JSON array element. */
export type JsonArray = JsonValue[];
