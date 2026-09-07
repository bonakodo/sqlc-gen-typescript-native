import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";
import * as queries from "./.integration/native-better-sqlite3/wasm/query_sql.ts";

import * as compat from "./.integration/node-better-sqlite3/wasm/query_sql.ts";

const schema = readFileSync(
  new URL("../internal/endtoend/testdata/sqlite/schema.sql", import.meta.url),
  "utf8",
);

test("better-sqlite3 executes generated CRUD, bigint, slices and conversions", () => {
  const database = new Database(":memory:");
  try {
    database.exec(schema);
    assert.equal(queries.getAuthor(database, { id: 1n }), null);
    const author = { id: 1n, name: "Ada", bio: null, score: 1e20 };
    assert.deepEqual(queries.createAuthor(database, author), author);
    queries.renameAuthor(database, { id: 1n, name: "Grace" });
    assert.equal(queries.listAuthors(database)[0]?.name, "Grace");
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
      { rowsAffected: 1n, lastInsertId: 3n },
    );
    const record = {
      id: 1n,
      eventCount: 9_007_199_254_740_993n,
      active: true,
      createdAt: new Date("2026-09-07T01:02:03.456Z"),
      payload: new Uint8Array([0, 127, 255]),
      document: new TextEncoder().encode('{"ok":true}'),
    };
    assert.deepEqual(queries.createRecord(database, record), {
      ...record,
      payload: Buffer.from(record.payload),
      document: Buffer.from(record.document),
    });
    assert.equal(queries.deleteAuthor(database, { id: 1n }), 1n);
    assert.equal(queries.deleteAuthor(database, { id: 1n }), 0n);
    assert.throws(
      database.transaction(() => {
        queries.insertAuthor(database, { id: 4n, name: "rollback" });
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal(queries.getAuthor(database, { id: 4n }), null);
    assert.equal(typeof database.prepare("SELECT 1").pluck().get(), "number");
  } finally {
    database.close();
  }
});

test("better-sqlite3 default wrappers are promises with driver value types", async () => {
  const database = new Database(":memory:");
  try {
    database.exec(schema);
    const author = { id: 1, name: "Ada", bio: null, score: 2.5 };
    const pending = compat.createAuthor(database, author);
    assert.ok(pending instanceof Promise);
    assert.deepEqual(await pending, author);
    const record = {
      id: 1,
      eventCount: 7,
      active: true,
      createdAt: new Date("2026-09-07T01:02:03.456Z"),
      payload: null,
      document: null,
    };
    assert.deepEqual(await compat.createRecord(database, record), record);
    assert.equal(await compat.deleteAuthor(database, { id: 1 }), 1n);
  } finally {
    database.close();
  }
});
