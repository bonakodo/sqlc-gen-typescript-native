import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  compareBuilds,
  generate,
  type Options,
  output,
  root,
  run,
} from "./generation_helpers.ts";

type Query = (database: unknown, args?: Record<string, unknown>) => unknown;
type Queries = Record<string, Query>;

async function load(directory: string, filename: string): Promise<Queries> {
  return await import(pathToFileURL(join(directory, "wasm", filename)).href);
}

async function prepare(directory: string) {
  await Deno.remove(directory, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await Deno.mkdir(join(directory, "queries"), { recursive: true });
}

async function fixture(
  name: string,
  engine: string,
  driver: string,
  extra: Options = {},
) {
  const directory = join(output, name);
  await prepare(directory);
  await Deno.writeTextFile(
    join(directory, "schema.sql"),
    "CREATE TABLE entries (value INTEGER NOT NULL, notes TEXT);",
  );
  const query = (name: string, command = ":one") =>
    `-- name: ${name} ${command}\nSELECT value, notes FROM entries WHERE value = sqlc.arg('value');\n`;
  await Deno.writeTextFile(
    join(directory, "queries/same.sql"),
    query("ReadFirst") + query("ReadSecond") + query("ReadMany", ":many"),
  );
  await Deno.writeTextFile(
    join(directory, "queries/other.sql"),
    query("ReadOther"),
  );
  if (engine === "sqlite") {
    await Deno.writeTextFile(
      join(directory, "queries/overrides.sql"),
      query("ReadBoolean") + query("ReadNullable") + query("ReadRequired"),
    );
    for (const name of ["a", "b"]) {
      await Deno.writeTextFile(
        join(directory, `queries/codec_${name}.sql`),
        query(name === "a" ? "ReadCodecA" : "ReadCodecB"),
      );
      await Deno.writeTextFile(
        join(directory, `codec_${name}.ts`),
        `export const codec = {\n  encode(value: string): bigint { return BigInt(value); },\n  decode(value: unknown): string { return "${name}:" + String(value); }\n};\n`,
      );
    }
  }
  await generate(directory, [{
    engine,
    schema: "schema.sql",
    queries: "queries",
    codegen: ["wasm", "raw"].map((plugin) => ({
      plugin,
      out: plugin,
      options: { runtime: "deno", driver, ...extra },
    })),
  }]);
  return { directory, generated: await compareBuilds(directory) };
}

function codecError(
  query: string,
  file: string,
  field: string,
  expectedType: string,
  phase: "encode" | "decode",
) {
  return (error: unknown) => {
    assert(error instanceof TypeError);
    const details = error as TypeError & Record<string, unknown>;
    assert.equal(details.query, query);
    assert.equal(details.file, file);
    assert.equal(details.field, field);
    assert.equal(details.expectedType, expectedType);
    assert.equal(details.phase, phase);
    assert(!String(error).includes("private-invalid-value"));
    return true;
  };
}

function assertRuntime(
  generated: Record<string, string>,
  engine: string,
  externalCodecs = false,
) {
  const engines = ["sqlite", "postgresql", "mysql"];
  assert("runtime_common.ts" in generated);
  for (const candidate of engines) {
    assert.equal(`runtime_${candidate}.ts` in generated, candidate === engine);
  }
  assert(!("runtime.ts" in generated));
  const source = Object.values(generated).join("\n");
  for (
    const unused of [
      "parseArrayText",
      "encodeArray",
      "decodeArray",
      "mysqlInsertId",
      "lastInsertId",
      ...(externalCodecs ? [] : ["checkedJson"]),
    ]
  ) assert(!source.includes(unused), `unused runtime feature: ${unused}`);
}

Deno.test("shared SQLite decoders preserve query context and per-query overrides", async () => {
  const { directory, generated } = await fixture(
    "compact-sqlite",
    "sqlite",
    "@bonakodo/sqlite",
    {
      sqlite_type_mode: "native",
      query_overrides: [
        { query: "ReadBoolean", column: "value", preset: "sqlite_boolean" },
        { query: "ReadNullable", column: "value", nullable: true },
        { query: "ReadRequired", column: "notes", nullable: false },
        {
          query: "ReadCodecA",
          column: "value",
          ts_type: "string",
          codec: { path: "../codec_a.ts", name: "codec" },
        },
        {
          query: "ReadCodecB",
          column: "value",
          ts_type: "string",
          codec: { path: "../codec_b.ts", name: "codec" },
        },
      ],
    },
  );
  assertRuntime(generated, "sqlite", true);
  const same = await load(directory, "same_sql.ts");
  const other = await load(directory, "other_sql.ts");
  const overrides = await load(directory, "overrides_sql.ts");
  const codecA = await load(directory, "codec_a_sql.ts");
  const codecB = await load(directory, "codec_b_sql.ts");
  let row: unknown[] | undefined = [1n, null];
  let disposed = 0;
  const bindings: unknown[][] = [];
  const database = {
    prepare() {
      return {
        safeIntegers() {},
        raw() {
          return this;
        },
        get(values: unknown[]) {
          bindings.push(values);
          return row;
        },
        all(values: unknown[]) {
          bindings.push(values);
          return row ? [row] : [];
        },
        [Symbol.dispose]() {
          disposed++;
        },
      };
    },
  };
  const args = { value: 1n };
  for (const query of [same.readFirst!, same.readSecond!, other.readOther!]) {
    const result = query(database, args);
    assert(
      !(result instanceof Promise),
      "SQLite wrappers must stay synchronous",
    );
    assert.deepEqual(result, { value: 1n, notes: null });
  }
  assert.deepEqual(same.readMany!(database, args), [{
    value: 1n,
    notes: null,
  }]);
  assert.deepEqual(overrides.readBoolean!(database, args), {
    value: true,
    notes: null,
  });
  assert.equal(disposed, 5);
  assert.deepEqual(bindings, Array.from({ length: 5 }, () => [1n]));
  assert.deepEqual(codecA.readCodecA!(database, args), {
    value: "a:1",
    notes: null,
  });
  assert.deepEqual(codecB.readCodecB!(database, args), {
    value: "b:1",
    notes: null,
  });
  assert.throws(
    () => same.readFirst!(database, { value: "private-invalid-value" }),
    codecError("ReadFirst", "same.sql", "value", "bigint", "encode"),
  );
  assert.equal(disposed, 7, "invalid arguments must fail before preparing SQL");
  row = ["private-invalid-value", null];
  for (
    const [query, name, file] of [
      [same.readFirst!, "ReadFirst", "same.sql"],
      [same.readSecond!, "ReadSecond", "same.sql"],
      [other.readOther!, "ReadOther", "other.sql"],
    ] as const
  ) {
    assert.throws(
      () => query(database, args),
      codecError(name, file, "value", "bigint", "decode"),
    );
  }
  assert.equal(disposed, 10, "decoder failures must still finalize statements");
  row = [null, null];
  assert.deepEqual(overrides.readNullable!(database, args), {
    value: null,
    notes: null,
  });
  assert.throws(
    () => same.readFirst!(database, args),
    codecError("ReadFirst", "same.sql", "value", "bigint", "decode"),
  );
  row = [1n, null];
  assert.throws(
    () => overrides.readRequired!(database, args),
    codecError("ReadRequired", "overrides.sql", "notes", "string", "decode"),
  );
  row = undefined;
  assert.equal(same.readFirst!(database, args), null);
  assert.deepEqual(same.readMany!(database, args), []);
});

Deno.test("shared server decoders keep async calls and omit unused engine features", async (t) => {
  for (const driver of ["pg", "postgres", "mysql2"]) {
    await t.step(driver, async () => {
      const engine = driver === "mysql2" ? "mysql" : "postgresql";
      const { directory, generated } = await fixture(
        `compact-${driver}`,
        engine,
        driver,
      );
      assertRuntime(generated, engine);
      const same = await load(directory, "same_sql.ts");
      const other = await load(directory, "other_sql.ts");
      let rows: unknown[][] = [[7, null]];
      const calls: unknown[] = [];
      const database = driver === "pg"
        ? {
          query(config: unknown) {
            calls.push(config);
            return Promise.resolve({ rows, rowCount: rows.length });
          },
        }
        : driver === "postgres"
        ? {
          unsafe(sql: string, values: unknown[]) {
            calls.push({ sql, values });
            return { values: () => Promise.resolve(rows) };
          },
        }
        : {
          execute(config: unknown) {
            calls.push(config);
            return Promise.resolve([rows, []]);
          },
        };
      const args = { value: 7 };
      for (
        const query of [same.readFirst!, same.readSecond!, other.readOther!]
      ) {
        const pending = query(database, args);
        assert(
          pending instanceof Promise,
          `${driver} wrappers must stay async`,
        );
        assert.deepEqual(await pending, { value: 7, notes: null });
      }
      assert.deepEqual(await same.readMany!(database, args), [{
        value: 7,
        notes: null,
      }]);
      assert.equal(calls.length, 4);
      rows = [["private-invalid-value", null]];
      for (
        const [query, name, file] of [
          [same.readFirst!, "ReadFirst", "same.sql"],
          [same.readSecond!, "ReadSecond", "same.sql"],
          [other.readOther!, "ReadOther", "other.sql"],
        ] as const
      ) {
        await assert.rejects(
          () => query(database, args) as Promise<unknown>,
          codecError(name, file, "value", "number", "decode"),
        );
      }
      await assert.rejects(
        () =>
          same.readFirst!(database, {
            value: "private-invalid-value",
          }) as Promise<unknown>,
        codecError("ReadFirst", "same.sql", "value", "number", "encode"),
      );
      rows = [[7]];
      await assert.rejects(
        () => same.readFirst!(database, args) as Promise<unknown>,
        /column count/,
      );
      rows = [];
      assert.equal(await same.readFirst!(database, args), null);
      assert.deepEqual(await same.readMany!(database, args), []);
    });
  }
});

Deno.test("800 queries share one row decoder across files within a source-size budget", async () => {
  const directory = join(output, "compact-large-schema");
  await prepare(directory);
  let schema = "";
  for (let table = 0; table < 100; table++) {
    const suffix = String(table).padStart(3, "0");
    const name = `entries_${suffix}`;
    schema +=
      `CREATE TABLE ${name} (id BIGINT PRIMARY KEY, name TEXT NOT NULL, active BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL, notes TEXT);\n`;
    let queries = "";
    for (let query = 0; query < 8; query++) {
      queries +=
        `-- name: ReadEntry${suffix}Page${query} :many\nSELECT * FROM ${name} WHERE id > sqlc.arg('after_id') AND active = sqlc.arg('active') ORDER BY id LIMIT sqlc.arg('limit');\n\n`;
    }
    await Deno.writeTextFile(
      join(directory, "queries", `${name}.sql`),
      queries,
    );
  }
  await Deno.writeTextFile(join(directory, "schema.sql"), schema);
  await generate(directory, [{
    engine: "postgresql",
    schema: "schema.sql",
    queries: "queries",
    codegen: ["wasm", "raw"].map((plugin) => ({
      plugin,
      out: plugin,
      options: { runtime: "node", driver: "pg" },
    })),
  }]);
  const generated = await compareBuilds(directory);
  const sources = Object.values(generated);
  const size = sources.reduce(
    (sum, source) => sum + new TextEncoder().encode(source).byteLength,
    0,
  );
  // The same stock-sqlc fixture produced 1,922,028 bytes before sharing.
  assert(size <= 700_000, `generated ${size} bytes; budget is 700,000`);
  const queryCode = Object.entries(generated)
    .filter(([name]) =>
      !name.startsWith("runtime_") && name !== "codec_error.ts"
    )
    .map(([, source]) => source).join("\n");
  assert.equal(
    queryCode.match(/export async function readEntry\d+Page\d+\(/g)?.length,
    800,
  );
  // A shared decoder reads the five fields once, regardless of query or file.
  // Do not tie this check to private function names or import aliases.
  for (let column = 0; column < 5; column++) {
    const reads = queryCode.match(new RegExp(`\\brow\\[${column}\\]`, "g")) ??
      [];
    assert.equal(reads.length, 1, `column ${column} repeats its row decoder`);
  }
  assertRuntime(generated, "postgresql");
});

Deno.test("queries without arguments emit only their command's runtime needs", async (t) => {
  const modules: string[] = [];
  for (const driver of ["@bonakodo/sqlite", "pg", "postgres", "mysql2"]) {
    const engine = driver === "@bonakodo/sqlite"
      ? "sqlite"
      : driver === "mysql2"
      ? "mysql"
      : "postgresql";
    const commands = engine === "postgresql"
      ? ["exec", "execrows", "execresult"]
      : ["exec", "execrows", "execresult", "execlastid"];
    for (const command of commands) {
      await t.step(`${driver} :${command}`, async () => {
        const name = driver === "@bonakodo/sqlite" ? "sqlite" : driver;
        const directory = join(output, `compact-noargs-${name}-${command}`);
        await prepare(directory);
        await Deno.writeTextFile(
          join(directory, "schema.sql"),
          "CREATE TABLE entries (id INTEGER PRIMARY KEY, value INTEGER NOT NULL);",
        );
        await Deno.writeTextFile(
          join(directory, "query.sql"),
          `-- name: StoreValue :${command}\nINSERT INTO entries (id, value) VALUES (7, 2);\n`,
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
              ...(engine === "sqlite" ? { sqlite_type_mode: "native" } : {}),
            },
          })),
        }]);
        await compareBuilds(directory);
        modules.push(join(directory, "wasm/index.ts"));
        const queries = await load(directory, "query_sql.ts");
        let count: unknown = 2;
        let insertId: unknown = 7;
        const database = engine === "sqlite"
          ? {
            prepare() {
              return {
                safeIntegers() {},
                raw() {
                  return this;
                },
                get: () => [insertId],
                run: () => ({ changes: count, lastInsertRowid: insertId }),
                [Symbol.dispose]() {},
              };
            },
          }
          : driver === "pg"
          ? { query: () => Promise.resolve({ rows: [], rowCount: count }) }
          : driver === "postgres"
          ? {
            unsafe: () => ({
              values: () => Promise.resolve(Object.assign([], { count })),
            }),
          }
          : {
            execute: () =>
              Promise.resolve([{
                affectedRows: count,
                insertId,
              }, []]),
          };
        const pending = queries.storeValue!(database);
        assert.equal(pending instanceof Promise, engine !== "sqlite");
        const result = await pending;
        const expected = command === "exec"
          ? undefined
          : command === "execrows"
          ? 2n
          : command === "execlastid"
          ? engine === "mysql" ? 7 : 7n
          : {
            rowsAffected: 2n,
            lastInsertId: engine === "postgresql" ? null : 7n,
          };
        assert.deepEqual(result, expected);
        if (command === "exec") return;
        if (command === "execlastid") insertId = "private-invalid-value";
        else count = "private-invalid-value";
        const check = codecError(
          "StoreValue",
          "query.sql",
          command === "execlastid" ? "lastInsertId" : "rowsAffected",
          command === "execlastid" && engine === "mysql" ? "number" : "bigint",
          "decode",
        );
        if (engine === "sqlite") {
          assert.throws(() => queries.storeValue!(database), check);
        } else {
          await assert.rejects(
            () => queries.storeValue!(database) as Promise<unknown>,
            check,
          );
        }
      });
    }
  }
  // Each command was generated alone, so an unused query context or a missing
  // metadata helper cannot be hidden by another query's imports.
  await run(Deno.execPath(), [
    "check",
    "--config",
    join(root, "tests/integration/deno.json"),
    ...modules,
  ]);
});

