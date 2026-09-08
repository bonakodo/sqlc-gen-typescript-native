// @part queryRows @pg
async function queryRows(
  database: Database,
  sql: string,
  params: readonly unknown[],
): Promise<unknown[][]> {
  const result = await database.query({
    text: sql,
    values: params as unknown[],
    rowMode: "array",
  });
  return result.rows;
}

// @part executeQuery @pg
export async function executeQuery(
  database: Database,
  sql: string,
  params: readonly unknown[],
): Promise<void> {
  await database.query({
    text: sql,
    values: params as unknown[],
    rowMode: "array",
  });
}

// @part runQuery @pg
export async function runQuery(
  database: Database,
  sql: string,
  params: readonly unknown[],
) {
  return await database.query({
    text: sql,
    values: params as unknown[],
    rowMode: "array",
  });
}

// @part queryRows @postgres
async function queryRows(
  database: Database,
  sql: string,
  params: readonly unknown[],
): Promise<unknown[][]> {
  return await database.unsafe(sql, params as DriverParameters).values();
}

// @part executeQuery @postgres
export async function executeQuery(
  database: Database,
  sql: string,
  params: readonly unknown[],
): Promise<void> {
  await database.unsafe(sql, params as DriverParameters);
}

// @part queryRaw @postgres
export async function queryRaw(
  database: Database,
  sql: string,
  params: readonly unknown[],
) {
  return await database.unsafe(sql, params as DriverParameters).raw();
}

// @part runQuery @postgres
export async function runQuery(
  database: Database,
  sql: string,
  params: readonly unknown[],
) {
  return await database.unsafe(sql, params as DriverParameters).values();
}

// @part queryOne
export async function queryOne<
  R extends unknown[],
  T,
  C,
  N extends null | undefined,
>(
  database: Database,
  sql: string,
  params: readonly unknown[],
  read: (row: R, context: C) => T,
  context: C,
  missing: N,
): Promise<T | N> {
  const rows = await queryRows(database, sql, params);
  const row = rows[0];
  return rows.length !== 1 || row === undefined
    ? missing
    : read(row as R, context);
}

// @part queryMany
export async function queryMany<R extends unknown[], T, C>(
  database: Database,
  sql: string,
  params: readonly unknown[],
  read: (row: R, context: C) => T,
  context: C,
): Promise<T[]> {
  const rows = await queryRows(database, sql, params);
  return rows.map((row) => read(row as R, context));
}
