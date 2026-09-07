import assert from "node:assert/strict";
import test from "node:test";
import * as pg from "./.integration/node-pg/wasm/query_sql.ts";
import type { Database as PgDatabase } from "./.integration/node-pg/wasm/runtime.ts";
import * as postgres from "./.integration/node-postgres/wasm/query_sql.ts";
import type { Database as PostgresDatabase } from "./.integration/node-postgres/wasm/runtime.ts";
import * as mysql from "./.integration/node-mysql2/wasm/query_sql.ts";
import type { Database as MySQLDatabase } from "./.integration/node-mysql2/wasm/runtime.ts";
import * as mysqlStrings from "./.integration/mysql-strings/wasm/query_sql.ts";
import * as mysqlMixed from "./.integration/mysql-mixed/wasm/query_sql.ts";

const author = { id: 7, name: "Ada", bio: null, score: 2.5 };
const authorValues: unknown[] = [7, "Ada", null, 2.5];

test("pg uses bound values, array row mode, counts, null rows, and propagates failures", async () => {
  const calls: unknown[] = [];
  let rows: unknown[][] = [authorValues];
  let failure: Error | undefined;
  const database: PgDatabase = {
    async query(config) {
      calls.push(config);
      if (failure) throw failure;
      return {
        rows,
        rowCount: rows.length,
        command: "SELECT",
        oid: 0,
        fields: [],
      };
    },
  };
  assert.deepEqual(await pg.getAuthor(database, { id: 7 }), author);
  assert.deepEqual(calls[0], {
    text: pg.getAuthorQuery,
    values: [7],
    rowMode: "array",
  });
  assert.deepEqual(await pg.listAuthors(database), [author]);
  assert.equal(
    await pg.renameAuthor(database, { id: 7, name: "safe' text" }),
    undefined,
  );
  assert.equal(await pg.deleteAuthor(database, { id: 7 }), 1n);
  assert.deepEqual(
    await pg.insertAuthorResult(database, { id: 7, name: "Ada" }),
    { rowsAffected: 1n, lastInsertId: null },
  );
  assert.deepEqual(await pg.findAuthors(database, { ids: [7, 8] }), [author]);
  assert.deepEqual((calls.at(-1) as { values: unknown[] }).values, [[7, 8]]);
  rows = [authorValues, authorValues];
  assert.equal(await pg.getAuthor(database, { id: 7 }), null);
  rows = [];
  assert.equal(await pg.getAuthor(database, { id: 7 }), null);
  rows = [[7]];
  await assert.rejects(pg.getAuthor(database, { id: 7 }), /column count/);
  failure = new Error("connection failed");
  await assert.rejects(pg.getAuthor(database, { id: 7 }), failure);
});

test("postgres.js uses unsafe values(), preserves parameters and returns write counts", async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  let rows: unknown[][] = [authorValues];
  // The stub implements the methods generated code invokes; the real driver's
  // generic pending-query object also has methods this test never calls.
  const database = {
    unsafe(sql: string, values: unknown[]) {
      calls.push({ sql, values });
      return {
        async values() {
          return Object.assign(rows, { count: 2 });
        },
      };
    },
  } as unknown as PostgresDatabase;
  assert.deepEqual(await postgres.getAuthor(database, { id: 7 }), author);
  assert.deepEqual(calls[0], { sql: postgres.getAuthorQuery, values: [7] });
  assert.deepEqual(await postgres.listAuthors(database), [author]);
  assert.equal(await postgres.deleteAuthor(database, { id: 7 }), 2n);
  assert.deepEqual(
    await postgres.insertAuthorResult(database, { id: 7, name: "Ada" }),
    { rowsAffected: 2n, lastInsertId: null },
  );
  assert.equal(
    await postgres.renameAuthor(database, { id: 7, name: "Grace" }),
    undefined,
  );
  assert.deepEqual(await postgres.findAuthors(database, { ids: [] }), [author]);
  assert.deepEqual(calls.at(-1)?.values, [[]]);
  rows = [authorValues, authorValues];
  assert.equal(await postgres.getAuthor(database, { id: 7 }), null);
  rows = [];
  assert.equal(await postgres.getAuthor(database, { id: 7 }), null);
  rows = [[7, "Ada", null, "bad score"]];
  await assert.rejects(postgres.getAuthor(database, { id: 7 }), /number/);
});

test("mysql2 binds slices, uses array rows, reports writes and rejects unsafe counts", async () => {
  const calls: Record<string, unknown>[] = [];
  let result: unknown = [authorValues];
  const database = {
    async execute(config: Record<string, unknown>) {
      calls.push(config);
      return [result, []];
    },
  } as unknown as MySQLDatabase;
  assert.deepEqual(await mysql.getAuthor(database, { id: 7 }), author);
  assert.deepEqual(calls[0], {
    sql: mysql.getAuthorQuery,
    values: [7],
    rowsAsArray: true,
    supportBigNumbers: false,
    bigNumberStrings: false,
  });
  assert.deepEqual(await mysql.findAuthors(database, { ids: [7, 8] }), [
    author,
  ]);
  assert.deepEqual(calls.at(-1)?.values, [7, 8]);
  assert.match(String(calls.at(-1)?.sql), /IN \(\?, \?\)/);
  await mysql.findAuthors(database, { ids: [] });
  assert.match(String(calls.at(-1)?.sql), /IN \(NULL\)/);
  result = { affectedRows: 2, insertId: 7 };
  assert.equal(await mysql.deleteAuthor(database, { id: 7 }), 2n);
  assert.equal(await mysql.insertAuthor(database, { id: 7, name: "Ada" }), 7);
  assert.deepEqual(
    await mysql.insertAuthorResult(database, { id: 7, name: "Ada" }),
    { rowsAffected: 2n, lastInsertId: 7n },
  );
  result = { affectedRows: 1, insertId: 2 ** 53 };
  await assert.rejects(
    mysql.insertAuthorResult(database, { id: 7, name: "Ada" }),
    /unsafe integer/,
  );
  result = [authorValues, authorValues];
  assert.equal(await mysql.getAuthor(database, { id: 7 }), null);
  result = [];
  assert.equal(await mysql.getAuthor(database, { id: 7 }), null);
});

test("mysql2 big-number options agree with generated BIGINT result types", async () => {
  const calls: Record<string, unknown>[] = [];
  const createdAt = new Date("2026-09-07T00:00:00Z");
  let id: string | number = "9007199254740993";
  const database = {
    async execute(config: Record<string, unknown>) {
      calls.push(config);
      return [[[id, 1, createdAt, null, null]], []];
    },
  } as unknown as MySQLDatabase;
  assert.equal(
    (await mysqlStrings.getRecord(database, { id: "9007199254740993" }))?.id,
    id,
  );
  assert.equal(calls.at(-1)?.supportBigNumbers, true);
  assert.equal(calls.at(-1)?.bigNumberStrings, true);
  assert.equal(
    (await mysqlMixed.getRecord(database, { id: "9007199254740993" }))?.id,
    id,
  );
  assert.equal(calls.at(-1)?.bigNumberStrings, false);
  id = 7;
  assert.equal((await mysqlMixed.getRecord(database, { id: 7 }))?.id, 7);
});
