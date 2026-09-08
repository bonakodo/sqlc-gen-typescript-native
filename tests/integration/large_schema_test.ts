import assert from "node:assert/strict";
import { join } from "node:path";
import {
  compareBuilds,
  generate,
  type Options,
  output,
} from "./generation_helpers.ts";

// Submit one complete request: splitting it would hide capacity regressions.
Deno.test("stock sqlc handles 100 tables, 800 queries and 202 overrides in one request", async () => {
  const directory = join(output, "large-schema");
  await Deno.mkdir(join(directory, "queries"), { recursive: true });
  const overrides: Options[] = [
    { db_type: "integer", nullable_all: true, preset: "safe_integer" },
    { column: "*.active", preset: "sqlite_boolean" },
  ];
  let schema = "";
  for (let table = 0; table < 100; table++) {
    const name = `entries_${String(table).padStart(3, "0")}`;
    schema +=
      `CREATE TABLE ${name} (id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, active INTEGER NOT NULL, settings TEXT NOT NULL, notes TEXT`;
    for (let column = 0; column < 12; column++) {
      schema += `, field_${String(column).padStart(2, "0")} TEXT`;
    }
    schema += ");\n";
    overrides.push({
      column: `${name}.created_at`,
      preset: "epoch_milliseconds",
    }, { column: `${name}.settings`, preset: "json_text" });
    let queries = "";
    for (let query = 0; query < 8; query++) {
      queries += `-- name: ReadEntry${
        String(table).padStart(3, "0")
      }Page${query} :many\nSELECT * FROM ${name} WHERE id > sqlc.arg('afterId') AND active = sqlc.arg('active') ORDER BY id LIMIT sqlc.arg('limit');\n\n`;
    }
    await Deno.writeTextFile(
      join(directory, "queries", `${name}.sql`),
      queries,
    );
  }
  await Deno.writeTextFile(join(directory, "schema.sql"), schema);
  const options = {
    runtime: "deno",
    driver: "@bonakodo/sqlite",
    sqlite_type_mode: "native",
    overrides,
    emit_query_factory: true,
  };
  await generate(directory, [{
    engine: "sqlite",
    schema: "schema.sql",
    queries: "queries",
    codegen: ["wasm", "raw"].map((plugin) => ({
      plugin,
      out: plugin,
      options,
    })),
  }]);
  const generated = await compareBuilds(directory);
  assert.equal(
    Object.keys(generated).filter((name) => /^entries_\d+_sql\.ts$/.test(name))
      .length,
    100,
  );
  assert.equal(
    Object.values(generated).join("\n").match(
      /export function readEntry\d+Page\d+\(/g,
    )?.length,
    800,
  );
});
