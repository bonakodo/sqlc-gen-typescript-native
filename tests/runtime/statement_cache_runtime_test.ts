import assert from "node:assert/strict";
import { Database } from "@bonakodo/sqlite";
import * as generated from "./.generated/sqlite/runtime_sqlite.ts";

type Value = null | string | number | bigint | Uint8Array;
interface CacheRuntime {
  configureStatementCache(db: Database, capacity: number): void;
  clearStatementCache(db: Database): void;
  queryOne<T>(
    db: Database,
    sql: string,
    params: readonly Value[],
    read: (row: Value[], context: undefined) => T,
    context: undefined,
    missing: null,
  ): T | null;
  queryMany<T>(
    db: Database,
    sql: string,
    params: readonly Value[],
    read: (row: Value[], context: undefined) => T,
    context: undefined,
  ): T[];
  runQuery<T>(
    db: Database,
    sql: string,
    params: readonly Value[],
    read: (result: { changes: number; lastInsertRowid: number | bigint }) => T,
  ): T;
}
const runtime = generated as unknown as CacheRuntime;
const first = (row: Value[]) => row[0];
const read = (db: Database, sql = "SELECT ?", params: Value[] = [1n]) =>
  runtime.queryOne(db, sql, params, first, undefined, null);

function fake() {
  const events: string[] = [];
  let serial = 0;
  let fail = "";
  const error = new Error("driver or reset error");
  const cleanupError = new Error("cleanup error");
  const db = {
    open: true,
    prepare(sql: string) {
      const id = ++serial;
      events.push(`prepare:${id}:${sql}`);
      if (fail === "prepare") throw error;
      let alive = true;
      return {
        safeIntegers() {
          events.push(`safe:${id}`);
          if (fail === "safe") throw error;
          return this;
        },
        raw() {
          events.push(`raw:${id}`);
          if (fail === "raw") throw error;
          return this;
        },
        get(params: Value[]) {
          assert(alive);
          events.push(`get:${id}`);
          // Public driver methods include reset/clear before returning. A
          // reported reset error has the same contract as an execution error.
          if (fail === "get" || fail === "reset") throw error;
          return params;
        },
        run() {
          assert(alive);
          events.push(`run:${id}`);
          if (fail === "run" || fail === "reset") throw error;
          return { changes: 1, lastInsertRowid: 1n };
        },
        [Symbol.dispose]() {
          assert(alive, "no double disposal");
          events.push(`dispose:${id}`);
          if (fail === "dispose" || fail === "both") throw cleanupError;
          alive = false;
        },
      };
    },
  } as unknown as Database;
  return {
    db,
    events,
    error,
    cleanupError,
    fail(value: string) {
      fail = value;
    },
  };
}

Deno.test("cache reuses configured statements, keys SQL/mode, and evicts LRU", () => {
  const { db, events } = fake();
  runtime.configureStatementCache(db, 2);
  assert.equal(read(db, "SELECT ?", [1n]), 1n);
  assert.equal(read(db, "SELECT ?", [2n]), 2n);
  read(db, "SELECT ? + 1");
  read(db); // Most recent, so the other entry must leave first.
  read(db, "SELECT ? + 2");
  assert(events.includes("dispose:2"));
  assert(!events.includes("dispose:1"));
  assert.equal(events.filter((x) => x === "safe:1").length, 1);
  assert.equal(events.filter((x) => x === "raw:1").length, 1);
  runtime.runQuery(db, "SELECT ?", [9n], (result) => result.changes);
  assert.equal(events.filter((x) => x.startsWith("prepare:")).length, 4);
  runtime.clearStatementCache(db);
  assert.equal(events.filter((x) => x.startsWith("dispose:")).length, 4);
  read(db); // Clearing retains the configured limit and allows fresh prepare.
  runtime.clearStatementCache(db);
});

Deno.test("cache rejects bad capacity, supports zero, shrinking, and churn", () => {
  const { db, events } = fake();
  for (
    const capacity of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
  ) {
    assert.throws(
      () => runtime.configureStatementCache(db, capacity),
      RangeError,
    );
  }
  runtime.configureStatementCache(db, 0);
  read(db);
  read(db);
  assert.equal(events.filter((x) => x.startsWith("dispose:")).length, 2);
  runtime.configureStatementCache(db, 3);
  for (let i = 0; i < 1000; i++) read(db, `SELECT ? /* ${i} */`);
  assert.equal(
    events.filter((x) => x.startsWith("prepare:")).length -
      events.filter((x) => x.startsWith("dispose:")).length,
    3,
  );
  runtime.configureStatementCache(db, 1);
  assert.equal(
    events.filter((x) => x.startsWith("prepare:")).length -
      events.filter((x) => x.startsWith("dispose:")).length,
    1,
  );
  runtime.configureStatementCache(db, 0);
  assert.equal(
    events.filter((x) => x.startsWith("prepare:")).length,
    events.filter((x) => x.startsWith("dispose:")).length,
  );
});

