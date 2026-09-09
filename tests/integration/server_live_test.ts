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
    new URL(`./.generated/live/${driver}/query_sql.ts`, import.meta.url).href
  );
const existing = (driver: string) =>
  import(
    new URL(`./.generated/${driver}/wasm/query_sql.ts`, import.meta.url).href
  );
const schema = (engine: string) =>
  readFile(new URL(`./live/${engine}/schema.sql`, import.meta.url), "utf8");
const baseSchema = (engine: string) =>
  readFile(
    new URL(
      `../fixtures/${engine}/schema.sql`,
      import.meta.url,
    ),
    "utf8",
  );

const temporaryAuthors =
  "CREATE TEMPORARY TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, bio TEXT, score DOUBLE PRECISION NOT NULL DEFAULT 0)";

// Use server counters, rather than driver-private cache fields: deleting a JS
// entry alone does not establish that the server released its statement.
async function mysqlStatus(connection: mysql.Connection, global = false) {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    `SHOW ${
      global ? "GLOBAL" : "SESSION"
    } STATUS WHERE Variable_name IN ('Com_stmt_prepare', 'Com_stmt_close', 'Com_stmt_reprepare', 'Prepared_stmt_count')`,
  );
  return Object.fromEntries(
    rows.map((row) => [String(row.Variable_name), Number(row.Value)]),
  ) as Record<string, number>;
}

test(
  "live pg: unnamed execution preserves pool ownership, errors, DDL, transactions, and connection replacement",
  { skip: !enabled },
  async (t) => {
    const q = await existing("node-pg");
    const pool = new pg.Pool({ connectionString: pgURL, max: 2 });
    let ended = false;
    t.after(async () => {
      if (!ended) await pool.end();
    });
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      for (const [index, client] of clients.entries()) {
        await client.query(temporaryAuthors);
        await q.createAuthor(client, {
          id: 1,
          name: `connection ${index}`,
          bio: null,
          score: 0,
        });
      }
      const rows = await Promise.all(
        clients.flatMap((client) => [
          q.getAuthor(client, { id: 1 }),
          q.getAuthor(client, { id: 2 }),
        ]),
      );
      assert.deepEqual(rows.map((row) => row?.name ?? null), [
        "connection 0",
        null,
        "connection 1",
        null,
      ]);
      const client = clients[0]!;
      await assert.rejects(q.getAuthor(client, {}), {
        name: "QueryCodecError",
      });
      await assert.rejects(
        q.createAuthor(client, {
          id: 1,
          name: "duplicate",
          bio: null,
          score: 0,
        }),
        { code: "23505" },
      );
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "connection 0");
      await client.query("BEGIN");
      await q.renameAuthor(client, { id: 1, name: "transaction" });
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "transaction");
      await client.query("ROLLBACK");
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "connection 0");
      await client.query("ALTER TABLE authors ADD COLUMN extra TEXT");
      assert.equal((await q.listAuthors(client)).length, 1);
      await client.query("ALTER TABLE authors RENAME COLUMN name TO old_name");
      await assert.rejects(q.getAuthor(client, { id: 1 }), { code: "42703" });
      await client.query("ALTER TABLE authors RENAME COLUMN old_name TO name");
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "connection 0");
      await client.query("RESET ALL");
      const before = process.memoryUsage();
      const started = performance.now();
      for (let index = 0; index < 200; index++) {
        assert.equal((await q.getAuthor(client, { id: 1 })).id, 1);
      }
      const milliseconds = performance.now() - started;
      for (const connection of clients) {
        assert.deepEqual(
          (await connection.query("SELECT name FROM pg_prepared_statements"))
            .rows,
          [],
        );
      }
      const after = process.memoryUsage();
      console.log(JSON.stringify({
        driver: "pg",
        server:
          (await client.query("SHOW server_version")).rows[0].server_version,
        policy: "unnamed (generated default)",
        calls: 200,
        milliseconds,
        retainedNamedStatements: 0,
        rssDelta: after.rss - before.rss,
        heapUsedDelta: after.heapUsed - before.heapUsed,
      }));
    } finally {
      for (const client of clients) client.release(true);
    }
    try {
      const live = await generated("pg");
      assert.deepEqual(
        await Promise.all(
          Array.from(
            { length: 8 },
            (_, index) => live.literalProbe(pool, { arg1: String(index) }),
          ),
        ),
        Array.from(
          { length: 8 },
          (_, index) => ({ literal: "?", value: String(index) }),
        ),
      );
    } finally {
      await pool.end();
      ended = true;
    }
    await assert.rejects(q.getAuthor(pool, { id: 1 }), /after calling end/);
  },
);

