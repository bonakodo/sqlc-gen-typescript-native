import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";
import postgres from "postgres";
import mysql from "mysql2/promise";

// These databases are test-only: the tests create and drop their own tables.
const pgURL = process.env.SQLC_LIVE_PG_URL ??
  "postgres://sqlc_test:sqlc_test@127.0.0.1:55432/sqlc_test";
const mysqlURL = process.env.SQLC_LIVE_MYSQL_URL ??
  "mysql://sqlc_test:sqlc_test@127.0.0.1:53306/sqlc_test";
const enabled = process.env.SQLC_LIVE_TEST === "1";
const generated = (driver: string) =>
  import(
    new URL(`./.integration/live/${driver}/query_sql.ts`, import.meta.url).href
  );
const existing = (driver: string) =>
  import(
    new URL(`./.integration/${driver}/wasm/query_sql.ts`, import.meta.url).href
  );
const schema = (engine: string) =>
  readFile(new URL(`./live/${engine}/schema.sql`, import.meta.url), "utf8");
const baseSchema = (engine: string) =>
  readFile(
    new URL(
      `../internal/endtoend/testdata/${engine}/schema.sql`,
      import.meta.url,
    ),
    "utf8",
  );

test(
  "live PostgreSQL: pg and postgres.js preserve JSON, arrays, geometry, shared binds, CRUD, and transactions",
  { skip: !enabled },
  async () => {
    const client = new pg.Client({ connectionString: pgURL });
    await client.connect();
    const sql = postgres(pgURL, { max: 1 });
    try {
      await client.query(
        "DROP TABLE IF EXISTS live_probes, records, authors; DROP TYPE IF EXISTS live_mood, mood;",
      );
      await client.query(await schema("postgresql"));
      await client.query(await baseSchema("postgresql"));
      for (const driver of ["pg", "postgres"]) {
        const q = await generated(driver);
        const base = await existing(`node-${driver}`);
        const database = driver === "pg" ? client : sql;
        await q.deleteProbes(database);
        const docs = [
          "text",
          [1, "two", { nested: true }],
          { object: [1, 2] },
          null,
        ];
        for (let id = 1; id <= docs.length; id++) {
          await q.insertProbe(database, {
            id,
            document: docs[id - 1],
            states: ["quiet", "comma,value", "NULL", null],
            numbers: driver === "pg" ? [1.25, null, 3] : ["1.25", null, "3"],
            boxes: ["(3,4),(1,2)", null, "(7,8),(5,6)"],
            pt: driver === "pg" ? { x: 1, y: 2 } : "(1,2)",
            disk: driver === "pg" ? { x: 1, y: 2, radius: 3 } : "<(1,2),3>",
          });
          const row = await q.getProbe(database, { id });
          assert.deepEqual(row.document, docs[id - 1]);
          assert.deepEqual(row.states, ["quiet", "comma,value", "NULL", null]);
          assert.deepEqual(
            row.numbers,
            driver === "pg" ? [1.25, null, 3] : ["1.25", null, "3"],
          );
          assert.deepEqual(row.boxes, ["(3,4),(1,2)", null, "(7,8),(5,6)"]);
          assert.deepEqual(row.pt, driver === "pg" ? { x: 1, y: 2 } : "(1,2)");
          assert.deepEqual(
            row.disk,
            driver === "pg" ? { x: 1, y: 2, radius: 3 } : "<(1,2),3>",
          );
        }
        assert.equal((await q.repeatedProbe(database, { id: null })).length, 4);
        const jsonDocuments = [
          [1, [2, null]],
          { text: 'comma, quote" brace}' },
          "a JSON string",
          null,
        ];
        const jsonRow = await q.setJSONArrays(database, {
          id: 1,
          jsonDocuments,
          documents: jsonDocuments,
          optionalDocument: null,
          optionalDocuments: null,
        });
        assert.deepEqual(jsonRow, {
          jsonDocuments,
          documents: jsonDocuments,
          optionalDocument: null,
          optionalDocuments: null,
        });
        const emptyJSONArrays = await q.setJSONArrays(database, {
          id: 1,
          jsonDocuments: [],
          documents: [],
          optionalDocument: { nested: [null, true] },
          optionalDocuments: jsonDocuments,
        });
        assert.deepEqual(emptyJSONArrays, {
          jsonDocuments: [],
          documents: [],
          optionalDocument: { nested: [null, true] },
          optionalDocuments: jsonDocuments,
        });
        assert.deepEqual(
          await q.literalProbe(database, { arg1: "safe' value" }),
          { literal: "?", value: "safe' value" },
        );
        const author = { id: 10, name: "Ada", bio: null, score: 2.5 };
        await base.createAuthor(database, author);
        assert.deepEqual(await base.getAuthor(database, { id: 10 }), author);
        assert.deepEqual(
          await base.findAuthors(database, { ids: [10, null] }),
          [author],
        );
        if (driver === "pg") {
          await client.query("BEGIN");
          await base.renameAuthor(client, { id: 10, name: "Rolled back" });
          await client.query("ROLLBACK");
        } else {
          await assert.rejects(
            sql.begin(async (tx) => {
              await base.renameAuthor(tx, { id: 10, name: "Rolled back" });
              throw new Error("rollback test");
            }),
            /rollback test/,
          );
        }
        assert.equal((await base.getAuthor(database, { id: 10 })).name, "Ada");
        assert.equal(await base.deleteAuthor(database, { id: 10 }), 1n);
        assert.equal(await q.deleteProbes(database), 4n);
        console.log(
          `live ${driver}: JSON, arrays, geometry, shared binds, CRUD, rollback passed`,
        );
      }
    } finally {
      await sql.end();
      await client.query(
        "DROP TABLE IF EXISTS live_probes, records, authors; DROP TYPE IF EXISTS live_mood, mood;",
      );
      await client.end();
    }
  },
);