Deno.test("active leases survive nested calls, clear, and capacity changes", () => {
  for (const action of ["same", "different", "clear", "disable"]) {
    const { db, events } = fake();
    runtime.configureStatementCache(db, 1);
    runtime.queryOne(
      db,
      "SELECT ?",
      [1n],
      () => {
        if (action === "clear") runtime.clearStatementCache(db);
        if (action === "disable") runtime.configureStatementCache(db, 0);
        assert(!events.includes("dispose:1"));
        assert.equal(
          read(db, action === "different" ? "SELECT ? + 1" : "SELECT ?", [2n]),
          2n,
        );
        assert(
          events.includes("dispose:2"),
          "nested fallback must be temporary",
        );
        assert(!events.includes("dispose:1"), "outer lease still active");
        return 1n;
      },
      undefined,
      null,
    );
    if (action === "clear" || action === "disable") {
      assert(events.includes("dispose:1"));
    }
    runtime.clearStatementCache(db);
  }
});

Deno.test("execution, reset, decode and cleanup errors discard without replay", () => {
  for (const point of ["prepare", "safe", "raw", "get", "reset", "decode"]) {
    const { db, events, fail, error } = fake();
    runtime.configureStatementCache(db, 1);
    fail(point);
    assert.throws(() =>
      runtime.queryOne(
        db,
        "SELECT ?",
        [1n],
        () => {
          throw error;
        },
        undefined,
        null,
      ), (caught) => caught === error);
    assert.equal(events.filter((x) => x.startsWith("prepare:")).length, 1);
    assert.equal(
      events.filter((x) => x.startsWith("dispose:")).length,
      point === "prepare" ? 0 : 1,
    );
    fail("");
    assert.equal(read(db, "SELECT ?", [2n]), 2n);
    runtime.clearStatementCache(db);
  }
  const { db, events, fail, cleanupError } = fake();
  runtime.configureStatementCache(db, 2);
  read(db);
  read(db, "SELECT ? + 1");
  fail("dispose");
  assert.throws(
    () => runtime.clearStatementCache(db),
    (caught) => caught === cleanupError,
  );
  assert.equal(
    events.filter((x) => x.startsWith("dispose:")).length,
    2,
    "clear tries every idle entry",
  );
  fail("");
  read(db);
  runtime.clearStatementCache(db);
  runtime.configureStatementCache(db, 0);
  fail("both");
  assert.throws(
    () =>
      runtime.queryOne(
        db,
        "SELECT ?",
        [1n],
        () => {
          throw new Error("conversion");
        },
        undefined,
        null,
      ),
    (caught) => caught === cleanupError,
    "preserve finally error precedence",
  );
});