Deno.test("explicit generated runtime codec paths retain the selected preset", async (t) => {
  for (const path of ["./runtime_sqlite.ts", "./runtime.ts"]) {
    await t.step(path, async () => {
      const directory = join(
        output,
        path === "./runtime.ts"
          ? "compact-codec-legacy-path"
          : "compact-codec-engine-path",
      );
      await prepare(directory);
      await Deno.writeTextFile(
        join(directory, "schema.sql"),
        "CREATE TABLE entries (value INTEGER NOT NULL);",
      );
      await Deno.writeTextFile(
        join(directory, "query.sql"),
        "-- name: ReadValue :one\nSELECT value FROM entries WHERE value = sqlc.arg('value');\n",
      );
      const mapping = {
        ts_type: "number",
        codec: { path, name: "safeInteger" },
      };
      await generate(directory, [{
        engine: "sqlite",
        schema: "schema.sql",
        queries: "query.sql",
        codegen: ["wasm", "raw"].map((plugin) => ({
          plugin,
          out: plugin,
          options: {
            runtime: "deno",
            driver: "@bonakodo/sqlite",
            sqlite_type_mode: "native",
            query_overrides: [{
              query: "ReadValue",
              column: "value",
              ...mapping,
            }, { query: "ReadValue", parameter: "value", ...mapping }],
          },
        })),
      }]);
      const generated = await compareBuilds(directory);
      assert(
        generated["runtime_sqlite.ts"]!.includes("export const safeInteger"),
      );
      for (const unused of ["epochMilliseconds", "jsonText", "sqliteBoolean"]) {
        assert(!generated["runtime_sqlite.ts"]!.includes(unused));
      }
      assert(
        Object.values(generated).some((source) =>
          source.includes('from "./runtime_sqlite.ts"')
        ),
      );
      const bindings: unknown[][] = [];
      const database = {
        prepare() {
          return {
            safeIntegers() {},
            raw() {
              return this;
            },
            get(values: unknown[]) {
              bindings.push(values);
              return [17n];
            },
            [Symbol.dispose]() {},
          };
        },
      };
      const queries = await load(directory, "query_sql.ts");
      assert.deepEqual(queries.readValue!(database, { value: 17 }), {
        value: 17,
      });
      assert.deepEqual(bindings, [[17n]]);
      assert.throws(
        () => queries.readValue!(database, { value: "private-invalid-value" }),
        codecError("ReadValue", "query.sql", "value", "number", "encode"),
      );
    });
  }
});

