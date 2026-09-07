import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { commaFull, commaRight } from "./.integration/embed-sqlite/wasm/query_sql.ts";
import type { Student, TestScore } from "./.integration/embed-pg/wasm/models.ts";
import type {
  FullScoresRow,
  InnerScoresRow,
  LeftScoresRow,
  RightScoresRow,
  SelfJoinRow,
} from "./.integration/embed-pg/wasm/query_sql.ts";
import {
  fullScores,
  innerScores,
  leftScores,
  rightScores,
  selfJoin,
} from "./.integration/embed-pg/wasm/query_sql.ts";

// Compiling this function checks model assignability and confirms optional join
// sides cannot silently pass as complete table rows.
export function embedAssignments(
  inner: InnerScoresRow,
  left: LeftScoresRow,
  right: RightScoresRow,
  full: FullScoresRow,
  self: SelfJoinRow,
): readonly unknown[] {
  const student: Student = inner.students;
  const score: TestScore = inner.testScores;
  const leftStudent: Student = left.students;
  const rightScore: TestScore = right.testScores;
  // @ts-expect-error An unmatched LEFT JOIN keeps nullable fields.
  const absentLeft: TestScore = left.testScores;
  // @ts-expect-error An unmatched RIGHT JOIN keeps nullable fields.
  const absentRight: Student = right.students;
  // @ts-expect-error Either FULL JOIN side can be absent.
  const absentFull: Student = full.students;
  const firstSelf: Student = self.students;
  // @ts-expect-error The right-hand alias can be absent in this self join.
  const secondSelf: Student = self.students_2;
  return [student, score, leftStudent, rightScore, absentLeft, absentRight, absentFull, firstSelf, secondSelf];
}

function database(row: unknown[]) {
  return {
    async query() {
      return { command: "SELECT", rowCount: 1, oid: 0, fields: [], rows: [row] };
    },
  };
}

test("stock sqlc embedded rows preserve required and optional join sides", async () => {
  const student = { id: 1, name: "Ada", nickname: null };
  const score = { id: 2, studentId: 1, score: 99 };
  const absentStudent = { id: null, name: null, nickname: null };
  const absentScore = { id: null, studentId: null, score: null };
  assert.deepEqual(await innerScores(database([1, "Ada", null, 2, 1, 99])), [{ students: student, testScores: score }]);
  assert.deepEqual(await leftScores(database([1, "Ada", null, null, null, null])), [{ students: student, testScores: absentScore }]);
  assert.deepEqual(await rightScores(database([null, null, null, 2, 1, 99])), [{ students: absentStudent, testScores: score }]);
  assert.deepEqual(await fullScores(database([null, null, null, 2, 1, 99])), [{ students: absentStudent, testScores: score }]);
  assert.deepEqual(await selfJoin(database([1, "Ada", null, null, null, null])), [{ students: student, students_2: absentStudent }]);
});

test("SQLite extends the complete comma join with nulls before RIGHT/FULL JOIN", async () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE a (id INTEGER NOT NULL); CREATE TABLE b (id INTEGER NOT NULL); CREATE TABLE c (id INTEGER NOT NULL); INSERT INTO c VALUES (3)");
    assert.deepEqual(await commaRight(db), [{ a: { id: null }, c: { id: 3 } }]);
    assert.deepEqual(await commaFull(db), [{ a: { id: null }, b: { id: null }, c: { id: 3 } }]);
  } finally {
    db.close();
  }
});
