import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compareBuilds, generate, output } from "./generation_helpers.ts";

type Query = (database: unknown, args?: Record<string, unknown>) => unknown;

async function fixture(driver: string, undefinedNull = false) {
  const engine = driver === "@bonakodo/sqlite" || driver === "better-sqlite3"
    ? "sqlite"
    : driver === "mysql2"
    ? "mysql"
    : "postgresql";
  const directory = join(
    output,
    `execution-${driver.replaceAll(/\W/g, "")}-${undefinedNull}`,
  );
  await Deno.remove(directory, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeTextFile(
    join(directory, "schema.sql"),
    "CREATE TABLE entries (id INTEGER PRIMARY KEY, value INTEGER NOT NULL);",
  );
  await Deno.writeTextFile(
    join(directory, "query.sql"),
    `-- name: ReadValue :one
SELECT value FROM entries WHERE id = sqlc.arg('id');
-- name: ReadValues :many
SELECT value FROM entries WHERE id = sqlc.arg('id');
-- name: WriteValue :exec
UPDATE entries SET value = sqlc.arg('value');
-- name: WriteCount :execrows
UPDATE entries SET value = sqlc.arg('value');
-- name: WriteResult :execresult
UPDATE entries SET value = sqlc.arg('value');
`,
  );
  await generate(directory, [{
    engine,
    schema: "schema.sql",
    queries: "query.sql",
    codegen: ["wasm", "raw"].map((plugin) => ({
      plugin,
      out: plugin,
      options: {
        runtime: "deno",
        driver,
        emit_null_as_undefined: undefinedNull,
        ...(engine === "sqlite" ? { sqlite_type_mode: "native" } : {}),
      },
    })),
  }]);
  await compareBuilds(directory);
  return await import(
    pathToFileURL(join(directory, "wasm/query_sql.ts")).href
  ) as Record<string, Query>;
}

Deno.test("SQLite execution keeps failures, disposal and conversion order", async () => {
  const queries = await fixture("@bonakodo/sqlite");
  const events: string[] = [];
  const driverError = new Error("driver failure");
  const disposalError = new Error("disposal failure");
  let failAt = "";
  const database = {
    prepare() {
      events.push("prepare");
      if (failAt === "prepare") throw driverError;
      return {
        safeIntegers() {
          events.push("safe");
          if (failAt === "safe") throw driverError;
        },
        raw() {
          events.push("raw");
          if (failAt === "raw") throw driverError;
          return this;
        },
        get() {
          events.push("get");
          if (failAt === "get") throw driverError;
          return [1n];
        },
        all() {
          events.push("all");
          if (failAt === "all") throw driverError;
          return [[1n]];
        },
        run() {
          events.push("run");
          if (failAt === "run") throw driverError;
          return {
            get changes() {
              events.push("changes");
              return 2;
            },
            lastInsertRowid: 7n,
          };
        },
        [Symbol.dispose]() {
          events.push("dispose");
          if (failAt === "dispose") throw disposalError;
        },
      };
    },
  };
  for (
    const [name, operation] of [
      ["readValue", "get"],
      ["readValues", "all"],
      ["writeValue", "run"],
      ["writeCount", "run"],
      ["writeResult", "run"],
    ]
  ) {
    const query = queries[name!]!;
    const args = { id: 1n, value: 1n };
    events.length = 0;
    const result = query(database, args);
    assert(!(result instanceof Promise));
    assert.equal(events.at(-1), "dispose");
    if (name === "writeCount" || name === "writeResult") {
      assert(events.indexOf("changes") < events.indexOf("dispose"));
    }
    for (
      const point of [
        "prepare",
        "safe",
        ...(operation === "run" ? [] : ["raw"]),
        operation!,
        "dispose",
      ]
    ) {
      failAt = point;
      events.length = 0;
      assert.throws(
        () => query(database, args),
        (error) =>
          error === (point === "dispose" ? disposalError : driverError),
      );
      assert.equal(
        events.filter((value) => value === "dispose").length,
        point === "prepare" ? 0 : 1,
      );
    }
    failAt = "";
    events.length = 0;
    assert.throws(
      () => query(database, { id: "invalid", value: "invalid" }),
      /Cannot encode argument/,
    );
    assert.deepEqual(events, []);
  }
});

Deno.test("execution helpers preserve missing rows and server cardinality", async (t) => {
  for (
    const driver of [
      "@bonakodo/sqlite",
      "better-sqlite3",
      "pg",
      "postgres",
      "mysql2",
    ]
  ) {
    for (const undefinedNull of [false, true]) {
      await t.step(`${driver} undefined=${undefinedNull}`, async () => {
        const queries = await fixture(driver, undefinedNull);
        let rows: unknown[][] = [];
        const sqlite = driver === "@bonakodo/sqlite" ||
          driver === "better-sqlite3";
        const database = sqlite
          ? {
            prepare() {
              return {
                safeIntegers() {
                  return this;
                },
                raw() {
                  return this;
                },
                get: () => rows[0],
                all: () => rows,
                [Symbol.dispose]() {},
              };
            },
          }
          : driver === "pg"
          ? { query: () => Promise.resolve({ rows }) }
          : driver === "postgres"
          ? { unsafe: () => ({ values: () => Promise.resolve(rows) }) }
          : { execute: () => Promise.resolve([rows, []]) };
        const args = { id: sqlite ? 1n : 1 };
        assert.equal(
          await queries.readValue!(database, args),
          undefinedNull ? undefined : null,
        );
        assert.deepEqual(await queries.readValues!(database, args), []);
        rows = [[sqlite ? 1n : 1], [sqlite ? 2n : 2]];
        assert.deepEqual(
          await queries.readValue!(database, args),
          sqlite ? { value: 1n } : undefinedNull ? undefined : null,
        );
        assert.deepEqual(
          await queries.readValues!(database, args),
          rows.map(([value]) => ({ value })),
        );
      });
    }
  }
});