test(
  "live MySQL: prepared literals, JSON, slices, exact BIGINT modes, CRUD, and rollback",
  { skip: !enabled },
  async () => {
    const client = await mysql.createConnection(mysqlURL);
    try {
      await client.query(
        "DROP TABLE IF EXISTS live_probes, live_insert_ids, live_unsigned_insert_ids, records, authors",
      );
      for (
        const statement
          of ((await schema("mysql")) + (await baseSchema("mysql"))).split(";")
            .filter((x) => x.trim())
      ) {
        await client.query(statement);
      }
      const q = await generated("mysql2");
      const base = await existing("node-mysql2");
      const ids: number[] = [];
      for (
        const document of ["text", [1, "two", { nested: true }], {
          object: [1, 2],
        }, null]
      ) {
        const id = await q.insertProbe(client, { document });
        ids.push(id);
        assert.deepEqual(await q.getProbe(client, { id }), {
          id,
          document,
          label: "? literal",
        });
      }
      assert.deepEqual(await q.literalProbe(client, { arg1: "safe' value" }), {
        literal: "?",
        value: "safe' value",
      });
      assert.deepEqual(
        await q.findProbes(client, { ids }),
        ids.map((id) => ({ id })),
      );
      assert.deepEqual(await q.findProbes(client, { ids: [] }), []);
      assert.equal(
        await base.insertAuthor(client, { id: 10, name: "Ada" }),
        10,
      );
      await client.beginTransaction();
      await base.renameAuthor(client, { id: 10, name: "Rolled back" });
      await client.rollback();
      assert.equal((await base.getAuthor(client, { id: 10 })).name, "Ada");
      await client.execute(
        "INSERT INTO records (id, active, created_at, document) VALUES (?, ?, ?, ?)",
        ["9007199254740993", 1, "2026-09-07 00:00:00", '{"a":1}'],
      );
      await client.execute(
        "INSERT INTO records (id, active, created_at) VALUES (?, ?, ?)",
        [7, 1, "2026-09-07 00:00:00"],
      );
      for (const mode of ["mysql-strings", "mysql-mixed"]) {
        const big = await existing(mode);
        const row = await big.getRecord(client, { id: "9007199254740993" });
        assert.equal(row.id, "9007199254740993");
        assert.deepEqual(row.document, { a: 1 });
        const small = await big.getRecord(client, {
          id: mode === "mysql-strings" ? "7" : 7,
        });
        assert.equal(small.id, mode === "mysql-strings" ? "7" : 7);
      }
      assert.equal(await base.deleteAuthor(client, { id: 10 }), 1n);
      assert.equal(await q.deleteProbes(client), 4n);
      // mysql2 decodes OK-packet IDs using connection options. Generate both
      // query modes and exercise each against both connection configurations.
      const stringClient = await mysql.createConnection({
        uri: mysqlURL,
        supportBigNumbers: true,
        bigNumberStrings: true,
      });
      try {
        for (const connection of [client, stringClient]) {
          for (const mode of ["mysql2-mixed", "mysql2-strings"]) {
            const exact = await generated(mode);
            await connection.query("TRUNCATE TABLE live_insert_ids");
            assert.equal(
              await exact.insertExactID(connection, { label: "small" }),
              mode === "mysql2-strings" ? "1" : 1,
            );
            for (const id of ["9007199254740993", "9223372036854775805"]) {
              await connection.query("TRUNCATE TABLE live_insert_ids");
              await connection.query(
                `ALTER TABLE live_insert_ids AUTO_INCREMENT = ${id}`,
              );
              assert.equal(
                await exact.insertExactID(connection, { label: "large" }),
                id,
              );
              // Near the integer limit InnoDB can skip an ID on the next
              // allocation. Give each annotation the same known first ID.
              await connection.query("TRUNCATE TABLE live_insert_ids");
              await connection.query(
                `ALTER TABLE live_insert_ids AUTO_INCREMENT = ${id}`,
              );
              assert.deepEqual(
                await exact.insertExactResult(connection, { label: "result" }),
                { rowsAffected: 1n, lastInsertId: BigInt(id) },
              );
            }
          }
          await connection.query("TRUNCATE TABLE live_insert_ids");
          assert.equal(
            await q.insertExactID(connection, { label: "default small" }),
            1,
          );
          await connection.query(
            "ALTER TABLE live_insert_ids AUTO_INCREMENT = 9007199254740993",
          );
          await assert.rejects(
            q.insertExactID(connection, { label: "default large" }),
            { name: "RangeError" },
          );
          // The error reports an unsafe return value after execution. Prove
          // that the row exists so callers do not treat it as a failed INSERT.
          const [stored] = await connection.query<mysql.RowDataPacket[]>(
            "SELECT CAST(id AS CHAR) AS id FROM live_insert_ids WHERE label = 'default large'",
          );
          assert.equal(stored[0]?.id, "9007199254740993");
          const signed = await generated("mysql2-signed");
          await connection.query("TRUNCATE TABLE live_insert_ids");
          assert.equal(
            await signed.insertSignedID(connection, {
              id: "-1",
              label: "signed",
            }),
            "-1",
          );
          assert.deepEqual(
            await signed.insertSignedResult(connection, {
              id: "-9223372036854775808",
              label: "signed result",
            }),
            { rowsAffected: 1n, lastInsertId: -9223372036854775808n },
          );
          const unsigned = await generated("mysql2-unsigned");
          for (const id of ["9223372036854775809", "18446744073709551613"]) {
            await connection.query("TRUNCATE TABLE live_unsigned_insert_ids");
            await connection.query(
              `ALTER TABLE live_unsigned_insert_ids AUTO_INCREMENT = ${id}`,
            );
            assert.equal(
              await unsigned.insertUnsignedID(connection, {
                label: "unsigned",
              }),
              id,
            );
            await connection.query("TRUNCATE TABLE live_unsigned_insert_ids");
            await connection.query(
              `ALTER TABLE live_unsigned_insert_ids AUTO_INCREMENT = ${id}`,
            );
            assert.deepEqual(
              await unsigned.insertUnsignedResult(connection, {
                label: "unsigned result",
              }),
              { rowsAffected: 1n, lastInsertId: BigInt(id) },
            );
          }
          // MySQL reserves the auto-increment limit, but an explicit unsigned
          // key can use all 64 bits. mysql2 reports this exact value as -1.
          await connection.query("TRUNCATE TABLE live_unsigned_insert_ids");
          assert.equal(
            await unsigned.insertUnsignedValue(connection, {
              id: "18446744073709551615",
              label: "unsigned maximum",
            }),
            "18446744073709551615",
          );
          await connection.query("TRUNCATE TABLE live_unsigned_insert_ids");
          assert.deepEqual(
            await unsigned.insertUnsignedValueResult(connection, {
              id: "18446744073709551615",
              label: "unsigned maximum result",
            }),
            { rowsAffected: 1n, lastInsertId: 18446744073709551615n },
          );
          // Omitting signedness rejects the same negative packet for both
          // annotations, whether it came from a signed or unsigned SQL column.
          await assert.rejects(
            q.insertSignedID(connection, { id: -2, label: "ambiguous signed" }),
            /ambiguous negative insert ID/,
          );
          await assert.rejects(
            q.insertSignedResult(connection, {
              id: -3,
              label: "ambiguous signed result",
            }),
            /ambiguous negative insert ID/,
          );
          await connection.query("TRUNCATE TABLE live_unsigned_insert_ids");
          await connection.query(
            "ALTER TABLE live_unsigned_insert_ids AUTO_INCREMENT = 9223372036854775809",
          );
          await assert.rejects(
            q.insertUnsignedID(connection, { label: "ambiguous unsigned" }),
            /ambiguous negative insert ID/,
          );
          await assert.rejects(
            q.insertUnsignedResult(connection, {
              label: "ambiguous unsigned result",
            }),
            /ambiguous negative insert ID/,
          );
        }
      } finally {
        await stringClient.end();
      }
      console.log(
        "live mysql2: literals, JSON, slices, exact BIGINT fields and insert IDs, CRUD, rollback passed",
      );
    } finally {
      await client.query(
        "DROP TABLE IF EXISTS live_probes, live_insert_ids, live_unsigned_insert_ids, records, authors",
      );
      await client.end();
    }
  },
);
