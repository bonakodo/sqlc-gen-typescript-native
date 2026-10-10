// @part StatementLease @bun-sqlite
interface StatementLease {
  statement: ReturnType<Database["prepare"]>;
  cache: StatementCache;
  key: string | undefined;
  active: boolean;
  discard: boolean;
}

// @part StatementCache @node-sqlite @bun-sqlite
interface StatementCache {
  capacity: number;
  entries: Map<string, StatementLease>;
}

// @part statementCaches @node-sqlite @bun-sqlite
const statementCaches = new WeakMap<Database, StatementCache>();

// @part statementCache @node-sqlite @bun-sqlite
function statementCache(database: Database): StatementCache {
  let cache = statementCaches.get(database);
  if (cache === undefined) {
    cache = { capacity: 16, entries: new Map() };
    statementCaches.set(database, cache);
  }
  return cache;
}

// @part discardStatement @bun-sqlite
function discardStatement(lease: StatementLease): void {
  lease.discard = true;
  // Keep ownership if the driver rejects disposal (for example, a clear from
  // a SQLite callback). A later clear can retry; the marked handle cannot run.
  lease.statement[Symbol.dispose]();
  if (lease.key !== undefined && lease.cache.entries.get(lease.key) === lease) {
    lease.cache.entries.delete(lease.key);
  }
}

// @part trimStatementCache @node-sqlite @bun-sqlite
function trimStatementCache(cache: StatementCache, limit: number): void {
  if (cache.entries.size <= limit) return;
  let failed = false;
  let failure: unknown;
  for (const lease of cache.entries.values()) {
    if (cache.entries.size <= limit) break;
    if (lease.active) continue;
    try {
      discardStatement(lease);
    } catch (error) {
      if (!failed) { failed = true; failure = error; }
    }
  }
  if (failed) throw failure;
}

// @part configureStatementCache @node-sqlite @bun-sqlite
/** Set the retained statement limit for this connection; zero disables reuse. */
export function configureStatementCache(database: Database, capacity: number): void {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError("Statement cache capacity must be a nonnegative safe integer");
  }
  const cache = statementCache(database);
  cache.capacity = capacity;
  if (capacity === 0) clearStatementCache(database);
  else trimStatementCache(cache, capacity);
}

// @part clearStatementCache @node-sqlite @bun-sqlite
/** Release idle statements now and active statements when their calls finish. */
export function clearStatementCache(database: Database): void {
  const cache = statementCaches.get(database);
  if (cache === undefined) return;
  for (const lease of cache.entries.values()) lease.discard = true;
  trimStatementCache(cache, 0);
}

// @part SqliteStatement @node-sqlite
// Some Node declarations lag the supported runtime APIs.
type SqliteStatement = ReturnType<Database["prepare"]> & {
  setReturnArrays(enabled: boolean): void;
  close?(): void;
};

// @part StatementLease @node-sqlite
interface StatementLease {
  statement: SqliteStatement;
  database: Database;
  cache: StatementCache;
  key: string | undefined;
  active: boolean;
  discard: boolean;
}

// @part discardStatement @node-sqlite
function discardStatement(lease: StatementLease): void {
  lease.discard = true;
  // Keep ownership if the driver rejects disposal (for example, a clear from
  // a SQLite callback). A later clear can retry; the marked handle cannot run.
  // Closing the database already finalizes its statements.
  if (lease.database.isOpen) lease.statement.close?.();
  if (lease.key !== undefined && lease.cache.entries.get(lease.key) === lease) {
    lease.cache.entries.delete(lease.key);
  }
}

// @part acquireStatement @node-sqlite configureStatementCache clearStatementCache
function acquireStatement(database: Database, sql: string, rows: boolean): StatementLease {
  const cache = statementCache(database);
  // Database.close() finalizes handles. Keep its own closed-connection error
  // when the next prepare runs, and drop references to those stale handles.
  if (database.isOpen === false) clearStatementCache(database);
  const key = cache.capacity === 0 ? undefined : (rows ? "rows:" : "run:") + sql;
  const found = key === undefined ? undefined : cache.entries.get(key);
  if (key !== undefined && found !== undefined && !found.active && !found.discard && cache.capacity > 0) {
    cache.entries.delete(key);
    cache.entries.set(key, found);
    found.active = true;
    return found;
  }
  // Same-key recursion cannot replace its active owner. Under pressure, use
  // a temporary handle and release it at call exit; never wait on a lease.
  if (found === undefined && cache.capacity > 0) trimStatementCache(cache, cache.capacity - 1);
  const statement = database.prepare(sql) as SqliteStatement;
  try {
    statement.setReadBigInts(true);
    if (rows) statement.setReturnArrays(true);
  } catch (error) {
    statement.close?.();
    throw error;
  }
  const lease: StatementLease = {
    statement, database, cache, key, active: true,
    discard: found !== undefined || cache.entries.size >= cache.capacity,
  };
  if (key !== undefined && !lease.discard) cache.entries.set(key, lease);
  return lease;
}

// @part releaseStatement @node-sqlite @bun-sqlite
function releaseStatement(lease: StatementLease, success: boolean): void {
  lease.active = false;
  // Completed calls can be reused. Any reported execution/reset/conversion
  // error discards the statement; never replay SQL.
  if (!success || lease.discard || lease.cache.capacity === 0) {
    discardStatement(lease);
  } else {
    trimStatementCache(lease.cache, lease.cache.capacity);
  }
}