test(
  "live postgres.js: unsafe defaults, reserved connections, concurrent transactions, cursor ownership, and reconnects",
  { skip: !enabled },
  async (t) => {
    const q = await existing("node-postgres");
    const live = await generated("postgres");
    const sql = postgres(pgURL, { max: 2, prepare: true });
    t.after(() => sql.end());
    const reserved = await Promise.all([sql.reserve(), sql.reserve()]);
    const preparationSnapshot = async (connection: postgres.ReservedSql) =>
      Array.from(
        await connection.unsafe(
          "SELECT name, statement FROM pg_prepared_statements ORDER BY name",
        ),
        ({ name, statement }) => ({ name, statement }),
      );
    const preparationBaseline = await Promise.all(
      reserved.map(preparationSnapshot),
    );
    try {
      for (const [index, connection] of reserved.entries()) {
        await connection.unsafe(temporaryAuthors);
        await q.createAuthor(connection, {
          id: 1,
          name: `connection ${index}`,
          bio: null,
          score: 0,
        });
      }
      const results = await Promise.all(
        reserved.map((connection) => q.getAuthor(connection, { id: 1 })),
      );
      assert.deepEqual(results.map((row) => row.name), [
        "connection 0",
        "connection 1",
      ]);
      const connection = reserved[0]!;
      await assert.rejects(q.getAuthor(connection, {}), {
        name: "QueryCodecError",
      });
      await assert.rejects(
        q.createAuthor(connection, {
          id: 1,
          name: "duplicate",
          bio: null,
          score: 0,
        }),
        { code: "23505" },
      );
      await connection.unsafe(
        "ALTER TABLE authors RENAME COLUMN name TO old_name",
      );
      await assert.rejects(q.getAuthor(connection, { id: 1 }), {
        code: "42703",
      });
      await connection.unsafe(
        "ALTER TABLE authors RENAME COLUMN old_name TO name",
      );
      assert.equal(
        (await q.getAuthor(connection, { id: 1 })).name,
        "connection 0",
      );
      const before = process.memoryUsage();
      const started = performance.now();
      for (let index = 0; index < 200; index++) {
        assert.equal((await q.getAuthor(connection, { id: 1 })).id, 1);
      }
      const milliseconds = performance.now() - started;
      assert.deepEqual(
        await Promise.all(reserved.map(preparationSnapshot)),
        preparationBaseline,
      );
      const after = process.memoryUsage();
      console.log(JSON.stringify({
        driver: "postgres.js",
        policy:
          "unsafe prepare:false (generated default), connection prepare:true",
        calls: 200,
        milliseconds,
        retainedGeneratedStatements: 0,
        retainedDriverStartupStatements: preparationBaseline[0]!.length,
        rssDelta: after.rss - before.rss,
        heapUsedDelta: after.heapUsed - before.heapUsed,
      }));
      // A driver-owned cursor keeps one physical connection busy. Generated
      // reads on another reserved connection must neither close nor steal it.
      let cursorRows = 0;
      for await (
        const rows of connection.unsafe("SELECT generate_series(1, 3) AS id")
          .cursor(1)
      ) {
        cursorRows += rows.length;
        assert.equal(
          (await q.getAuthor(reserved[1], { id: 1 })).name,
          "connection 1",
        );
      }
      assert.equal(cursorRows, 3);
    } finally {
      for (const connection of reserved) connection.release();
    }
    try {
      await Promise.all([0, 1].map(async (index) => {
        await assert.rejects(
          sql.begin(async (tx) => {
            await q.renameAuthor(tx, { id: 1, name: `rollback ${index}` });
            assert.equal(
              (await q.getAuthor(tx, { id: 1 })).name,
              `rollback ${index}`,
            );
            throw new Error("rollback lifetime test");
          }),
          /rollback lifetime test/,
        );
      }));
      // Use the documented idle lifetime to replace a physical connection
      // while keeping the same pool handle. The driver's internal close()
      // method is absent from its published Sql type and is not used here.
      let closeIdle = () => {};
      const idleClosed = new Promise<void>((resolve) => {
        closeIdle = resolve;
      });
      const reconnecting = postgres(pgURL, {
        max: 1,
        idle_timeout: 0.02,
        onclose: () => closeIdle(),
      });
      try {
        const [before] = await reconnecting.unsafe(
          "SELECT pg_backend_pid() AS pid",
        );
        await idleClosed;
        assert.equal(
          (await live.literalProbe(reconnecting, { arg1: "reconnected" }))
            .value,
          "reconnected",
        );
        const [after] = await reconnecting.unsafe(
          "SELECT pg_backend_pid() AS pid",
        );
        assert.notEqual(after?.pid, before?.pid);
      } finally {
        await reconnecting.end();
      }
    } finally {
      await sql.end();
    }
    await assert.rejects(
      live.literalProbe(sql, { arg1: "closed" }),
      /CONNECTION_ENDED/,
    );
  },
);