Deno.test("real cached SQLite preserves bindings, rows, rollback, schema and close", () => {
  using db = new Database(":memory:");
  using other = new Database(":memory:");
  runtime.configureStatementCache(db, 4);
  runtime.configureStatementCache(other, 4);
  db.exec("CREATE TABLE entries(id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  other.exec(
    "CREATE TABLE entries(id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
  );
  const statements: ReturnType<Database["prepare"]>[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = <T>(sql: string) => {
    const stmt = prepare<T>(sql);
    statements.push(stmt as ReturnType<Database["prepare"]>);
    return stmt;
  };
  const insert = (id: bigint, value: string) =>
    runtime.runQuery(
      db,
      "INSERT INTO entries VALUES (?, ?)",
      [id, value],
      (result) => result,
    );
  assert.deepEqual(insert(1n, "a"), { changes: 1, lastInsertRowid: 1n });
  insert(2n, "b");
  assert.throws(() => insert(1n, "duplicate"), /UNIQUE/);
  insert(3n, "c");
  const select = "SELECT value FROM entries WHERE id = ?";
  assert.equal(read(db, select, [2n]), "b");
  assert.throws(() => read(db, select, []), /parameter/i);
  assert.equal(read(db, select, [3n]), "c");
  assert.equal(read(db, select, [99n]), null);
  assert.equal(read(other, select, [1n]), null);
  assert.deepEqual(
    runtime.queryMany(
      db,
      "SELECT value FROM entries ORDER BY id",
      [],
      first,
      undefined,
    ),
    ["a", "b", "c"],
  );
  assert.throws(
    db.transaction(() => {
      insert(4n, "rollback");
      assert.equal(read(db, select, [4n]), "rollback");
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(read(db, select, [4n]), null);
  const before = statements.length;
  db.transaction(() => read(db, select, [1n]))();
  assert.equal(statements.length, before, "commit does not flush cache");
  db.exec("ALTER TABLE entries ADD COLUMN extra TEXT");
  assert.equal(read(db, select, [1n]), "a");
  db.exec(
    "DROP TABLE entries; CREATE TABLE entries(id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO entries VALUES(1, 'new')",
  );
  assert.equal(read(db, select, [1n]), "new");
  using iteratorStmt = prepare("SELECT value FROM entries");
  const iterator = iteratorStmt.iterate();
  iterator.next();
  assert.equal(read(db, select, [1n]), "new");
  assert.throws(() => insert(9n, "busy"), /busy/);
  iterator.return?.();
  insert(9n, "ready");
  runtime.clearStatementCache(db);
  for (const stmt of statements) assert.throws(() => stmt.run(), /finalized/);
  read(db, select, [1n]);
  db.close(); // Driver close also owns all remaining native handles.
  runtime.clearStatementCache(db); // Clearing after close is safe.
  assert.throws(() => read(db, select, [1n]), /not open/);
  assert.equal(read(other, select, [1n]), null);
  runtime.clearStatementCache(other);
});

Deno.test("real driver reset callback errors escape unchanged and discard", () => {
  using db = new Database(":memory:");
  runtime.configureStatementCache(db, 1);
  const resetError = new Error("virtual cursor close failed");
  let failReset = true;
  let prepared = 0;
  const prepare = db.prepare.bind(db);
  db.prepare = <T>(sql: string) => {
    prepared++;
    return prepare<T>(sql);
  };
  db.table("reset_source", {
    columns: ["value"],
    rows: function* () {
      try {
        yield [1];
        yield [2];
      } finally {
        // Deliberately exercise a driver-reported reset/cleanup failure.
        // deno-lint-ignore no-unsafe-finally
        if (failReset) throw resetError;
      }
    },
  });
  assert.throws(
    () => read(db, "SELECT value FROM reset_source", []),
    (error) => error === resetError,
  );
  assert.equal(prepared, 1, "reset failure must not replay");
  failReset = false;
  assert.equal(read(db, "SELECT value FROM reset_source", []), 1);
  assert.equal(prepared, 2, "failed reset entry was discarded");
  runtime.clearStatementCache(db);
});

Deno.test("a rejected native disposal stays owned until clearing can retry", () => {
  using db = new Database(":memory:");
  runtime.configureStatementCache(db, 2);
  const prepared: ReturnType<Database["prepare"]>[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = <T>(sql: string) => {
    const stmt = prepare<T>(sql);
    prepared.push(stmt as ReturnType<Database["prepare"]>);
    return stmt;
  };
  read(db, "SELECT 1", []);
  db.function("clear_cache", () => {
    assert.throws(() => runtime.clearStatementCache(db), /busy/);
    return 0;
  });
  read(db, "SELECT clear_cache()", []);
  runtime.clearStatementCache(db);
  for (const stmt of prepared) assert.throws(() => stmt.get(), /finalized/);
});

Deno.test("stale handles fail once without replay and a later call prepares anew", () => {
  using db = new Database(":memory:");
  runtime.configureStatementCache(db, 1);
  const statements: ReturnType<Database["prepare"]>[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = <T>(sql: string) => {
    const stmt = prepare<T>(sql);
    statements.push(stmt as ReturnType<Database["prepare"]>);
    return stmt;
  };
  assert.equal(read(db), 1n);
  statements[0]![Symbol.dispose]();
  assert.throws(() => read(db), /finalized/);
  assert.equal(statements.length, 1);
  assert.equal(read(db, "SELECT ?", [2n]), 2n);
  assert.equal(statements.length, 2);
  runtime.clearStatementCache(db);
});

Deno.test("lowering capacity while two leases are active waits for their returns", () => {
  const { db, events } = fake();
  runtime.configureStatementCache(db, 2);
  runtime.queryOne(
    db,
    "outer",
    [1n],
    () => {
      runtime.queryOne(
        db,
        "inner",
        [2n],
        () => {
          runtime.configureStatementCache(db, 1);
          assert(!events.some((event) => event.startsWith("dispose:")));
          return 2n;
        },
        undefined,
        null,
      );
      assert(events.includes("dispose:2"));
      assert(!events.includes("dispose:1"));
      return 1n;
    },
    undefined,
    null,
  );
  runtime.clearStatementCache(db);
  assert(events.includes("dispose:1"));
});
