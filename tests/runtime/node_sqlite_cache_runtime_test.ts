import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import * as runtime from "./.generated/node-sqlite/runtime_sqlite.ts";

type Value = null | string | number | bigint | Uint8Array;

function fake(withClose = true) {
  const events: string[] = [];
  let serial = 0;
  let failure = "";
  const error = new Error("driver failure");
  const state = {
    isOpen: true,
    prepare(sql: string) {
      assert(state.isOpen, "database is not open");
      const id = ++serial;
      events.push(`prepare:${id}:${sql}`);
      let alive = true;
      return {
        setReadBigInts(value: boolean) {
          assert.equal(value, true);
          events.push(`bigints:${id}`);
          if (failure === "bigints") throw error;
        },
        setReturnArrays(value: boolean) {
          assert.equal(value, true);
          events.push(`arrays:${id}`);
          if (failure === "arrays") throw error;
          // Like node:sqlite, these setters return undefined.
        },
        get(...params: Value[]) {
          assert(alive);
          assert(params.every((value) => !Array.isArray(value)));
          events.push(`get:${id}`);
          if (failure === "get") throw error;
          return params;
        },
        run(...params: Value[]) {
          assert(alive);
          assert(params.every((value) => !Array.isArray(value)));
          events.push(`run:${id}`);
          return { changes: 1n, lastInsertRowid: 1n };
        },
        ...(withClose
          ? {
              close() {
                assert(state.isOpen, "database already finalized statements");
                assert(alive, "statement already finalized");
                events.push(`close:${id}`);
                if (failure === "close") throw error;
                alive = false;
              },
            }
          : {}),
      };
    },
  };
  const db = state as unknown as DatabaseSync;
  return {
    db,
    state,
    events,
    error,
    fail(value: string) {
      failure = value;
    },
  };
}

const read = (db: DatabaseSync, sql = "SELECT ?", params: Value[] = [1n]) =>
  runtime.queryOne(db, sql, params, (row) => row[0], undefined, null);

test("node:sqlite cache sets row/bigint modes once and closes LRU handles", () => {
  const { db, events } = fake();
  runtime.configureStatementCache(db, 2);
  assert.equal(read(db), 1n);
  assert.equal(read(db, "SELECT ?", [2n]), 2n);
  read(db, "SELECT ? + 1");
  read(db);
  read(db, "SELECT ? + 2");
  assert(events.includes("close:2"));
  assert(!events.includes("close:1"));
  assert.equal(events.filter((event) => event === "bigints:1").length, 1);
  assert.equal(events.filter((event) => event === "arrays:1").length, 1);
  // The same SQL in run mode needs a distinct handle without array mode.
  assert.equal(
    runtime.runQuery(db, "SELECT ?", [3n], (r) => r.changes),
    1n,
  );
  assert(!events.includes("arrays:4"));
  runtime.clearStatementCache(db);
  assert.equal(events.filter((event) => event.startsWith("close:")).length, 4);
});

test("node:sqlite protects active handles during recursion and clear", () => {
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
        assert(!events.includes("close:1"));
        assert.equal(
          read(db, action === "different" ? "SELECT ? + 1" : "SELECT ?", [2n]),
          2n,
        );
        assert(events.includes("close:2"));
        assert(!events.includes("close:1"));
        return 1n;
      },
      undefined,
      null,
    );
    runtime.clearStatementCache(db);
    assert(events.includes("close:1"));
  }
});

test("node:sqlite discards setup, execution and decode failures without replay", () => {
  for (const point of ["bigints", "arrays", "get", "decode"]) {
    const { db, events, fail, error } = fake();
    fail(point);
    assert.throws(
      () =>
        runtime.queryOne(
          db,
          "SELECT ?",
          [1n],
          () => {
            throw error;
          },
          undefined,
          null,
        ),
      (caught) => caught === error,
    );
    assert.equal(
      events.filter((event) => event.startsWith("prepare:")).length,
      1,
    );
    assert.equal(
      events.filter((event) => event.startsWith("close:")).length,
      1,
    );
    fail("");
    assert.equal(read(db), 1n);
    runtime.clearStatementCache(db);
  }
});

test("node:sqlite keeps rejected cleanup owned for a later retry", () => {
  const { db, events, fail, error } = fake();
  read(db);
  fail("close");
  assert.throws(
    () => runtime.clearStatementCache(db),
    (caught) => caught === error,
  );
  fail("");
  runtime.clearStatementCache(db);
  assert.equal(events.filter((event) => event === "close:1").length, 2);
  assert.equal(read(db), 1n);
  assert(events.includes("prepare:2:SELECT ?"));
  runtime.clearStatementCache(db);
});

test("node:sqlite clears closed connections without closing finalized handles", () => {
  for (const explicitClear of [true, false]) {
    const { db, state, events } = fake();
    read(db);
    state.isOpen = false;
    if (explicitClear) runtime.clearStatementCache(db);
    assert.throws(() => read(db), /database is not open/);
    assert(!events.includes("close:1"));
    state.isOpen = true;
    assert.equal(read(db, "SELECT ?", [2n]), 2n);
    assert(events.includes("prepare:2:SELECT ?"));
    runtime.clearStatementCache(db);
  }
});

test("node:sqlite cache works without optional statement cleanup methods", () => {
  const { db, events } = fake(false);
  runtime.configureStatementCache(db, 1);
  read(db);
  read(db);
  read(db, "SELECT ? + 1");
  runtime.clearStatementCache(db);
  runtime.configureStatementCache(db, 0);
  read(db);
  read(db);
  assert.equal(
    events.filter((event) => event.startsWith("prepare:")).length,
    4,
  );
  assert(!events.some((event) => event.startsWith("close:")));
});
