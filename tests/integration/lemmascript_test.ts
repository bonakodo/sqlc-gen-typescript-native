import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  block,
  compareBuilds,
  generate,
  type Options,
  output,
  plugins,
  root,
  sqlc,
} from "./generation_helpers.ts";

type Query = (database: unknown, args?: Record<string, unknown>) => unknown;

async function sameJavascript(
  enabled: Record<string, string>,
  disabled: Record<string, string>,
) {
  // Run the installed compiler under Node, like the integration type checks.
  // This also avoids granting Deno unrelated TypeScript watcher env access.
  const child = new Deno.Command("node", {
    cwd: root,
    args: [
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict";
import ts from "./tests/integration/node_modules/typescript/lib/typescript.js";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const [enabled, disabled] = JSON.parse(input);
function javascript(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true, verbatimModuleSyntax: true },
    reportDiagnostics: true,
  });
  assert.deepEqual(result.diagnostics, [], "generated TypeScript must parse");
  return result.outputText;
}
for (const name of Object.keys(enabled)) {
  assert.equal(javascript(enabled[name]), javascript(disabled[name]), name + ": annotations must not change executable JavaScript or SQL");
}
`,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(JSON.stringify([enabled, disabled])),
  );
  await writer.close();
  const result = await child.output();
  assert.equal(result.code, 0, new TextDecoder().decode(result.stderr));
}

async function prepare(directory: string) {
  await Deno.remove(directory, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(directory, { recursive: true });
}

function queries(engine: string, missing: string): string {
  return String.raw`-- name: GetRecord :one
-- Read one record in a workspace.
-- @lemma requires args.workspaceId.length > 0
-- @lemma ensures \result === ${missing} || \result.workspaceId === args.workspaceId
-- @lemma contract The SQL policy must authorize the returned record.
SELECT workspace_id, object_id, note FROM records
WHERE workspace_id = sqlc.arg('workspace_id') AND object_id = sqlc.arg('object_id');
-- name: ListRecords :many
SELECT workspace_id, object_id, note FROM records WHERE workspace_id = sqlc.arg('workspace_id');
-- name: ListAll :many
SELECT workspace_id, object_id, note FROM records;
-- name: UpdateNote :exec
UPDATE records SET note = sqlc.narg('note') WHERE workspace_id = sqlc.arg('workspace_id');
-- name: DeleteRecords :execrows
DELETE FROM records WHERE workspace_id = sqlc.arg('workspace_id');
-- name: InsertRecord :execresult
INSERT INTO records (workspace_id, object_id, note)
VALUES (sqlc.arg('workspace_id'), sqlc.arg('object_id'), sqlc.narg('note'));
-- name: Repeated :many
SELECT workspace_id, object_id, note FROM records
WHERE workspace_id = sqlc.arg('workspace_id') OR object_id = sqlc.arg('object_id') OR workspace_id = sqlc.arg('workspace_id');
` + (engine === "postgresql" ? "" : String.raw`-- name: Sliced :many
SELECT workspace_id, object_id, note FROM records WHERE object_id IN (sqlc.slice('object_ids'));
-- name: InsertID :execlastid
INSERT INTO records (workspace_id, object_id) VALUES (sqlc.arg('workspace_id'), sqlc.arg('object_id'));
`);
}

interface Case {
  driver: string;
  name: string;
  options?: Options;
}

Deno.test("LemmaScript emission is opt-in and preserves generated execution", async (t) => {
  const cases: Case[] = [
    ...["@bonakodo/sqlite", "better-sqlite3", "pg", "postgres", "mysql2"].map(
      (driver) => ({ driver, name: driver.replaceAll(/\W/g, "") }),
    ),
    {
      driver: "@bonakodo/sqlite",
      name: "undefined",
      options: { emit_null_as_undefined: true, optional_nullable_args: true },
    },
    {
      driver: "@bonakodo/sqlite",
      name: "inline-sql",
      options: { emit_sql_as_const: false, emit_query_factory: false },
    },
    {
      driver: "@bonakodo/sqlite",
      name: "custom-codec",
      options: {
        query_overrides: [{
          query: "GetRecord",
          parameter: "workspace_id",
          ts_type: "string",
          codec: { path: "../../codec.ts", name: "workspaceCodec" },
        }],
      },
    },
    {
      driver: "@bonakodo/sqlite",
      name: "types-only",
      options: { types_only: true },
    },
  ];
  for (const tc of cases) {
    await t.step(tc.name, async () => {
      const engine = tc.driver === "pg" || tc.driver === "postgres"
        ? "postgresql"
        : tc.driver === "mysql2"
        ? "mysql"
        : "sqlite";
      const directory = join(output, `lemma-${tc.name}`);
      await prepare(directory);
      await Deno.writeTextFile(
        join(directory, "schema.sql"),
        "CREATE TABLE records (workspace_id TEXT NOT NULL, object_id TEXT NOT NULL, note TEXT);",
      );
      await Deno.writeTextFile(
        join(directory, "query.sql"),
        queries(
          engine,
          tc.options?.emit_null_as_undefined ? "undefined" : "null",
        ),
      );
      if (tc.name === "custom-codec") {
        await Deno.writeTextFile(
          join(directory, "codec.ts"),
          `export const encoded: string[] = [];
export const workspaceCodec = {
  encode(value: string): string { encoded.push(value); return value; },
  decode(value: unknown): string {
    if (typeof value !== "string") throw new TypeError("Expected string");
    return value;
  },
};
`,
        );
      }
      await generate(directory, [{
        engine,
        schema: "schema.sql",
        queries: "query.sql",
        codegen: ["omitted", "disabled", "enabled"].flatMap((mode) =>
          ["wasm", "raw"].map((plugin) => ({
            plugin,
            out: join(mode, plugin),
            options: {
              runtime: "deno",
              driver: tc.driver,
              emit_query_factory: true,
              ...tc.options,
              ...(mode === "omitted"
                ? {}
                : { emitLemmaScript: mode === "enabled" }),
            },
          }))
        ),
      }]);
      const omitted = await compareBuilds(join(directory, "omitted"));
      const disabled = await compareBuilds(join(directory, "disabled"));
      const enabled = await compareBuilds(join(directory, "enabled"));
      assert.deepEqual(
        disabled,
        omitted,
        "false and absent preserve exact output",
      );
      assert.deepEqual(Object.keys(enabled), Object.keys(disabled));
      await sameJavascript(enabled, disabled);
      const source = enabled["query_sql.ts"]!;
      if (tc.options?.types_only) {
        assert.doesNotMatch(
          source,
          /\/\/@ (?:extern|impure|requires|ensures|contract)\b/,
        );
        return;
      }
      const functions = source.matchAll(
        /export (?:async )?function (\w+)\([^\n]*\{\n([\s\S]*?)\n\}/g,
      );
      const bodies = new Map<string, string>();
      let queryCount = 0;
      for (const match of functions) {
        const [, name, body] = match;
        if (name === "createQueries") continue;
        queryCount++;
        bodies.set(name!, body!);
        const prefix = source.slice(0, match.index);
        assert.match(prefix, /\/\/@ extern\s*\n\/\/@ impure\s*\n$/);
        assert.match(body!, /^\s*\/\/@ contract /);
        assert(body!.includes(`engine ${engine}; driver ${tc.driver}.`));
        assert.match(
          body!,
          /SQL, driver behavior, codecs, and user contracts are trusted here, not verified\./,
        );
        assert.doesNotMatch(
          body!,
          /\/\/@ (?:verify|assume|skip|havoc|backend)\b/,
        );
      }
      assert.equal(queryCount, engine === "postgresql" ? 7 : 9);
      assert.match(
        bodies.get("getRecord")!,
        /Parameter 1: args\["workspaceId"\] has TypeScript type "string"; resolved nullable=false/,
      );
      assert.match(
        bodies.get("getRecord")!,
        /Result field "row.note" has TypeScript type "string \| (?:null|undefined)"; resolved nullable=true/,
      );
      assert.match(
        bodies.get("repeated")!,
        engine === "mysql"
          ? /SQL placeholder occurrence 3 uses parameter 3 \(args\["workspaceId_2"\]\) after encoding\./
          : /SQL placeholder occurrence 3 uses parameter 1 \(args\["workspaceId"\]\) after encoding\./,
      );
      assert.doesNotMatch(
        bodies.get("listAll")!,
        /\/\/@ (?:requires|ensures)\b/,
      );
      if (tc.name === "custom-codec") {
        assert.match(bodies.get("getRecord")!, /uses a custom codec\./);
      }
      if (engine !== "postgresql") {
        assert.match(
          bodies.get("sliced")!,
          /an empty slice emits NULL and binds no values\./,
        );
      }
      assert.match(source, /\/\/@ requires args\.workspaceId\.length > 0/);
      assert.match(
        source,
        /\/\/@ ensures \\result === (?:null|undefined) \|\| \\result\.workspaceId === args\.workspaceId/,
      );
      assert.match(
        source,
        /\/\/@ contract The SQL policy must authorize the returned record\./,
      );
      assert.match(source, /Read one record in a workspace\./);
      assert.doesNotMatch(
        source,
        /\*\s+@lemma /,
        "directives leave the JSDoc prose",
      );
      assert.match(disabled["query_sql.ts"]!, /\*\s+@lemma requires /);

      const generated = await import(
        pathToFileURL(join(directory, "enabled/wasm/query_sql.ts")).href
      ) as Record<string, Query>;
      const observed: { sql: string; values: unknown[] }[] = [];
      let rows: unknown[][] = [["workspace", "object", null]];
      const record = (sql: string, values: unknown[]) => {
        observed.push({ sql, values });
        return rows;
      };
      const database = engine === "sqlite"
        ? {
          prepare(sql: string) {
            return {
              raw() {
                return this;
              },
              safeIntegers() {
                return this;
              },
              get: (values: unknown[]) => record(sql, values)[0],
              all: (values: unknown[]) => record(sql, values),
              run: (values: unknown[]) => {
                record(sql, values);
                return { changes: 2, lastInsertRowid: 7 };
              },
              [Symbol.dispose]() {},
            };
          },
        }
        : tc.driver === "pg"
        ? {
          query: (config: { text: string; values: unknown[] }) =>
            Promise.resolve({
              rows: record(config.text, config.values),
              rowCount: 2,
            }),
        }
        : tc.driver === "postgres"
        ? {
          unsafe(sql: string, values: unknown[]) {
            const result = Object.assign(record(sql, values), { count: 2 });
            return Object.assign(Promise.resolve(result), {
              values: () => Promise.resolve(result),
            });
          },
        }
        : {
          execute: (config: { sql: string; values: unknown[] }) => {
            const result = record(config.sql, config.values);
            return Promise.resolve([
              /(?:UPDATE|DELETE|INSERT) /i.test(config.sql)
                ? { affectedRows: 2, insertId: 7 }
                : result,
              [],
            ]);
          },
        };
      const args = { workspaceId: "workspace", objectId: "object", note: null };
      const expectedRow = {
        ...args,
        note: tc.options?.emit_null_as_undefined ? undefined : null,
      };
      for (const name of ["getRecord", "listRecords", "listAll", "repeated"]) {
        const result = generated[name]!(
          database,
          engine === "mysql" && name === "repeated"
            ? { ...args, workspaceId_2: "workspace" }
            : args,
        );
        assert.equal(
          result instanceof Promise,
          tc.driver !== "@bonakodo/sqlite",
        );
        assert.deepEqual(
          await result,
          name === "getRecord" ? expectedRow : [expectedRow],
        );
      }
      assert.deepEqual(
        observed.at(-1)?.values,
        engine === "postgresql"
          ? ["workspace", "object"]
          : ["workspace", "object", "workspace"],
      );
      rows = [];
      assert.equal(
        await generated.getRecord!(database, args),
        tc.options?.emit_null_as_undefined ? undefined : null,
      );
      assert.deepEqual(await generated.listRecords!(database, args), []);
      assert.equal(await generated.updateNote!(database, args), undefined);
      assert.equal(await generated.deleteRecords!(database, args), 2n);
      assert.equal(
        (await generated.insertRecord!(database, args) as {
          rowsAffected: bigint;
        }).rowsAffected,
        2n,
      );
      if (engine !== "postgresql") {
        assert.equal(
          await generated.insertID!(database, args),
          tc.driver === "better-sqlite3" ? 7n : 7,
        );
        assert.deepEqual(
          await generated.sliced!(database, { objectIds: ["a", "b"] }),
          [],
        );
        assert.deepEqual(observed.at(-1)?.values, ["a", "b"]);
        assert.deepEqual(
          await generated.sliced!(database, { objectIds: [] }),
          [],
        );
        assert.deepEqual(observed.at(-1)?.values, []);
        assert.match(observed.at(-1)!.sql, /IN \(NULL\)/);
      }
      if (tc.options?.emit_query_factory !== false) {
        const factory = generated.createQueries!(database) as Record<
          string,
          (args: unknown) => unknown
        >;
        assert.deepEqual(await factory.listRecords!(args), []);
      }
      if (tc.name === "custom-codec") {
        const { encoded } = await import(
          pathToFileURL(join(directory, "codec.ts")).href
        ) as { encoded: string[] };
        assert.deepEqual(encoded, ["workspace", "workspace"]);
      }
    });
  }
});

Deno.test("LemmaScript metadata includes nested embedded fields and outer-join nullability", async (t) => {
  for (const engine of ["postgresql", "sqlite"]) {
    await t.step(engine, async () => {
      const directory = join(output, `lemma-embed-${engine}`);
      await prepare(directory);
      const fixture = engine === "postgresql"
        ? "stock_embed"
        : "stock_embed_sqlite";
      await generate(
        directory,
        [true, false].map((enabled) =>
          block(engine, fixture, directory, {
            runtime: "deno",
            driver: engine === "postgresql" ? "pg" : "@bonakodo/sqlite",
            emitLemmaScript: enabled,
          }, enabled ? "enabled" : "disabled")
        ),
      );
      const enabled = await compareBuilds(join(directory, "enabled"));
      const disabled = await compareBuilds(join(directory, "disabled"));
      await sameJavascript(enabled, disabled);
      const source = enabled["query_sql.ts"]!;
      assert.match(source, /Embedded result "row\.[^"]+" has TypeScript type/);
      assert.match(
        source,
        /child fields describe decoding and outer-join null handling/,
      );
      assert.match(source, /Result field "row\.[^.]+\.id" has TypeScript type/);
    });
  }
});

Deno.test("LemmaScript directives reject unsafe or empty directives through stock sqlc", async (t) => {
  const directory = join(output, "lemma-invalid");
  await prepare(directory);
  await Deno.writeTextFile(
    join(directory, "schema.sql"),
    "CREATE TABLE records (value TEXT NOT NULL);",
  );
  await Deno.writeTextFile(
    join(directory, "sqlc.json"),
    JSON.stringify({
      version: "2",
      plugins: await plugins(),
      sql: [{
        engine: "sqlite",
        schema: "schema.sql",
        queries: "query.sql",
        codegen: [{
          plugin: "wasm",
          out: "wasm",
          options: {
            runtime: "deno",
            driver: "@bonakodo/sqlite",
            emitLemmaScript: true,
          },
        }],
      }],
    }),
  );
  for (
    const directive of [
      "verify",
      "assume true",
      "skip",
      "havoc value",
      "backend dafny",
      "type args string",
      "extern",
      "impure",
      "requires",
      "ensures",
      "contract",
      "unknown x",
    ]
  ) {
    await t.step(directive, async () => {
      await Deno.writeTextFile(
        join(directory, "query.sql"),
        `-- name: GetValue :one\n-- @lemma ${directive}\nSELECT value FROM records;\n`,
      );
      const result = await new Deno.Command(sqlc, {
        cwd: root,
        args: ["generate", "-f", join(directory, "sqlc.json")],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert.notEqual(result.code, 0, `${directive} must fail generation`);
      assert.match(new TextDecoder().decode(result.stderr), /lemma/i);
    });
  }
});
