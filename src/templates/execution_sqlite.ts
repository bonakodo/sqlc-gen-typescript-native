// @part StatementLease @bonakodo
interface StatementLease {
  statement: ReturnType<Database["prepare"]>;
  cache: StatementCache;
  key: string | undefined;
  active: boolean;
  discard: boolean;
}

// @part StatementCache @bonakodo
interface StatementCache {
  capacity: number;
  entries: Map<string, StatementLease>;
}

// @part statementCaches @bonakodo
const statementCaches = new WeakMap<Database, StatementCache>();

// @part statementCache @bonakodo
function statementCache(database: Database): StatementCache {
  let cache = statementCaches.get(database);
  if (cache === undefined) {
    cache = { capacity: 16, entries: new Map() };
    statementCaches.set(database, cache);
  }
  return cache;
}

// @part discardStatement @bonakodo
function discardStatement(lease: StatementLease): void {
  lease.discard = true;
  // Keep ownership if the driver rejects disposal (for example, a clear from
  // a SQLite callback). A later clear can retry; the marked handle cannot run.
  lease.statement[Symbol.dispose]();
  if (lease.key !== undefined && lease.cache.entries.get(lease.key) === lease) {
    lease.cache.entries.delete(lease.key);
  }
}

// @part trimStatementCache @bonakodo
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

// @part configureStatementCache @bonakodo
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

// @part clearStatementCache @bonakodo
/** Finalize idle statements now and active statements when their calls finish. */
export function clearStatementCache(database: Database): void {
  const cache = statementCaches.get(database);
  if (cache === undefined) return;
  for (const lease of cache.entries.values()) lease.discard = true;
  trimStatementCache(cache, 0);
}

// @part acquireStatement @bonakodo configureStatementCache clearStatementCache
function acquireStatement(database: Database, sql: string, rows: boolean): StatementLease {
  const cache = statementCache(database);
  // Database.close() finalizes handles. Keep its own closed-connection error
  // when the next prepare runs, and drop references to those stale handles.
  if (database.open === false) clearStatementCache(database);
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
  const statement = database.prepare(sql);
  try {
    statement.safeIntegers();
    if (rows) statement.raw();
  } catch (error) {
    statement[Symbol.dispose]();
    throw error;
  }
  const lease: StatementLease = {
    statement, cache, key, active: true,
    discard: found !== undefined || cache.entries.size >= cache.capacity,
  };
  if (key !== undefined && !lease.discard) cache.entries.set(key, lease);
  return lease;
}

// @part releaseStatement @bonakodo
function releaseStatement(lease: StatementLease, success: boolean): void {
  lease.active = false;
  // get/all/run already reset and clear transient bindings before returning.
  // Any reported execution/reset/conversion error discards; never replay SQL.
  if (!success || lease.discard || lease.cache.capacity === 0) {
    discardStatement(lease);
  } else {
    trimStatementCache(lease.cache, lease.cache.capacity);
  }
}

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
  const lease = acquireStatement(database, sql, true);
  let success = false;
  try {
    const stmt = lease.statement;
    const row = stmt.get(params) as unknown as R | undefined;
    const result = row === undefined ? missing : read(row, context);
    success = true;
    return result;
  } finally {
    releaseStatement(lease, success);
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
  const lease = acquireStatement(database, sql, true);
  let success = false;
  try {
    const stmt = lease.statement;
    const rows = stmt.all(params) as unknown as R[];
    const result = rows.map((row) => read(row, context));
    success = true;
    return result;
  } finally {
    releaseStatement(lease, success);
  }
}

// @part executeQuery @bonakodo
export function executeQuery(
  database: Database,
  sql: string,
  params: readonly SqliteValue[],
): void {
  const lease = acquireStatement(database, sql, false);
  let success = false;
  try {
    const stmt = lease.statement;
    stmt.run(params);
    success = true;
  } finally {
    releaseStatement(lease, success);
  }
}

// @part runQuery @bonakodo
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
    const result = read(stmt.run(params), context);
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

// @part lastInsertNumberField @bonakodo
const lastInsertNumberField: FieldContext = ["lastInsertId", "number"];

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

// @part readLastInsertNumber @bonakodo
export function readLastInsertNumber(result: SqliteRunResult, context?: QueryContext): number {
  try {
    return Number(result.lastInsertRowid);
  } catch (cause) {
    throwCodecError(cause, "decode", context, lastInsertNumberField);
  }
}

// @part readExecResult
export function readExecResult(result: SqliteRunResult, context?: QueryContext): ExecResult {
  return {
    rowsAffected: readRowsAffected(result, context),
    lastInsertId: readLastInsertId(result, context),
  };
}