test(
  "live mysql2: driver LRU bounds SQL variants, closes evictions, and preserves reset and pool ownership",
  { skip: !enabled },
  async (t) => {
    const q = await existing("node-mysql2");
    const live = await generated("mysql2");
    const observer = await mysql.createConnection(mysqlURL);
    t.after(() => observer.end());
    const baseline = (await mysqlStatus(observer, true)).Prepared_stmt_count!;
    const pool = mysql.createPool({
      uri: mysqlURL,
      connectionLimit: 2,
      maxPreparedStatements: 3,
    });
    const clients = await Promise.all([
      pool.getConnection(),
      pool.getConnection(),
    ]);
    try {
      for (const [index, client] of clients.entries()) {
        await client.query(temporaryAuthors);
        await q.insertAuthor(client, { id: 1, name: `connection ${index}` });
      }
      const results = await Promise.all(clients.flatMap((client) => [
        q.getAuthor(client, { id: 1 }),
        q.getAuthor(client, { id: 2 }),
      ]));
      assert.deepEqual(results.map((row) => row?.name ?? null), [
        "connection 0",
        null,
        "connection 1",
        null,
      ]);
      const client = clients[0]!;
      const initial = await mysqlStatus(client);
      await assert.rejects(q.getAuthor(client, {}), {
        name: "QueryCodecError",
      });
      assert.equal(
        (await mysqlStatus(client)).Com_stmt_prepare,
        initial.Com_stmt_prepare,
      );
      await assert.rejects(
        q.insertAuthor(client, { id: 1, name: "duplicate" }),
        { code: "ER_DUP_ENTRY" },
      );
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "connection 0");
      await client.beginTransaction();
      await q.renameAuthor(client, { id: 1, name: "transaction" });
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "transaction");
      await client.rollback();
      const beforeReuse = await mysqlStatus(client);
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "connection 0");
      assert.equal(
        (await mysqlStatus(client)).Com_stmt_prepare,
        beforeReuse.Com_stmt_prepare,
      );
      await client.query("ALTER TABLE authors ADD COLUMN extra TEXT");
      assert.equal((await q.getAuthor(client, { id: 1 })).id, 1);
      await client.query("ALTER TABLE authors RENAME COLUMN name TO old_name");
      await assert.rejects(q.getAuthor(client, { id: 1 }), {
        code: "ER_BAD_FIELD_ERROR",
      });
      await client.query("ALTER TABLE authors RENAME COLUMN old_name TO name");
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "connection 0");

      const before = process.memoryUsage();
      const stats = await mysqlStatus(client);
      const started = performance.now();
      for (let index = 0; index < 200; index++) {
        assert.equal((await q.getAuthor(client, { id: 1 })).id, 1);
      }
      const milliseconds = performance.now() - started;
      assert.equal(
        (await mysqlStatus(client)).Com_stmt_prepare,
        stats.Com_stmt_prepare,
      );
      const after = process.memoryUsage();
      const lruBefore = await mysqlStatus(client);
      for (const length of [1, 2, 3, 1, 4, 1, 2]) {
        assert.equal(
          (await q.findAuthors(client, { ids: Array(length).fill(1) })).length,
          1,
        );
      }
      // Accessing variant 1 keeps it live; adding 4 evicts variant 2, which
      // needs preparation when requested again. FIFO would prepare 1 again.
      assert.equal(
        (await mysqlStatus(client)).Com_stmt_prepare! -
          lruBefore.Com_stmt_prepare!,
        5,
      );
      const churnBefore = await mysqlStatus(client);
      for (let index = 0; index < 120; index++) {
        assert.equal(
          (await q.findAuthors(client, { ids: Array(index + 10).fill(1) }))
            .length,
          1,
        );
        await mysqlStatus(client);
        assert(
          (await mysqlStatus(observer, true)).Prepared_stmt_count! <=
            baseline + 6,
        );
      }
      const churnAfter = await mysqlStatus(client);
      assert.equal(
        churnAfter.Com_stmt_prepare! - churnBefore.Com_stmt_prepare!,
        120,
      );
      assert(churnAfter.Com_stmt_close! - churnBefore.Com_stmt_close! >= 117);
      console.log(JSON.stringify({
        driver: "mysql2",
        server: (await client.query<mysql.RowDataPacket[]>(
          "SELECT VERSION() AS version",
        ))[0][0]!.version,
        policy: "execute driver LRU, capacity 3 per physical connection",
        calls: 200,
        milliseconds,
        repeatPreparations: 0,
        churnPreparations: churnAfter.Com_stmt_prepare! -
          churnBefore.Com_stmt_prepare!,
        churnCloses: churnAfter.Com_stmt_close! - churnBefore.Com_stmt_close!,
        retainedStatementBound: 6,
        rssDelta: after.rss - before.rss,
        heapUsedDelta: after.heapUsed - before.heapUsed,
      }));
      await client.reset();
      await client.query(temporaryAuthors);
      await q.insertAuthor(client, { id: 1, name: "after reset" });
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "after reset");
      const beforeUnprepare = await mysqlStatus(client);
      client.unprepare({ sql: q.getAuthorQuery, rowsAsArray: true });
      assert.equal(
        (await mysqlStatus(client)).Com_stmt_close! -
          beforeUnprepare.Com_stmt_close!,
        1,
      );
      assert.equal((await q.getAuthor(client, { id: 1 })).name, "after reset");
      assert.equal(
        (await mysqlStatus(client)).Com_stmt_prepare! -
          beforeUnprepare.Com_stmt_prepare!,
        1,
      );
      const beforeRelease = await mysqlStatus(client);
      client.release();
      const returned = await pool.getConnection();
      assert.equal(
        (await q.getAuthor(returned, { id: 1 })).name,
        "after reset",
      );
      assert.equal(
        (await mysqlStatus(returned)).Com_stmt_prepare,
        beforeRelease.Com_stmt_prepare,
      );
      returned.release();
      clients[1]!.release();
      assert.equal(
        (await live.literalProbe(pool, { arg1: "pool" })).value,
        "pool",
      );
    } finally {
      await pool.end();
    }
    // COM_STMT_CLOSE has no acknowledgement. A round trip on each owning
    // connection above orders eviction; after pool.end(), poll the server.
    for (let attempt = 0; attempt < 20; attempt++) {
      if (
        (await mysqlStatus(observer, true)).Prepared_stmt_count === baseline
      ) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      (await mysqlStatus(observer, true)).Prepared_stmt_count,
      baseline,
    );
    await assert.rejects(
      live.literalProbe(pool, { arg1: "closed" }),
      /Pool is closed/,
    );
    const replacement = await mysql.createConnection({
      uri: mysqlURL,
      maxPreparedStatements: 1,
    });
    try {
      assert.equal(
        (await live.literalProbe(replacement, { arg1: "new connection" }))
          .value,
        "new connection",
      );
    } finally {
      await replacement.end();
    }
  },
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
      const { QueryCodecError } = await import(
        new URL("./.generated/live/mysql2/codec_error.ts", import.meta.url)
          .href
      ) as typeof import("./.generated/live/mysql2/codec_error.ts");
      const codecFailure = (
        query: string,
        expectedType: "number" | "bigint",
        message: RegExp,
      ) =>
      (error: unknown): boolean => {
        assert(error instanceof QueryCodecError);
        assert(error instanceof TypeError);
        assert.equal(error.query, query);
        assert.equal(error.file, "query.sql");
        assert.equal(error.field, "lastInsertId");
        assert.equal(error.expectedType, expectedType);
        assert.equal(error.phase, "decode");
        const cause = error.originalCause();
        assert(cause instanceof RangeError);
        assert.match(cause.message, message);
        assert(error.cause instanceof Error);
        assert.equal(error.cause.message, "Value conversion failed");
        return true;
      };
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
            codecFailure("InsertExactID", "number", /safe integer range/),
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
            codecFailure(
              "InsertSignedID",
              "number",
              /ambiguous negative insert ID/,
            ),
          );
          await assert.rejects(
            q.insertSignedResult(connection, {
              id: -3,
              label: "ambiguous signed result",
            }),
            codecFailure(
              "InsertSignedResult",
              "bigint",
              /ambiguous negative insert ID/,
            ),
          );
          await connection.query("TRUNCATE TABLE live_unsigned_insert_ids");
          await connection.query(
            "ALTER TABLE live_unsigned_insert_ids AUTO_INCREMENT = 9223372036854775809",
          );
          await assert.rejects(
            q.insertUnsignedID(connection, { label: "ambiguous unsigned" }),
            codecFailure(
              "InsertUnsignedID",
              "number",
              /ambiguous negative insert ID/,
            ),
          );
          await assert.rejects(
            q.insertUnsignedResult(connection, {
              label: "ambiguous unsigned result",
            }),
            codecFailure(
              "InsertUnsignedResult",
              "bigint",
              /ambiguous negative insert ID/,
            ),
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
