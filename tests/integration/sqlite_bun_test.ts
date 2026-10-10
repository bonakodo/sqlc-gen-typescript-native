import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Database } from "bun:sqlite";
import * as nativeQueries from "./.generated/bun-sqlite/wasm/query_sql.ts";
import * as optional from "./.generated/bun-sqlite-undefined/wasm/query_sql.ts";
import { createQueries } from "./.generated/bun-sqlite/wasm/index.ts";
import { createQueries as createErgonomicQueries } from "./.generated/bun-sqlite-ergonomics/wasm/index.ts";
import { QueryCodecError } from "./.generated/bun-sqlite/wasm/codec_error.ts";
import { QueryCodecError as ErgonomicCodecError } from "./.generated/bun-sqlite-ergonomics/wasm/codec_error.ts";
import {
  clearStatementCache,
  configureStatementCache,
  queryMany,
  queryOne,
} from "./.generated/bun-sqlite/wasm/runtime_sqlite.ts";

const schema = readFileSync(
  new URL("../fixtures/sqlite/schema.sql", import.meta.url),
  "utf8",
);
const ergonomicsSchema = readFileSync(
  new URL("../fixtures/ergonomics/schema.sql", import.meta.url),
  "utf8",
);

test(`bun:sqlite executes CRUD, slices, bigint, blobs and codecs`, () => {
  using database = new Database(":memory:");
  database.exec(schema);
  assert.equal(nativeQueries.getAuthor(database, { id: 1n }), null);
  assert.deepEqual(nativeQueries.listAuthors(database), []);
  const author = { id: 1n, name: "Ada", bio: null, score: 1e20 };
  assert.deepEqual(nativeQueries.createAuthor(database, author), author);
  assert.equal(
    nativeQueries.renameAuthor(database, { id: 1n, name: "Grace" }),
    undefined,
  );
  assert.equal(nativeQueries.getAuthor(database, { id: 1n })?.name, "Grace");
  assert.deepEqual(nativeQueries.findAuthors(database, { ids: [] }), []);
  assert.equal(nativeQueries.findAuthors(database, { ids: [1n] }).length, 1);
  assert.equal(
    nativeQueries.insertAuthor(database, {
      id: 9_007_199_254_740_993n,
      name: "large",
    }),
    9_007_199_254_740_993n,
  );
  assert.deepEqual(
    nativeQueries.insertAuthorResult(database, { id: 3n, name: "three" }),
    {
      rowsAffected: 1n,
      lastInsertId: 3n,
    },
  );
  const record = {
    id: 1n,
    eventCount: 9_007_199_254_740_993n,
    active: true,
    createdAt: new Date("2026-09-07T01:02:03.456Z"),
    payload: new Uint8Array([0, 127, 255]),
    document: new TextEncoder().encode('{"ok":true}'),
  };
  assert.deepEqual(nativeQueries.createRecord(database, record), record);
  const nullable = {
    ...record,
    id: 2n,
    active: false,
    payload: null,
    document: null,
  };
  assert.deepEqual(nativeQueries.createRecord(database, nullable), nullable);
  assert.equal(nativeQueries.deleteAuthor(database, { id: 1n }), 1n);
  assert.equal(nativeQueries.deleteAuthor(database, { id: 1n }), 0n);
  // Per-statement options must not change an application's own statements.
  assert.equal(
    database.prepare<{ id: number }, []>("SELECT 42 AS id").get()?.id,
    42,
  );
});

test("bun:sqlite bound queries and optional nullable arguments preserve missing results", () => {
  using database = new Database(":memory:");
  database.exec(schema);
  const bound = createQueries(database).query;
  assert.equal(bound.getAuthor({ id: 1n }), null);
  assert.equal(optional.getAuthor(database, { id: 1n }), undefined);
  assert.deepEqual(
    optional.createAuthor(database, { id: 1n, name: "Ada", score: 0 }),
    {
      id: 1n,
      name: "Ada",
      bio: undefined,
      score: 0,
    },
  );
  assert.deepEqual(bound.getAuthor({ id: 1n }), {
    id: 1n,
    name: "Ada",
    bio: null,
    score: 0,
  });
  database.exec("BEGIN IMMEDIATE");
  bound.insertAuthor({ id: 2n, name: "rollback" });
  database.exec("ROLLBACK");
  assert.equal(bound.getAuthor({ id: 2n }), null);
});

test("bun:sqlite named codecs handle safe integers, JSON, booleans and epoch dates", () => {
  using database = new Database(":memory:");
  database.exec(ergonomicsSchema);
  const queries = createErgonomicQueries(database).query;
  const createdAt = new Date("2026-09-08T01:02:03.456Z");
  const settings = { enabled: true, names: ["Ada", "Grace"], optional: null };
  const author = queries.createAuthor({
    id: 1,
    name: "Ada",
    createdAt,
    active: true,
    settings,
  });
  assert.deepEqual(author, {
    id: 1,
    name: "Ada",
    createdAt,
    active: true,
    notes: null,
    settings,
  });
  assert.deepEqual(queries.findAuthors({ ids: [1] }), [author]);
  assert.deepEqual(queries.getLatestExpiry({ authorId: 1 }), {
    latestExpiry: null,
  });
  assert.deepEqual(queries.getDisplayName({ id: 999 }), { displayName: "" });
  assert.deepEqual(queries.hasStarted({ id: 1, nowMillis: createdAt }), {
    started: true,
  });
  assert.deepEqual(queries.hasStarted({ id: 1, nowMillis: new Date(0) }), {
    started: false,
  });
  const expiresAt = new Date(createdAt.getTime() + 1000);
  database
    .prepare("INSERT INTO records VALUES (?, ?, ?)")
    .run(1, 1, expiresAt.getTime());
  assert.deepEqual(queries.getLatestExpiry({ authorId: 1 }), {
    latestExpiry: expiresAt,
  });
  assert.throws(
    () => queries.getAuthor({ id: Number.MAX_SAFE_INTEGER + 1 }),
    ErgonomicCodecError,
  );
});

