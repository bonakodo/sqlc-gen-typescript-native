import assert from "node:assert/strict";
import { join } from "node:path";
import {
  block,
  compareBuilds,
  files,
  generate,
  type Options,
  output,
  run,
  sqlc,
} from "./generation_helpers.ts";

function ergonomicsOptions(): Options {
  return {
    sqlite_type_mode: "native",
    emit_query_factory: true,
    optional_nullable_args: true,
    type_mappings: {
      timestamp: { preset: "epoch_milliseconds" },
      settings: { preset: "json_text" },
    },
    overrides: [
      { db_type: "integer", nullable_all: true, preset: "safe_integer" },
      {
        columns: ["authors.created_at", "records.expires_at"],
        mapping: "timestamp",
      },
      { column: "authors.active", preset: "sqlite_boolean" },
      { column: "authors.settings", mapping: "settings" },
    ],
    query_overrides: [
      {
        query: "GetLatestExpiry",
        column: "latestExpiry",
        mapping: "timestamp",
        nullable: true,
      },
      {
        query: "GetDisplayName",
        column: "displayName",
        ts_type: "string",
        nullable: false,
      },
      {
        query: "HasStarted",
        parameter: "nowMillis",
        mapping: "timestamp",
        nullable: false,
      },
      {
        query: "HasStarted",
        column: "started",
        preset: "sqlite_boolean",
        nullable: false,
      },
    ],
  };
}

interface Case {
  name: string;
  engine: string;
  runtime: string;
  driver: string;
  fixture?: string;
  extra?: Options;
}
const cases: Case[] = [];
for (const runtime of ["node", "bun", "deno"]) {
  for (const driver of ["pg", "postgres", "mysql2", "better-sqlite3"]) {
    const engine = driver === "mysql2"
      ? "mysql"
      : driver === "better-sqlite3"
      ? "sqlite"
      : "postgresql";
    cases.push({ name: `${runtime}-${driver}`, engine, runtime, driver });
  }
}
const jsonOverrides = {
  overrides: [{
    column: "records.document",
    ts_type: "Document",
    import: { path: "../../../json_domain.ts", name: "Document" },
  }],
};
cases.push(
  {
    name: "ergonomics-db-sqlite",
    engine: "sqlite",
    runtime: "deno",
    driver: "@bonakodo/sqlite",
    fixture: "ergonomics",
    extra: ergonomicsOptions(),
  },
  {
    name: "ergonomics-better-sqlite3",
    engine: "sqlite",
    runtime: "node",
    driver: "better-sqlite3",
    fixture: "ergonomics",
    extra: ergonomicsOptions(),
  },
  {
    name: "embed-pg",
    engine: "postgresql",
    runtime: "node",
    driver: "pg",
    fixture: "stock_embed",
  },
  {
    name: "embed-sqlite",
    engine: "sqlite",
    runtime: "node",
    driver: "better-sqlite3",
    fixture: "stock_embed_sqlite",
  },
  {
    name: "enum-pg",
    engine: "postgresql",
    runtime: "node",
    driver: "pg",
    fixture: "enums",
  },
  {
    name: "enum-types-only",
    engine: "postgresql",
    runtime: "node",
    driver: "pg",
    fixture: "enums",
    extra: { types_only: true },
  },
  {
    name: "deno-db-sqlite",
    engine: "sqlite",
    runtime: "deno",
    driver: "@bonakodo/sqlite",
  },
  {
    name: "native-db-sqlite",
    engine: "sqlite",
    runtime: "deno",
    driver: "@bonakodo/sqlite",
    extra: { sqlite_type_mode: "native" },
  },
  {
    name: "native-better-sqlite3",
    engine: "sqlite",
    runtime: "node",
    driver: "better-sqlite3",
    extra: { sqlite_type_mode: "native" },
  },
  {
    name: "undefined",
    engine: "sqlite",
    runtime: "deno",
    driver: "@bonakodo/sqlite",
    extra: {
      emit_null_as_undefined: true,
      emit_sql_as_const: false,
      sqlite_type_mode: "native",
    },
  },
  {
    name: "types-only",
    engine: "sqlite",
    runtime: "deno",
    driver: "@bonakodo/sqlite",
    extra: { types_only: true },
  },
  {
    name: "json-custom",
    engine: "postgresql",
    runtime: "node",
    driver: "pg",
    extra: jsonOverrides,
  },
  {
    name: "json-types-only",
    engine: "postgresql",
    runtime: "node",
    driver: "pg",
    extra: { types_only: true, ...jsonOverrides },
  },
  {
    name: "mysql-strings",
    engine: "mysql",
    runtime: "node",
    driver: "mysql2",
    extra: { mysql2: { support_big_numbers: true, big_number_strings: true } },
  },
  {
    name: "mysql-mixed",
    engine: "mysql",
    runtime: "node",
    driver: "mysql2",
    extra: { mysql2: { support_big_numbers: true } },
  },
);

Deno.test("stock sqlc generates all driver and option fixtures", async (t) => {
  await run(sqlc, ["version"]);
  await generate(
    output,
    cases.map((tc) =>
      block(tc.engine, tc.fixture ?? tc.engine, output, {
        runtime: tc.runtime,
        driver: tc.driver,
        emit_query_factory: true,
        ...tc.extra,
      }, tc.name)
    ),
  );
  for (const tc of cases) {
    await t.step(tc.name, async () => {
      const generated = await compareBuilds(join(output, tc.name));
      assert(
        Object.keys(generated).length >= 3,
        "expected model, query and index files",
      );
      assert(generated["models.ts"]);
      assert(generated["index.ts"]);
      if (tc.extra?.types_only) {
        assert(!generated["runtime.ts"]);
        assert(!generated["query_sql.ts"]?.includes("export function"));
      }
      if (tc.name.startsWith("enum-")) assert(generated["enums.ts"]);
    });
  }
  for (const driver of ["pg", "postgres", "mysql2", "better-sqlite3"]) {
    await t.step(`Node and Bun output matches: ${driver}`, async () => {
      assert.deepEqual(
        await files(join(output, `node-${driver}`, "wasm")),
        await files(join(output, `bun-${driver}`, "wasm")),
      );
    });
  }
});
