/** Generates and measures a fixed SQLite workload with the published driver. */
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [mode, path, option = "16", count = "10000", workloadFilter] = Deno.args;
if (!path || !["generate", "run"].includes(mode ?? "")) {
  throw new Error(
    "Usage: measure-sqlite.ts generate PLUGIN_WASM OUTPUT_DIR | run GENERATED_DIR CAPACITY [ITERATIONS] [WORKLOAD]",
  );
}

if (mode === "generate") {
  if (!Deno.args[2]) throw new Error("Generation needs an output directory");
  const directory = resolve(option);
  await Deno.mkdir(directory, { recursive: true });
  await Deno.writeTextFile(
    join(directory, "schema.sql"),
    "CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL, counter INTEGER NOT NULL);\n",
  );
  let queries = "";
  for (let i = 0; i < 64; i++) {
    queries +=
      `-- name: Read${i} :one\nSELECT id, value, counter FROM entries WHERE id = sqlc.arg('id');\n\n`;
  }
  queries +=
    "-- name: ReadMany :many\nSELECT id, value, counter FROM entries WHERE id <= sqlc.arg('limit') ORDER BY id;\n\n";
  queries +=
    "-- name: ReadSlice :many\nSELECT id, value, counter FROM entries WHERE id IN (sqlc.slice('ids'));\n\n";
  queries +=
    "-- name: WriteEntry :execrows\nUPDATE entries SET counter = counter + 1 WHERE id = sqlc.arg('id');\n";
  queries +=
    "-- name: WriteNoResult :exec\nUPDATE entries SET counter = counter + 1 WHERE id = sqlc.arg('id');\n";
  await Deno.writeTextFile(join(directory, "query.sql"), queries);
  const wasm = await Deno.readFile(path);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", wasm));
  await Deno.writeTextFile(
    join(directory, "sqlc.json"),
    JSON.stringify(
      {
        version: "2",
        plugins: [{
          name: "typescript",
          wasm: {
            url: pathToFileURL(resolve(path)).href,
            sha256: [...digest].map((byte) =>
              byte.toString(16).padStart(2, "0")
            ).join(""),
          },
        }],
        sql: [{
          engine: "sqlite",
          schema: "schema.sql",
          queries: "query.sql",
          codegen: [{
            plugin: "typescript",
            out: "generated",
            options: {
              runtime: "deno",
              driver: "@bonakodo/sqlite",
              sqlite_type_mode: "native",
            },
          }],
        }],
      },
      null,
      2,
    ),
  );
  const result = await new Deno.Command(Deno.env.get("SQLC") ?? "sqlc", {
    args: ["generate", "-f", join(directory, "sqlc.json")],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) throw new Error("sqlc generate failed");
  Deno.exit();
}

const capacity = Number(option);
const iterations = Number(count);
if (
  !Number.isSafeInteger(capacity) || capacity < 0 ||
  !Number.isSafeInteger(iterations) || iterations < 100
) {
  throw new Error(
    "Capacity must be nonnegative and iterations must be at least 100",
  );
}
// The dynamic import keeps the measurement-only driver outside the root import map.
const driver = "jsr:@bonakodo/sqlite@0.1.0";
const { Database } = await import(driver);
const generated = pathToFileURL(resolve(path) + "/");
const queries = await import(new URL("query_sql.ts", generated).href);
const runtime = await import(new URL("runtime_sqlite.ts", generated).href);
const runtimeBytes = await Deno.readFile(
  new URL("runtime_sqlite.ts", generated),
);
const runtimeDigest = new Uint8Array(
  await crypto.subtle.digest("SHA-256", runtimeBytes),
);
const runtimeSha256 = [...runtimeDigest].map((byte) =>
  byte.toString(16).padStart(2, "0")
).join("");
if (!runtime.configureStatementCache && capacity !== 0) {
  throw new Error(
    "This generator has no owned cache; measure it with capacity 0",
  );
}
const nativePath = Deno.env.get("DENO_SQLITE_PATH");
if (!nativePath) {
  throw new Error("DENO_SQLITE_PATH must identify the measured SQLite library");
}
const sqlite = Deno.dlopen(nativePath, {
  sqlite3_memory_used: { parameters: [], result: "i64" },
  sqlite3_libversion: { parameters: [], result: "pointer" },
});
const nativeBytes = () => Number(sqlite.symbols.sqlite3_memory_used());
const snapshot = () => ({ ...Deno.memoryUsage(), sqliteBytes: nativeBytes() });
const versionPointer = sqlite.symbols.sqlite3_libversion();
const sqliteVersion = versionPointer
  ? new Deno.UnsafePointerView(versionPointer).getCString()
  : "unknown";
const ids = Array.from({ length: 256 }, (_, i) => BigInt(i + 1));
const slices = Array.from(
  { length: 128 },
  (_, i) => ({ ids: Array<bigint>(i + 1).fill(-1n) }),
);
const workloadNames = [
  "one",
  "many100",
  "write",
  "writeNoResult",
  "transaction10",
  "hot16",
  "hot48",
  "churn128",
];
if (workloadFilter && !workloadNames.includes(workloadFilter)) {
  throw new Error(`Unknown workload: ${workloadFilter}`);
}
const workloads = workloadFilter ? [workloadFilter] : workloadNames;
// Optional controlled snapshots: deno run --v8-flags=--expose-gc ...
const collect = (globalThis as { gc?: () => void }).gc;
const collectedSnapshot = () => {
  if (!collect) return undefined;
  collect();
  collect();
  return snapshot();
};
const results = [];
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
let checksum = 0;
const consume = (result: unknown) => {
  if (Array.isArray(result)) {
    checksum += result.length;
    if (result.length) checksum += Number(result[0].id);
  } else if (result !== null && typeof result === "object") {
    checksum += Number((result as { id: bigint }).id);
  } else if (typeof result === "number" || typeof result === "bigint") {
    checksum += Number(result);
  }
};

// Each sample uses a fresh connection, so the first query must prepare its SQL.
const firstQuerySamples = [];
for (let sample = 0; sample < 30; sample++) {
  const database = new Database(":memory:");
  database.exec(
    "CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL, counter INTEGER NOT NULL); INSERT INTO entries VALUES (1, 'value-1', 0)",
  );
  runtime.configureStatementCache?.(database, capacity);
  const start = performance.now();
  const row = queries.read0(database, { id: 1n });
  firstQuerySamples.push((performance.now() - start) * 1e6);
  consume(row);
  runtime.clearStatementCache?.(database);
  database.close();
}

for (const workload of workloads) {
  const database = new Database(":memory:");
  database.exec(
    "CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL, counter INTEGER NOT NULL)",
  );
  database.exec(
    `INSERT INTO entries VALUES ${
      ids.map((id) => `(${id}, 'value-${id}', 0)`).join(",")
    }`,
  );
  runtime.configureStatementCache?.(database, capacity);
  const run = (i: number) => {
    switch (workload) {
      case "one":
        return queries.read0(database, { id: ids[i % ids.length] });
      case "many100":
        return queries.readMany(database, { limit: 100n });
      case "write":
        return queries.writeEntry(database, { id: ids[i % ids.length] });
      case "writeNoResult":
        return queries.writeNoResult(database, { id: ids[i % ids.length] });
      case "hot16":
        return queries[`read${i % 16}`](database, { id: ids[i % ids.length] });
      case "hot48":
        return queries[`read${i % 48}`](database, { id: ids[i % ids.length] });
      case "churn128":
        return queries.readSlice(database, slices[i % 128]);
      default:
        return transaction(i);
    }
  };
  const transaction = database.transaction((i: number) => {
    for (let j = 0; j < 10; j++) {
      queries.writeEntry(database, { id: ids[(i + j) % ids.length] });
    }
  });
  const n = workload === "many100" || workload === "transaction10"
    ? Math.max(100, Math.floor(iterations / 10))
    : iterations;
  for (let i = 0; i < Math.min(n, 1000); i++) consume(run(i));
  const samples = [];
  // Time the real driver without prepare/dispose instrumentation.
  for (let sample = 0; sample < 5; sample++) {
    const start = performance.now();
    for (let i = 0; i < n; i++) consume(run(i));
    samples.push((performance.now() - start) * 1e6 / n);
  }
  runtime.clearStatementCache?.(database);
  const beforeCollected = collectedSnapshot();
  const before = snapshot();
  let preparations = 0;
  let disposals = 0;
  let maximumLive = 0;
  const originalPrepare = database.prepare.bind(database);
  database.prepare = (sql: string) => {
    const statement = originalPrepare(sql);
    preparations++;
    maximumLive = Math.max(maximumLive, preparations - disposals);
    const dispose = statement[Symbol.dispose].bind(statement);
    statement[Symbol.dispose] = () => {
      try {
        return dispose();
      } finally {
        disposals++;
      }
    };
    return statement;
  };
  for (let i = 0; i < n; i++) run(i);
  const firstPassPreparations = preparations;
  const retained = preparations - disposals;
  const after = snapshot();
  const afterCollected = collectedSnapshot();
  for (let i = 0; i < n; i++) run(i);
  const afterSecondPass = snapshot();
  const afterSecondPassCollected = collectedSnapshot();
  const totalPreparations = preparations;
  runtime.clearStatementCache?.(database);
  const afterClear = snapshot();
  const afterClearCollected = collectedSnapshot();
  const remainingAfterClear = preparations - disposals;
  database.close();
  const afterClose = snapshot();
  const afterCloseCollected = collectedSnapshot();
  results.push({
    workload,
    iterations: n,
    medianNanoseconds: median(samples),
    samplesNanoseconds: samples,
    preparationsFirstPass: firstPassPreparations,
    preparationsTwoPasses: totalPreparations,
    retainedAfterFirstPass: retained,
    maximumLive,
    remainingAfterClear,
    before,
    after,
    afterSecondPass,
    afterClear,
    afterClose,
    beforeCollected,
    afterCollected,
    afterSecondPassCollected,
    afterClearCollected,
    afterCloseCollected,
  });
}
sqlite.close();
console.log(
  JSON.stringify(
    {
      driver,
      deno: Deno.version,
      sqliteVersion,
      runtimeSha256,
      capacity,
      checksum,
      firstQuerySamplesNanoseconds: firstQuerySamples,
      firstQueryMedianNanoseconds: median(firstQuerySamples),
      results,
    },
    null,
    2,
  ),
);