Deno.test("external SQLite codecs can use the generated JSON codec factory", async () => {
  const directory = join(output, "compact-external-json-codec");
  await prepare(directory);
  await Deno.writeTextFile(
    join(directory, "schema.sql"),
    "CREATE TABLE entries (value TEXT NOT NULL);",
  );
  await Deno.writeTextFile(
    join(directory, "query.sql"),
    "-- name: ReadValue :one\nSELECT value FROM entries WHERE value = sqlc.arg('value');\n",
  );
  await Deno.writeTextFile(
    join(directory, "codec.ts"),
    `import { createJsonTextCodec } from "./wasm/runtime_sqlite.ts";
export const codec = createJsonTextCodec((value: unknown): string => {
  if (typeof value !== "string") throw new TypeError("Expected text");
  return value;
});
`,
  );
  const mapping = {
    ts_type: "string",
    codec: { path: "../codec.ts", name: "codec" },
  };
  await generate(directory, [{
    engine: "sqlite",
    schema: "schema.sql",
    queries: "query.sql",
    codegen: ["wasm", "raw"].map((plugin) => ({
      plugin,
      out: plugin,
      options: {
        runtime: "deno",
        driver: "@bonakodo/sqlite",
        sqlite_type_mode: "native",
        query_overrides: [{ query: "ReadValue", column: "value", ...mapping }, {
          query: "ReadValue",
          parameter: "value",
          ...mapping,
        }],
      },
    })),
  }]);
  const generated = await compareBuilds(directory);
  const runtime = generated["runtime_sqlite.ts"]!;
  for (
    const name of [
      "safeInteger",
      "epochMilliseconds",
      "sqliteBoolean",
      "jsonText",
      "createJsonTextCodec",
    ]
  ) assert(runtime.includes(name), name);
  assert(!runtime.includes("lastInsertId"));
  const bindings: unknown[][] = [];
  const database = {
    prepare() {
      return {
        safeIntegers() {},
        raw() {
          return this;
        },
        get(values: unknown[]) {
          bindings.push(values);
          return ['"stored"'];
        },
        [Symbol.dispose]() {},
      };
    },
  };
  const queries = await load(directory, "query_sql.ts");
  assert.deepEqual(queries.readValue!(database, { value: "argument" }), {
    value: "stored",
  });
  assert.deepEqual(bindings, [['"argument"']]);
  assert.throws(
    () => queries.readValue!(database, { value: 17 }),
    codecError("ReadValue", "query.sql", "value", "string", "encode"),
  );
});
