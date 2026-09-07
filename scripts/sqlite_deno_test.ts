import assert from "node:assert/strict";
import { Database } from "@bonakodo/sqlite";
import * as queries from "./.integration/native-db-sqlite/wasm/query_sql.ts";
import * as compat from "./.integration/deno-db-sqlite/wasm/query_sql.ts";
import * as optional from "./.integration/undefined/wasm/query_sql.ts";

const schema = await Deno.readTextFile(
  new URL("../internal/endtoend/testdata/sqlite/schema.sql", import.meta.url),
);

Deno.test("@bonakodo/sqlite executes generated CRUD, slice, count, and conversion code", () => {
  const database = new Database(":memory:");
  try {
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
      { rowsAffected: 1n, lastInsertId: 3n },
    );
    assert.equal(queries.deleteAuthor(database, { id: 1n }), 1n);
    assert.equal(queries.deleteAuthor(database, { id: 1n }), 0n);
    const record = {
      id: 1n,
      eventCount: 9_007_199_254_740_993n,
      active: true,
      createdAt: new Date("2026-09-07T01:02:03.456Z"),
      payload: new Uint8Array([0, 127, 255]),
      document: new TextEncoder().encode('{"ok":true}'),
    };
    assert.deepEqual(queries.createRecord(database, record), record);
    using ordinary = database.prepare(
      "SELECT 42 AS id, '{\"ok\":true}' AS document",
    );
    assert.deepEqual(ordinary.get(), { id: 42, document: '{"ok":true}' });
  } finally {
    database.close();
  }
});

Deno.test("@bonakodo/sqlite preserves optional null policy and transaction rollback", () => {
  const database = new Database(":memory:");
  try {
    database.exec(schema);
    assert.equal(optional.getAuthor(database, { id: 1n }), undefined);
    assert.deepEqual(
      optional.createAuthor(database, { id: 1n, name: "Ada", score: 0 }),
      { id: 1n, name: "Ada", bio: undefined, score: 0 },
    );
    assert.throws(
      database.transaction(() => {
        queries.insertAuthor(database, { id: 2n, name: "rollback" });
        throw new Error("rollback");
      }),
      /rollback/,
    );
    assert.equal(queries.getAuthor(database, { id: 2n }), null);
    assert.throws(
      () =>
        queries.createAuthor(database, {
          id: 1n << 63n,
          name: "overflow",
          bio: null,
          score: 0,
        }),
      /range|64/i,
    );
    assert.equal(queries.getAuthor(database, { id: 1n })?.name, "Ada");
  } finally {
    database.close();
  }
});

Deno.test("@bonakodo/sqlite default types follow driver number and string values", () => {
  const database = new Database(":memory:");
  try {
    database.exec(schema);
    const author = { id: 1, name: "Ada", bio: null, score: 2.5 };
    assert.deepEqual(compat.createAuthor(database, author), author);
    const large = { ...author, id: 9_007_199_254_740_993n, name: "large" };
    assert.deepEqual(compat.createAuthor(database, large), large);
    assert.equal(compat.insertAuthor(database, { id: 2, name: "two" }), 2);
    const record = {
      id: 1,
      eventCount: 7,
      active: 1,
      createdAt: "2026-09-07 01:02:03",
      payload: null,
      document: null,
    };
    assert.deepEqual(compat.createRecord(database, record), record);
  } finally {
    database.close();
  }
});

Deno.test("generated SQLite queries dispose statements after success and errors", () => {
  using database = new Database(":memory:");
  database.exec(schema);
  const statements: { run(): unknown }[] = [];
  const prepare = database.prepare.bind(database);
  database.prepare = <T>(sql: string) => {
    const statement = prepare<T>(sql);
    statements.push(statement);
    return statement;
  };

  queries.insertAuthor(database, { id: 1n, name: "Ada" });
  queries.listAuthors(database);
  assert.throws(
    () => queries.insertAuthor(database, { id: 1n, name: "duplicate" }),
    /UNIQUE/,
  );
  database.exec("UPDATE authors SET score = 'invalid' WHERE id = 1");
  assert.throws(() => queries.getAuthor(database, { id: 1n }), TypeError);
  assert.equal(statements.length, 4);
  for (const statement of statements) {
    assert.throws(() => statement.run(), /finalized/);
  }
});
