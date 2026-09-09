import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compareBuilds, generate, output } from "./generation_helpers.ts";

type Query = (database: unknown, args?: Record<string, unknown>) => unknown;

async function fixture(driver: string, undefinedNull = false, native = true) {
  const engine = driver === "@bonakodo/sqlite" || driver === "better-sqlite3"
    ? "sqlite"
    : driver === "mysql2"
    ? "mysql"
    : "postgresql";
  const directory = join(
    output,
    `execution-${driver.replaceAll(/\W/g, "")}-${undefinedNull}${
      native ? "" : "-compat"
    }`,
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
` + (engine === "sqlite"
        ? `-- name: WriteID :execlastid
INSERT INTO entries (value) VALUES (sqlc.arg('value'));
`
        : ""),
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
        ...(engine === "sqlite"
          ? { sqlite_type_mode: native ? "native" : "driver" }
          : {}),
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
  const { configureStatementCache } = await import(
    pathToFileURL(
      join(output, "execution-bonakodosqlite-false/wasm/runtime_sqlite.ts"),
    ).href
  );
  configureStatementCache(database, 0);
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

Deno.test("SQLite write result readers keep values, field errors, and cleanup precedence", async (t) => {
  for (const driver of ["@bonakodo/sqlite", "better-sqlite3"]) {
    for (const native of [true, false]) {
      await t.step(`${driver} ${native ? "native" : "compat"}`, async () => {
        const queries = await fixture(driver, false, native);
        const directory = join(
          output,
          `execution-${driver.replaceAll(/\W/g, "")}-false${
            native ? "" : "-compat"
          }`,
          "wasm",
        );
        const { QueryCodecError } = await import(
          pathToFileURL(join(directory, "codec_error.ts")).href
        );
        const runtime = await import(
          pathToFileURL(join(directory, "runtime_sqlite.ts")).href
        );
        const secret = new Error("supplied or stored private value");
        const cleanup = new Error("cleanup failed");
        let fail = "";
        let changes: unknown = 2;
        let last: unknown = 7n;
        let disposed = 0;
        const database = {
          prepare() {
            return {
              safeIntegers() {
                return this;
              },
              run() {
                if (fail === "run") throw secret;
                return {
                  get changes() {
                    if (fail === "changes" || fail === "both") throw secret;
                    return changes;
                  },
                  get lastInsertRowid() {
                    if (fail === "last") throw secret;
                    return last;
                  },
                };
              },
              [Symbol.dispose]() {
                disposed++;
                if (fail === "dispose" || fail === "both") throw cleanup;
              },
            };
          },
        };
        if (driver === "@bonakodo/sqlite") {
          runtime.configureStatementCache(database, 0);
        }
        const args = { value: native ? 1n : 1 };
        const checkError = (
          query: string,
          field: string,
          expectedType: string,
          original: unknown,
        ) =>
        (error: unknown) => {
          assert(error instanceof QueryCodecError);
          const details = error as TypeError & {
            query: string;
            file: string;
            field: string;
            expectedType: string;
            phase: string;
            originalCause(): unknown;
          };
          assert.equal(details.query, query);
          assert.equal(details.file, "query.sql");
          assert.equal(details.field, field);
          assert.equal(details.expectedType, expectedType);
          assert.equal(details.phase, "decode");
          if (original !== undefined) {
            assert.equal(details.originalCause(), original);
          }
          assert(!JSON.stringify(details).includes(secret.message));
          assert(!String(details).includes(secret.message));
          return true;
        };
        const firstCount = queries.writeCount!(database, args);
        assert.equal(
          firstCount instanceof Promise,
          driver === "better-sqlite3" && !native,
        );
        assert.equal(await firstCount, 2n);
        assert.deepEqual(await queries.writeResult!(database, args), {
          rowsAffected: 2n,
          lastInsertId: 7n,
        });
        const idType = driver === "@bonakodo/sqlite" && !native
          ? "number"
          : "bigint";
        assert.equal(
          await queries.writeID!(database, args),
          idType === "number" ? 7 : 7n,
        );
        for (
          const [name, query, field, type, point] of [
            ["writeCount", "WriteCount", "rowsAffected", "bigint", "changes"],
            ["writeID", "WriteID", "lastInsertId", idType, "last"],
            ["writeResult", "WriteResult", "rowsAffected", "bigint", "changes"],
            ["writeResult", "WriteResult", "lastInsertId", "bigint", "last"],
          ]
        ) {
          fail = point!;
          const before = disposed;
          await assert.rejects(
            async () => await queries[name!]!(database, args),
            checkError(query!, field!, type!, secret),
          );
          assert.equal(
            disposed - before,
            driver === "@bonakodo/sqlite" ? 1 : 0,
          );
        }
        fail = "";
        changes = 1.5;
        await assert.rejects(
          async () => await queries.writeCount!(database, args),
          checkError("WriteCount", "rowsAffected", "bigint", undefined),
        );
        changes = 2;
        last = {
          [Symbol.toPrimitive]() {
            throw secret;
          },
        };
        await assert.rejects(
          async () => await queries.writeID!(database, args),
          checkError("WriteID", "lastInsertId", idType, secret),
        );
        last = 7n;
        fail = "run";
        await assert.rejects(
          async () => await queries.writeResult!(database, args),
          (error) => error === secret,
        );
        if (driver === "@bonakodo/sqlite") {
          fail = "both";
          await assert.rejects(
            async () => await queries.writeResult!(database, args),
            (error) => error === cleanup,
          );
        }
        fail = "";
        assert.deepEqual(await queries.writeResult!(database, args), {
          rowsAffected: 2n,
          lastInsertId: 7n,
        });
      });
    }
  }
});