// @part queryOne @node-sqlite
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
  const lease = acquireStatement(database, sql, true);
  let success = false;
  try {
    const stmt = lease.statement;
    const row = stmt.get(...params) as unknown as R | undefined;
    const result = row === undefined ? missing : read(row, context);
    success = true;
    return result;
  } finally {
    releaseStatement(lease, success);
  }
}

// @part queryMany @node-sqlite
export function queryMany<R extends SqliteValue[], T, C>(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
  read: (row: R, context: C) => T,
  context: C,
): T[] {
  const lease = acquireStatement(database, sql, true);
  let success = false;
  try {
    const stmt = lease.statement;
    const rows = stmt.all(...params) as unknown as R[];
    const result = rows.map((row) => read(row, context));
    success = true;
    return result;
  } finally {
    releaseStatement(lease, success);
  }
}

// @part executeQuery @node-sqlite @bun-sqlite
export function executeQuery(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
): void {
  const lease = acquireStatement(database, sql, false);
  let success = false;
  try {
    const stmt = lease.statement;
    stmt.run(...params);
    success = true;
  } finally {
    releaseStatement(lease, success);
  }
}

// @part runQuery @node-sqlite @bun-sqlite
export function runQuery<T>(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
  read: (result: SqliteRunResult, context?: QueryContext) => T,
  context?: QueryContext,
): T {
  const lease = acquireStatement(database, sql, false);
  let success = false;
  try {
    const stmt = lease.statement;
    const result = read(stmt.run(...params), context);
    success = true;
    return result;
  } finally {
    releaseStatement(lease, success);
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
  read: (result: SqliteRunResult, context?: QueryContext) => T,
  context?: QueryContext,
): T {
  const stmt = database.prepare(sql).safeIntegers();
  return read(stmt.run(params), context);
}

// @part SqliteRunResult
type SqliteRunResult = ReturnType<ReturnType<Database["prepare"]>["run"]>;

// @part rowsAffectedField
const rowsAffectedField: FieldContext = ["rowsAffected", "bigint"];

// @part lastInsertIdField
const lastInsertIdField: FieldContext = ["lastInsertId", "bigint"];

// @part readRowsAffected
export function readRowsAffected(result: SqliteRunResult, context?: QueryContext): bigint {
  try {
    return BigInt(result.changes);
  } catch (cause) {
    throwCodecError(cause, "decode", context, rowsAffectedField);
  }
}

// @part readLastInsertId
export function readLastInsertId(result: SqliteRunResult, context?: QueryContext): bigint {
  try {
    return BigInt(result.lastInsertRowid);
  } catch (cause) {
    throwCodecError(cause, "decode", context, lastInsertIdField);
  }
}

// @part readExecResult
export function readExecResult(result: SqliteRunResult, context?: QueryContext): ExecResult {
  return {
    rowsAffected: readRowsAffected(result, context),
    lastInsertId: readLastInsertId(result, context),
  };
}

// @part prepareStatement @bun-sqlite
function prepareStatement(database: Database, sql: string) {
  // Bun 1.4.2 exposes this method but omits it from its declarations.
  const statement = database.prepare(sql) as ReturnType<Database["prepare"]> & {
    safeIntegers(enabled: boolean): unknown;
  };
  try {
    statement.safeIntegers(true);
    return statement;
  } catch (error) {
    statement.finalize();
    throw error;
  }
}

// @part acquireStatement @bun-sqlite configureStatementCache clearStatementCache
function acquireStatement(database: Database, sql: string, rows: boolean): StatementLease {
  const cache = statementCache(database);
  // Bun has no public isOpen flag. This getter rejects even close(false),
  // whose prepared handles could otherwise keep executing from our cache.
  try {
    void database.inTransaction;
  } catch (error) {
    clearStatementCache(database);
    throw error;
  }
  const key = cache.capacity === 0 ? undefined : (rows ? "rows:" : "run:") + sql;
  const found = key === undefined ? undefined : cache.entries.get(key);
  if (key !== undefined && found !== undefined && !found.active && !found.discard && cache.capacity > 0) {
    cache.entries.delete(key);
    cache.entries.set(key, found);
    found.active = true;
    return found;
  }
  // Same-key recursion cannot replace its active owner. Under pressure, use
  // a temporary handle and finalize it at call exit; never wait on a lease.
  if (found === undefined && cache.capacity > 0) trimStatementCache(cache, cache.capacity - 1);
  const statement = prepareStatement(database, sql);
  const lease: StatementLease = {
    statement, cache, key, active: true,
    discard: found !== undefined || cache.entries.size >= cache.capacity,
  };
  if (key !== undefined && !lease.discard) cache.entries.set(key, lease);
  return lease;
}

// @part queryOne @bun-sqlite
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
  const lease = acquireStatement(database, sql, true);
  let success = false;
  try {
    const stmt = lease.statement;
    // values() preserves column order and duplicate column names.
    const row = stmt.values(...params)[0] as R | undefined;
    const result = row === undefined ? missing : read(row, context);
    success = true;
    return result;
  } finally {
    releaseStatement(lease, success);
  }
}

// @part queryMany @bun-sqlite
export function queryMany<R extends SqliteValue[], T, C>(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
  read: (row: R, context: C) => T,
  context: C,
): T[] {
  const lease = acquireStatement(database, sql, true);
  let success = false;
  try {
    const stmt = lease.statement;
    const rows = stmt.values(...params) as unknown as R[];
    const result = rows.map((row) => read(row, context));
    success = true;
    return result;
  } finally {
    releaseStatement(lease, success);
  }
}
