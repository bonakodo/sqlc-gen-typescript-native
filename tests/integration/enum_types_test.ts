// deno-lint-ignore-file require-await -- Driver stubs must return promises, including thrown failures.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ArchiveStatusValues,
  StatusValues,
  UnusedLabelValues,
} from "./.generated/enum-pg/wasm/index.ts";
import type {
  Account,
  ArchiveStatus,
  Status,
  UnusedLabel,
} from "./.generated/enum-pg/wasm/index.ts";
import { StatusValues as DirectStatusValues } from "./.generated/enum-pg/wasm/enums.ts";
import {
  createAccount,
  getAccount,
} from "./.generated/enum-pg/wasm/query_sql.ts";
import type {
  CreateAccountArgs,
  CreateAccountRow,
  GetAccountRow,
} from "./.generated/enum-pg/wasm/query_sql.ts";
import type { Database } from "./.generated/enum-pg/wasm/runtime.ts";
import * as TypesOnly from "./.generated/enum-types-only/wasm/index.ts";
import type {
  Account as TypesOnlyAccount,
  Status as TypesOnlyStatus,
} from "./.generated/enum-types-only/wasm/index.ts";
import type {
  CreateAccountArgs as TypesOnlyArgs,
  GetAccountRow as TypesOnlyRow,
} from "./.generated/enum-types-only/wasm/query_sql.ts";

/** TS7 checks tuple inference, plain strings, nullability, and enum arrays. */
export function enumAssignments(
  args: CreateAccountArgs,
  row: CreateAccountRow,
  selected: GetAccountRow,
  typesOnlyArgs: TypesOnlyArgs,
  typesOnlyRow: TypesOnlyRow,
): readonly unknown[] {
  const first: "active" = StatusValues[0];
  const status: Status = "active";
  const archive: ArchiveStatus = "archived";
  const unused: UnusedLabel = "can't";
  const statuses: readonly Status[] = StatusValues;
  const model: Account = row;
  const selectedModel: Account = selected;
  const nullable: Status | null = args.previousStatus;
  const history: ReadonlyArray<Status | null> = args.statusHistory;
  const typesOnlyStatus: TypesOnlyStatus = status;
  const typesOnlyModel: TypesOnlyAccount = typesOnlyRow;
  const typesOnlyHistory: ReadonlyArray<Status | null> =
    typesOnlyArgs.statusHistory;

  // @ts-expect-error Enum values retain the database's exact labels.
  const invalid: Status = "unknown";
  // @ts-expect-error Values from another schema's enum are distinct.
  const wrongSchema: Status = archive;
  // @ts-expect-error The required enum does not accept SQL NULL.
  const invalidNull: Account["status"] = null;
  // @ts-expect-error A nullable enum cannot pass as a required enum.
  const required: Status = args.previousStatus;
  // @ts-expect-error Array elements retain the enum's exact labels.
  const invalidHistory: CreateAccountArgs["statusHistory"] = ["unknown"];
  // @ts-expect-error types_only keeps the same strict enum type.
  const invalidTypesOnly: TypesOnlyStatus = "unknown";
  // @ts-expect-error as const makes the value list read-only to TypeScript.
  StatusValues.push("active");

  return [
    first,
    status,
    archive,
    unused,
    statuses,
    model,
    selectedModel,
    nullable,
    history,
    typesOnlyStatus,
    typesOnlyModel,
    typesOnlyHistory,
    invalid,
    wrongSchema,
    invalidNull,
    required,
    invalidHistory,
    invalidTypesOnly,
  ];
}

test("enum exports retain ordered labels and share one value list", () => {
  assert.deepEqual(StatusValues, ["active", "inactive"]);
  assert.equal(StatusValues, DirectStatusValues);
  assert.deepEqual(ArchiveStatusValues, ["archived", "deleted"]);
  assert.deepEqual(UnusedLabelValues, ["needs review", "can't", ""]);
});

test("types_only exports enum values without query or database runtime exports", () => {
  assert.deepEqual(TypesOnly.StatusValues, StatusValues);
  assert.deepEqual(TypesOnly.ArchiveStatusValues, ArchiveStatusValues);
  assert.deepEqual(TypesOnly.UnusedLabelValues, UnusedLabelValues);
  assert.deepEqual(Object.keys(TypesOnly).sort(), [
    "ArchiveStatusValues",
    "StatusValues",
    "UnusedLabelValues",
  ]);
});

test("enum query arguments and rows retain plain string values", async () => {
  const args: CreateAccountArgs = {
    id: 1,
    status: "active",
    previousStatus: null,
    statusHistory: ["inactive", null, "active"],
    archivedStatus: "archived",
  };
  const expected: Account = { ...args };
  const calls: unknown[] = [];
  const database: Database = {
    async query(config) {
      calls.push(config.values);
      return {
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [[1, "active", null, ["inactive", null, "active"], "archived"]],
      };
    },
  };
  assert.deepEqual(await createAccount(database, args), expected);
  assert.deepEqual(calls[0], [
    1,
    "active",
    null,
    ["inactive", null, "active"],
    "archived",
  ]);
  assert.deepEqual(await getAccount(database, { id: 1 }), expected);
});
