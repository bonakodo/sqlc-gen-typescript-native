// @part queryRows
async function queryRows(
  database: Database,
  sql: string,
  params: readonly unknown[],
  supportBigNumbers: boolean,
  bigNumberStrings: boolean,
): Promise<unknown[][]> {
  const [rows] = await database.execute({
    sql,
    values: params as unknown[],
    rowsAsArray: true,
    supportBigNumbers,
    bigNumberStrings,
  });
  return rows as unknown[][];
}

// @part executeQuery
export async function executeQuery(
  database: Database,
  sql: string,
  params: readonly unknown[],
  supportBigNumbers: boolean,
  bigNumberStrings: boolean,
): Promise<void> {
  await runQuery(database, sql, params, supportBigNumbers, bigNumberStrings);
}

// @part runQuery
export async function runQuery(
  database: Database,
  sql: string,
  params: readonly unknown[],
  supportBigNumbers: boolean,
  bigNumberStrings: boolean,
) {
  const [result] = await database.execute({
    sql,
    values: params as unknown[],
    rowsAsArray: false,
    supportBigNumbers,
    bigNumberStrings,
  });
  return result as Exclude<typeof result, unknown[]>;
}

// @part queryOne
export async function queryOne<R, T, C, N extends null | undefined>(
  database: Database,
  sql: string,
  params: readonly unknown[],
  read: (row: R, context: C) => T,
  context: C,
  missing: N,
  supportBigNumbers: boolean,
  bigNumberStrings: boolean,
): Promise<T | N> {
  const rows = await queryRows(
    database,
    sql,
    params,
    supportBigNumbers,
    bigNumberStrings,
  );
  const row = rows[0];
  return rows.length !== 1 || row === undefined
    ? missing
    : read(row as R, context);
}

// @part queryMany
export async function queryMany<R, T, C>(
  database: Database,
  sql: string,
  params: readonly unknown[],
  read: (row: R, context: C) => T,
  context: C,
  supportBigNumbers: boolean,
  bigNumberStrings: boolean,
): Promise<T[]> {
  const rows = await queryRows(
    database,
    sql,
    params,
    supportBigNumbers,
    bigNumberStrings,
  );
  return rows.map((row) => read(row as R, context));
}
