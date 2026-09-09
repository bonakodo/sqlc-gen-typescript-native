import assert from "node:assert/strict";
import { Database } from "@bonakodo/sqlite";
import * as queries from "./.generated/native-db-sqlite/wasm/query_sql.ts";
import * as compat from "./.generated/deno-db-sqlite/wasm/query_sql.ts";
import * as optional from "./.generated/undefined/wasm/query_sql.ts";
import { QueryCodecError } from "./.generated/native-db-sqlite/wasm/codec_error.ts";

import {
  clearStatementCache,
  configureStatementCache,
} from "./.generated/native-db-sqlite/wasm/runtime_sqlite.ts";

const schema = await Deno.readTextFile(
  new URL("../fixtures/sqlite/schema.sql", import.meta.url),
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
      (error: unknown) => {
        assert.ok(error instanceof QueryCodecError);
        assert.equal(error.query, "CreateAuthor");
        assert.equal(error.field, "id");
        assert.equal(error.phase, "encode");
        assert.match(String(error.originalCause()), /range|64/i);
        return true;
      },
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

Deno.test("generated SQLite queries dispose uncached statements after success and errors", () => {
  using database = new Database(":memory:");
  database.exec(schema);
  configureStatementCache(database, 0);
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

Deno.test("generated arguments validate before leasing and slices stay bounded", () => {
  using database = new Database(":memory:");
  database.exec(schema);
  configureStatementCache(database, 2);
  let prepared = 0;
  let disposed = 0;
  const prepare = database.prepare.bind(database);
  database.prepare = <T>(sql: string) => {
    prepared++;
    const stmt = prepare<T>(sql);
    const dispose = stmt[Symbol.dispose].bind(stmt);
    stmt[Symbol.dispose] = () => {
      disposed++;
      dispose();
    };
    return stmt;
  };
  queries.insertAuthor(database, { id: 1n, name: "a" });
  queries.insertAuthor(database, { id: 2n, name: "b" });
  assert.equal(prepared, 1);
  const invalid = {
    id: "private supplied value",
    name: "private name",
  } as unknown as Parameters<typeof queries.insertAuthor>[1];
  assert.throws(() => queries.insertAuthor(database, invalid), (error) => {
    assert(error instanceof QueryCodecError);
    assert.equal(error.phase, "encode");
    assert(!JSON.stringify(error).includes("private"));
    return true;
  });
  assert.equal(prepared, 1);
  assert.equal(queries.getAuthor(database, { id: 1n })?.name, "a");
  assert.equal(queries.getAuthor(database, { id: 2n })?.name, "b");
  assert.equal(prepared, 2);
  for (let size = 0; size < 20; size++) {
    const found = queries.findAuthors(database, {
      ids: Array.from({ length: size }, (_, i) => BigInt(i + 1)),
    });
    assert.equal(found.length, Math.min(size, 2));
    assert(prepared - disposed <= 2);
  }
  clearStatementCache(database);
  assert.equal(prepared, disposed);
});
