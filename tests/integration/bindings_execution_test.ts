import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  compareBuilds,
  generate,
  output,
  root,
  run,
} from "./generation_helpers.ts";

type Query = (database: unknown, args?: Record<string, unknown>) => unknown;

Deno.test("generated bindings preserve order, reuse encoded values, and expand slices", async (t) => {
  const modules: string[] = [];
  for (
    const driver of [
      "@bonakodo/sqlite",
      "better-sqlite3",
      "pg",
      "postgres",
      "mysql2",
    ]
  ) {
    await t.step(driver, async () => {
      const engine = driver === "pg" || driver === "postgres"
        ? "postgresql"
        : driver === "mysql2"
        ? "mysql"
        : "sqlite";
      const directory = join(
        output,
        `bindings-${driver.replaceAll(/[^a-z0-9]/g, "-")}`,
      );
      await Deno.remove(directory, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
      await Deno.mkdir(directory, { recursive: true });
      await Deno.writeTextFile(
        join(directory, "schema.sql"),
        "CREATE TABLE entries (first_text TEXT NOT NULL, second_text TEXT NOT NULL);",
      );
      const marker = engine === "postgresql" ? "$" : "?";
      const fixed = engine === "mysql" ? [] : [
        `-- name: Reordered :many\nSELECT first_text FROM entries WHERE second_text = ${marker}2 AND first_text = ${marker}1;`,
        `-- name: Repeated :many\nSELECT first_text FROM entries WHERE first_text = ${marker}1 OR second_text = ${marker}2 OR first_text = ${marker}1;`,
      ];
      const slices = engine === "postgresql" ? [] : [
        "-- name: Sliced :many\nSELECT first_text FROM entries WHERE first_text IN (sqlc.slice('first_texts')) AND second_text = sqlc.arg('second_text');",
      ];
      await Deno.writeTextFile(
        join(directory, "query.sql"),
        [
          "-- name: Sequential :many\nSELECT first_text FROM entries WHERE first_text = sqlc.arg('first_text') AND second_text = sqlc.arg('second_text');",
          "-- name: WithoutArguments :many\nSELECT first_text FROM entries;",
          ...fixed,
          ...slices,
        ].join("\n"),
      );
      await Deno.writeTextFile(
        join(directory, "codec.ts"),
        `
export const calls: unknown[] = [];
export const textCodec = {
  encode(value: string): string {
    calls.push(value);
    if (typeof value !== "string") throw new TypeError("Invalid text");
    return value.toUpperCase();
  },
  decode(value: unknown): string {
    if (typeof value !== "string") throw new TypeError("Invalid text");
    return value;
  },
};
`,
      );
      const names = [
        "Sequential",
        ...fixed.map((sql) => sql.split(" ")[2]!),
        ...(slices.length ? ["Sliced"] : []),
      ];
      const query_overrides = names.flatMap((query) =>
        (query === "Sliced"
          ? ["first_texts", "second_text"]
          : ["first_text", "second_text"]).map((parameter) => ({
            query,
            parameter,
            ts_type: "string",
            codec: { path: "../codec.ts", name: "textCodec" },
          }))
      );
      await generate(directory, [{
        engine,
        schema: "schema.sql",
        queries: "query.sql",
        codegen: ["wasm", "raw"].map((plugin) => ({
          plugin,
          out: plugin,
          options: { runtime: "deno", driver, query_overrides },
        })),
      }]);
      const generated = await compareBuilds(directory);
      const source = generated["query_sql.ts"]!;
      const sequential = source.match(
        /export (?:async )?function sequential\([\s\S]*?\n\}/,
      )?.[0];
      assert(sequential, "generated sequential query");
      // Fixed bindings should encode at the helper call without a single-use
      // local array alias. Behavior below checks getter and codec order.
      assert(!/const _sqlcBindings =/.test(sequential));
      modules.push(join(directory, "wasm/index.ts"));
      const queries = await import(
        pathToFileURL(join(directory, "wasm/query_sql.ts")).href
      ) as Record<string, Query>;
      const { calls: encoded } = await import(
        pathToFileURL(join(directory, "codec.ts")).href
      ) as { calls: unknown[] };
      const executions: { sql: string; values: unknown[] }[] = [];
      let prepared = 0;
      let disposed = 0;
      const database = engine === "sqlite"
        ? {
          prepare(sql: string) {
            prepared++;
            return {
              safeIntegers() {
                return this;
              },
              raw() {
                return this;
              },
              all(values: unknown[]) {
                executions.push({ sql, values });
                return [["stored"]];
              },
              [Symbol.dispose]() {
                disposed++;
              },
            };
          },
        }
        : driver === "pg"
        ? {
          query(config: { text: string; values: unknown[] }) {
            executions.push({ sql: config.text, values: config.values });
            return Promise.resolve({ rows: [["stored"]] });
          },
        }
        : driver === "postgres"
        ? {
          unsafe(sql: string, values: unknown[]) {
            executions.push({ sql, values });
            return { values: () => Promise.resolve([["stored"]]) };
          },
        }
        : {
          execute(config: { sql: string; values: unknown[] }) {
            executions.push(config);
            return Promise.resolve([[["stored"]], []]);
          },
        };
      const reads: string[] = [];
      const args = {
        get firstText() {
          reads.push("first");
          return "first";
        },
        get secondText() {
          reads.push("second");
          return "second";
        },
      };
      const invoke = async (name: string, values?: Record<string, unknown>) => {
        reads.length = 0;
        encoded.length = 0;
        const result = queries[name]!(database, values);
        assert.equal(result instanceof Promise, driver !== "@bonakodo/sqlite");
        assert.deepEqual(await result, [{ firstText: "stored" }]);
        return executions.at(-1)!;
      };
      assert.deepEqual((await invoke("sequential", args)).values, [
        "FIRST",
        "SECOND",
      ]);
      assert.deepEqual(reads, ["first", "second"]);
      assert.deepEqual(encoded, ["first", "second"]);
      assert.deepEqual((await invoke("withoutArguments")).values, []);
      assert.deepEqual(encoded, []);
      if (fixed.length) {
        const reordered = await invoke("reordered", args);
        assert.deepEqual(reordered.values, ["SECOND", "FIRST"]);
        assert.deepEqual(reads, ["first", "second"]);
        assert.deepEqual(encoded, ["first", "second"]);
        assert.match(
          reordered.sql,
          engine === "postgresql"
            ? /second_text = \$1 AND first_text = \$2/
            : /second_text = \? AND first_text = \?/,
        );
        const repeated = await invoke("repeated", args);
        assert.deepEqual(
          repeated.values,
          engine === "postgresql"
            ? ["FIRST", "SECOND"]
            : ["FIRST", "SECOND", "FIRST"],
        );
        assert.deepEqual(reads, ["first", "second"]);
        assert.deepEqual(encoded, ["first", "second"]);
      }
      if (slices.length) {
        const sliced = await invoke("sliced", {
          firstTexts: ["a", "b"],
          secondText: "second",
        });
        assert.deepEqual(sliced.values, ["A", "B", "SECOND"]);
        assert.deepEqual(encoded, ["a", "b", "second"]);
        assert.match(sliced.sql, /IN \(\?, \?\)/);
        const empty = await invoke("sliced", {
          firstTexts: [],
          secondText: "second",
        });
        assert.deepEqual(empty.values, ["SECOND"]);
        assert.deepEqual(encoded, ["second"]);
        assert.match(empty.sql, /IN \(NULL\)/);
      }
      const beforePrepare = prepared;
      const beforeExecute = executions.length;
      encoded.length = 0;
      await assert.rejects(
        async () =>
          await queries.sequential!(database, {
            firstText: 1,
            secondText: "second",
          }),
        (error: unknown) =>
          error instanceof TypeError &&
          (error as TypeError & { phase: string }).phase === "encode",
      );
      assert.deepEqual(
        encoded,
        [1],
        "an invalid first encoder stops later encoders",
      );
      assert.equal(
        prepared,
        beforePrepare,
        "encoding must finish before preparing SQL",
      );
      assert.equal(executions.length, beforeExecute);
      if (driver === "@bonakodo/sqlite") {
        const { clearStatementCache } = await import(
          pathToFileURL(join(directory, "wasm/runtime_sqlite.ts")).href
        );
        clearStatementCache(database);
        assert.equal(disposed, prepared);
      }
      if (driver === "better-sqlite3") assert.equal(disposed, 0);
    });
  }
  await run(Deno.execPath(), [
    "check",
    "--config",
    join(root, "tests/integration/deno.json"),
    ...modules,
  ]);
});