function trackStatements(database: Database) {
  const statements: {
    statement: ReturnType<Database["prepare"]>;
    disposed: number;
  }[] = [];
  const prepare = database.prepare.bind(database);
  database.prepare = ((sql: string) => {
    const statement = prepare(sql);
    const dispose = statement[Symbol.dispose].bind(statement);
    const entry = { statement, disposed: 0 };
    statement[Symbol.dispose] = () => {
      dispose();
      entry.disposed++;
    };
    statements.push(entry);
    return statement;
  }) as Database["prepare"];
  return statements;
}

function assertDisposed(statements: ReturnType<typeof trackStatements>) {
  for (const entry of statements) {
    assert.equal(entry.disposed, 1);
    assert.throws(() => entry.statement.run(), /finalized|closed/i);
  }
}

test("bun:sqlite cache reuses bindings, bounds slices, and finalizes evicted handles", () => {
  using database = new Database(":memory:");
  database.exec(schema);
  configureStatementCache(database, 2);
  const statements = trackStatements(database);
  nativeQueries.insertAuthor(database, { id: 1n, name: "Ada" });
  nativeQueries.insertAuthor(database, { id: 2n, name: "Grace" });
  assert.equal(statements.length, 1);
  assert.equal(nativeQueries.getAuthor(database, { id: 1n })?.name, "Ada");
  assert.equal(nativeQueries.getAuthor(database, { id: 2n })?.name, "Grace");
  assert.equal(statements.length, 2);
  for (let size = 0; size < 20; size++) {
    const found = nativeQueries.findAuthors(database, {
      ids: Array.from({ length: size }, (_, i) => BigInt(i + 1)),
    });
    assert.equal(found.length, Math.min(size, 2));
    assert(statements.filter((entry) => entry.disposed === 0).length <= 2);
  }
  clearStatementCache(database);
  clearStatementCache(database);
  assertDisposed(statements);
});

test("bun:sqlite preserves duplicate column positions and handles missing and multiple rows", () => {
  using database = new Database(":memory:");
  const read = (row: [bigint, bigint]) => row;
  assert.deepEqual(
    queryOne(database, "SELECT 1 AS x, 2 AS x", [], read, undefined, null),
    [1n, 2n],
  );
  assert.equal(
    queryOne(database, "SELECT 1 WHERE 0", [], read, undefined, undefined),
    undefined,
  );
  assert.deepEqual(
    queryMany(
      database,
      "SELECT 1 AS x, 2 AS x UNION ALL SELECT 3, 4",
      [],
      read,
      undefined,
    ),
    [
      [1n, 2n],
      [3n, 4n],
    ],
  );
  assert.deepEqual(
    queryOne(
      database,
      "SELECT 1 AS x, 2 AS x UNION ALL SELECT 3, 4",
      [],
      read,
      undefined,
      null,
    ),
    [1n, 2n],
  );
});

test("bun:sqlite finalizes uncached statements after success and execution or decode failures", () => {
  using database = new Database(":memory:");
  database.exec(schema);
  configureStatementCache(database, 0);
  const statements = trackStatements(database);
  nativeQueries.insertAuthor(database, { id: 1n, name: "Ada" });
  assert.throws(
    () => nativeQueries.insertAuthor(database, { id: 1n, name: "duplicate" }),
    /UNIQUE/,
  );
  database.exec("UPDATE authors SET score = 'invalid' WHERE id = 1");
  assert.throws(
    () => nativeQueries.getAuthor(database, { id: 1n }),
    QueryCodecError,
  );
  assert.equal(statements.length, 3);
  assertDisposed(statements);
});

test("bun:sqlite protects active statements during recursive decoding and cache clear", () => {
  using database = new Database(":memory:");
  const statements = trackStatements(database);
  const sql = "SELECT ?";
  const result = queryOne(
    database,
    sql,
    [2n],
    () => {
      clearStatementCache(database);
      return queryOne(
        database,
        sql,
        [1n],
        (row: [bigint]) => row[0],
        undefined,
        null,
      );
    },
    undefined,
    null,
  );
  assert.equal(result, 1n);
  assert.equal(statements.length, 2);
  assertDisposed(statements);
});

for (const force of [false, true]) {
  test(`bun:sqlite rejects cached queries after close(${force}) and clears safely`, () => {
    const database = new Database(":memory:");
    queryOne(database, "SELECT 1", [], (row) => row[0], undefined, null);
    database.close(force);
    assert.throws(
      () =>
        queryOne(database, "SELECT 1", [], (row) => row[0], undefined, null),
      /closed/i,
    );
    assert.doesNotThrow(() => clearStatementCache(database));
  });
}

test("bun:sqlite generated queries participate in native transaction rollback", () => {
  using database = new Database(":memory:");
  database.exec(schema);
  const transaction = database.transaction(() => {
    nativeQueries.insertAuthor(database, { id: 1n, name: "rollback" });
    throw new Error("rollback");
  });
  assert.throws(transaction, /rollback/);
  assert.equal(nativeQueries.getAuthor(database, { id: 1n }), null);
});
