// @part queryOne @bonakodo
export function queryOne<
  R extends SqliteValue[],
  T,
  C,
  N extends null | undefined,
>(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
  read: (row: R, context: C) => T,
  context: C,
  missing: N,
): T | N {
  const stmt = database.prepare(sql);
  try {
    stmt.safeIntegers();
    const row = stmt.raw().get(params) as R | undefined;
    return row === undefined ? missing : read(row, context);
  } finally {
    stmt[Symbol.dispose]();
  }
}

// @part queryMany @bonakodo
export function queryMany<R extends SqliteValue[], T, C>(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
  read: (row: R, context: C) => T,
  context: C,
): T[] {
  const stmt = database.prepare(sql);
  try {
    stmt.safeIntegers();
    const rows = stmt.raw().all(params) as R[];
    return rows.map((row) => read(row, context));
  } finally {
    stmt[Symbol.dispose]();
  }
}

// @part executeQuery @bonakodo
export function executeQuery(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
): void {
  const stmt = database.prepare(sql);
  try {
    stmt.safeIntegers();
    stmt.run(params);
  } finally {
    stmt[Symbol.dispose]();
  }
}

// @part runQuery @bonakodo
export function runQuery<T>(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
  read: (result: ReturnType<ReturnType<Database["prepare"]>["run"]>) => T,
): T {
  const stmt = database.prepare(sql);
  try {
    stmt.safeIntegers();
    return read(stmt.run(params));
  } finally {
    stmt[Symbol.dispose]();
  }
}

// @part queryOne @better-sqlite3
export function queryOne<
  R extends SqliteValue[],
  T,
  C,
  N extends null | undefined,
>(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
  read: (row: R, context: C) => T,
  context: C,
  missing: N,
): T | N {
  const stmt = database.prepare(sql).safeIntegers();
  const row = stmt.raw().get(params) as R | undefined;
  return row === undefined ? missing : read(row, context);
}

// @part queryMany @better-sqlite3
export function queryMany<R extends SqliteValue[], T, C>(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
  read: (row: R, context: C) => T,
  context: C,
): T[] {
  const stmt = database.prepare(sql).safeIntegers();
  const rows = stmt.raw().all(params) as R[];
  return rows.map((row) => read(row, context));
}

// @part executeQuery @better-sqlite3
export function executeQuery(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
): void {
  const stmt = database.prepare(sql).safeIntegers();
  stmt.run(params);
}

// @part runQuery @better-sqlite3
export function runQuery<T>(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
  read: (result: ReturnType<ReturnType<Database["prepare"]>["run"]>) => T,
): T {
  const stmt = database.prepare(sql).safeIntegers();
  return read(stmt.run(params));
}
