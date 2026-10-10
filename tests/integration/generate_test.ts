import { test } from "node:test";
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
for (const runtime of ["node", "bun"]) {
  for (const driver of ["pg", "postgres", "mysql2", "better-sqlite3"]) {
    const engine =
      driver === "mysql2"
        ? "mysql"
        : driver === "better-sqlite3"
          ? "sqlite"
          : "postgresql";
    cases.push({ name: `${runtime}-${driver}`, engine, runtime, driver });
  }
}
const jsonOverrides = {
  overrides: [
    {
      column: "records.document",
      ts_type: "Document",
      import: { path: "../../../json_domain.ts", name: "Document" },
    },
  ],
};
cases.push(
  {
    name: "ergonomics-better-sqlite3",
    engine: "sqlite",
    runtime: "node",
    driver: "better-sqlite3",
    fixture: "ergonomics",
    extra: ergonomicsOptions(),
  },
  {
    name: "ergonomics-node-sqlite",
    engine: "sqlite",
    runtime: "node",
    driver: "node:sqlite",
    fixture: "ergonomics",
    extra: ergonomicsOptions(),
  },
  ...["node", "bun"].map((runtime) => ({
    name: runtime === "node" ? "node-sqlite" : `${runtime}-node-sqlite`,
    engine: "sqlite",
    runtime,
    driver: "node:sqlite",
  })),
  {
    name: "bun-sqlite",
    engine: "sqlite",
    runtime: "bun",
    driver: "bun:sqlite",
  },
  {
    name: "bun-sqlite-undefined",
    engine: "sqlite",
    runtime: "bun",
    driver: "bun:sqlite",
    extra: {
      emit_null_as_undefined: true,
      optional_nullable_args: true,
    },
  },
  {
    name: "bun-sqlite-ergonomics",
    engine: "sqlite",
    runtime: "bun",
    driver: "bun:sqlite",
    fixture: "ergonomics",
    extra: ergonomicsOptions(),
  },
  {
    name: "undefined-node-sqlite",
    engine: "sqlite",
    runtime: "node",
    driver: "node:sqlite",
    extra: {
      emit_null_as_undefined: true,
      optional_nullable_args: true,
    },
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
    name: "undefined",
    engine: "sqlite",
    runtime: "node",
    driver: "node:sqlite",
    extra: {
      emit_null_as_undefined: true,
      emit_sql_as_const: false,
    },
  },
  {
    name: "types-only",
    engine: "sqlite",
    runtime: "node",
    driver: "node:sqlite",
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

test("stock sqlc generates all driver and option fixtures", async (t) => {
  await run(sqlc, ["version"]);
  await generate(
    output,
    cases.map((tc) =>
      block(
        tc.engine,
        tc.fixture ?? tc.engine,
        output,
        {
          runtime: tc.runtime,
          driver: tc.driver,
          emit_query_factory: true,
          ...tc.extra,
        },
        tc.name,
      ),
    ),
  );
  for (const tc of cases) {
    await t.test(tc.name, async () => {
      const generated = await compareBuilds(join(output, tc.name));
      assert(
        Object.keys(generated).length >= 3,
        "expected model, query and index files",
      );
      assert(generated["models.ts"]);
      assert(generated["index.ts"]);
      if (tc.extra?.types_only) {
        assert(!Object.keys(generated).some((name) => /^runtime_/.test(name)));
        assert(!generated["query_helpers.ts"]?.includes("export function"));
        assert(!generated["query_helpers.ts"]?.includes("./runtime_"));
        assert(!generated["query_sql.ts"]?.includes("export function"));
      }
      if (tc.name.startsWith("enum-")) assert(generated["enums.ts"]);
      if (tc.driver === "bun:sqlite") {
        assert.match(generated["runtime_sqlite.ts"]!, /from "bun:sqlite"/);
        assert(!generated["runtime_sqlite.ts"]!.includes("setReadBigInts"));
        assert(!generated["runtime_sqlite.ts"]!.includes("setReturnArrays"));
        assert(!generated["query_sql.ts"]!.includes("export async function"));
      }
      if (tc.driver === "node:sqlite" && !tc.extra?.types_only) {
        assert.match(generated["runtime_sqlite.ts"]!, /from "node:sqlite"/);
        assert.match(generated["runtime_sqlite.ts"]!, /DatabaseSync/);
        assert(!generated["query_sql.ts"]!.includes("export async function"));
      }
    });
  }
  for (const driver of ["pg", "postgres", "mysql2", "better-sqlite3"]) {
    await t.test(`Node and Bun output matches: ${driver}`, async () => {
      assert.deepEqual(
        await files(join(output, `node-${driver}`, "wasm")),
        await files(join(output, `bun-${driver}`, "wasm")),
      );
    });
  }
  for (const runtime of ["bun"]) {
    await t.test(`Node and ${runtime} node:sqlite output matches`, async () => {
      assert.deepEqual(
        await files(join(output, "node-sqlite", "wasm")),
        await files(join(output, `${runtime}-node-sqlite`, "wasm")),
      );
    });
  }
});
