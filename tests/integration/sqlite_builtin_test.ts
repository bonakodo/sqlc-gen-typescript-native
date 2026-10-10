import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as bunNative from "./.generated/bun-node-sqlite/wasm/query_sql.ts";
import * as nodeNative from "./.generated/node-sqlite/wasm/query_sql.ts";
import * as optional from "./.generated/undefined-node-sqlite/wasm/query_sql.ts";
import { createQueries } from "./.generated/node-sqlite/wasm/index.ts";
import { createQueries as createErgonomicQueries } from "./.generated/ergonomics-node-sqlite/wasm/index.ts";
import { QueryCodecError } from "./.generated/node-sqlite/wasm/codec_error.ts";
import { QueryCodecError as ErgonomicCodecError } from "./.generated/ergonomics-node-sqlite/wasm/codec_error.ts";
import {
  clearStatementCache,
  configureStatementCache,
  queryOne,
} from "./.generated/node-sqlite/wasm/runtime_sqlite.ts";

const schema = readFileSync(
  new URL("../fixtures/sqlite/schema.sql", import.meta.url),
  "utf8",
);
const ergonomicsSchema = readFileSync(
  new URL("../fixtures/ergonomics/schema.sql", import.meta.url),
  "utf8",
);

for (const [runtime, queries] of [
  ["Node", nodeNative],
  ["Bun", bunNative],
] as const) {
  test(`node:sqlite executes ${runtime} CRUD, slices, bigint, blobs and codecs`, () => {
    using database = new DatabaseSync(":memory:");
    database.exec(schema);
    assert.equal(queries.getAuthor(database, { id: 1n }), null);
    assert.deepEqual(queries.listAuthors(database), []);
    const author = { id: 1n, name: "Ada", bio: null, score: 1e20 };
    assert.deepEqual(queries.createAuthor(database, author), author);
    assert.equal(
      queries.renameAuthor(database, { id: 1n, name: "Grace" }),
      undefined,
    );
    assert.equal(queries.getAuthor(database, { id: 1n })?.name, "Grace");
    assert.deepEqual(queries.findAuthors(database, { ids: [] }), []);
    assert.equal(queries.findAuthors(database, { ids: [1n] }).length, 1);
    assert.equal(
      queries.insertAuthor(database, {
        id: 9_007_199_254_740_993n,
        name: "large",
      }),
      9_007_199_254_740_993n,
    );
    assert.deepEqual(
      queries.insertAuthorResult(database, { id: 3n, name: "three" }),
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
    assert.deepEqual(queries.createRecord(database, record), record);
    const nullable = {
      ...record,
      id: 2n,
      active: false,
      payload: null,
      document: null,
    };
    assert.deepEqual(queries.createRecord(database, nullable), nullable);
    assert.equal(queries.deleteAuthor(database, { id: 1n }), 1n);
    assert.equal(queries.deleteAuthor(database, { id: 1n }), 0n);
    // Per-statement options must not change an application's own statements.
    assert.equal(database.prepare("SELECT 42 AS id").get()?.id, 42);
  });
}

test("node:sqlite bound queries and optional nullable arguments preserve missing results", () => {
  using database = new DatabaseSync(":memory:");
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

test("node:sqlite named codecs handle safe integers, JSON, booleans and epoch dates", () => {
  using database = new DatabaseSync(":memory:");
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

type Statement = ReturnType<DatabaseSync["prepare"]> & { close?(): void };

function trackStatements(database: DatabaseSync, omitClose = false) {
  const statements: {
    statement: Statement;
    closed: number;
    canClose: boolean;
  }[] = [];
  const prepare = database.prepare.bind(database);
  database.prepare = (sql: string) => {
    const statement: Statement = prepare(sql);
    const close = statement.close?.bind(statement);
    const entry = {
      statement,
      closed: 0,
      canClose: !omitClose && close !== undefined,
    };
    statements.push(entry);
    if (omitClose) {
      Object.defineProperty(statement, "close", { value: undefined });
      Object.defineProperty(statement, Symbol.dispose, { value: undefined });
    } else if (close) {
      statement.close = () => {
        close();
        entry.closed++;
      };
    }
    return statement;
  };
  return statements;
}

function assertClosed(statements: ReturnType<typeof trackStatements>) {
  for (const entry of statements) {
    if (!entry.canClose) continue;
    assert.equal(entry.closed, 1);
    assert.throws(() => entry.statement.run(), /finalized|closed/);
  }
}

test("node:sqlite statement cache reuses bindings, bounds slices and clears handles", () => {
  using database = new DatabaseSync(":memory:");
  database.exec(schema);
  configureStatementCache(database, 2);
  const statements = trackStatements(database);
  nodeNative.insertAuthor(database, { id: 1n, name: "Ada" });
  nodeNative.insertAuthor(database, { id: 2n, name: "Grace" });
  assert.equal(statements.length, 1);
  assert.equal(nodeNative.getAuthor(database, { id: 1n })?.name, "Ada");
  assert.equal(nodeNative.getAuthor(database, { id: 2n })?.name, "Grace");
  assert.equal(statements.length, 2);
  const invalid = {
    id: "private value",
    name: "private name",
  } as unknown as nodeNative.InsertAuthorArgs;
  assert.throws(
    () => nodeNative.insertAuthor(database, invalid),
    QueryCodecError,
  );
  assert.equal(
    statements.length,
    2,
    "invalid input must fail before preparing a statement",
  );
  for (let size = 0; size < 20; size++) {
    const found = nodeNative.findAuthors(database, {
      ids: Array.from({ length: size }, (_, i) => BigInt(i + 1)),
    });
    assert.equal(found.length, Math.min(size, 2));
    if (statements.every((entry) => entry.canClose)) {
      assert(statements.filter((entry) => entry.closed === 0).length <= 2);
    }
  }
  clearStatementCache(database);
  assertClosed(statements);
  const before = statements.length;
  assert.equal(nodeNative.getAuthor(database, { id: 2n })?.name, "Grace");
  assert.equal(statements.length, before + 1);
  clearStatementCache(database);
  assertClosed(statements);
});

test("node:sqlite uncached statements clean up after driver and decoder errors", () => {
  using database = new DatabaseSync(":memory:");
  database.exec(schema);
  configureStatementCache(database, 0);
  const statements = trackStatements(database);
  nodeNative.insertAuthor(database, { id: 1n, name: "Ada" });
  nodeNative.listAuthors(database);
  assert.throws(
    () => nodeNative.insertAuthor(database, { id: 1n, name: "duplicate" }),
    /UNIQUE/,
  );
  database.exec("UPDATE authors SET score = 'invalid' WHERE id = 1");
  assert.throws(
    () => nodeNative.getAuthor(database, { id: 1n }),
    QueryCodecError,
  );
  assert.equal(statements.length, 4);
  assertClosed(statements);
});

test("node:sqlite supports statements without close or dispose methods", () => {
  using database = new DatabaseSync(":memory:");
  database.exec(schema);
  configureStatementCache(database, 0);
  const statements = trackStatements(database, true);
  nodeNative.insertAuthor(database, { id: 1n, name: "Ada" });
  assert.equal(nodeNative.getAuthor(database, { id: 1n })?.name, "Ada");
  assert.throws(
    () => nodeNative.insertAuthor(database, { id: 1n, name: "duplicate" }),
    /UNIQUE/,
  );
  assert.equal(statements.length, 3);
  clearStatementCache(database);
});

test("node:sqlite clears an active cache during a recursive SQLite callback", () => {
  using database = new DatabaseSync(":memory:");
  configureStatementCache(database, 2);
  const statements = trackStatements(database);
  const sql = "SELECT CAST(nested(?) AS INTEGER)";
  const read = (row: [bigint]) => row[0];
  database.function("nested", (value) => {
    if (value === 2) {
      clearStatementCache(database);
      return queryOne(database, sql, [1n], read, undefined, null);
    }
    return value;
  });
  assert.equal(queryOne(database, sql, [2n], read, undefined, null), 1n);
  assert.equal(statements.length, 2);
  assertClosed(statements);
});

test("node:sqlite clears handles after database close and prepares again after reopening", () => {
  using database = new DatabaseSync(":memory:");
  database.exec(schema);
  nodeNative.insertAuthor(database, { id: 1n, name: "Ada" });
  assert.equal(nodeNative.getAuthor(database, { id: 1n })?.name, "Ada");
  database.close();
  assert.equal(database.isOpen, false);
  assert.doesNotThrow(() => clearStatementCache(database));
  assert.throws(
    () => nodeNative.getAuthor(database, { id: 1n }),
    /open|closed/i,
  );
  database.open();
  database.exec(schema);
  nodeNative.insertAuthor(database, { id: 1n, name: "Grace" });
  assert.equal(nodeNative.getAuthor(database, { id: 1n })?.name, "Grace");
});
