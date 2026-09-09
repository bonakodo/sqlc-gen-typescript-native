# Generated-code and SQLite measurements, 2026-09-09

These measurements use the repository's starting commit `c26dd3b` as the
comparison baseline. That commit already shares execution helpers, passes
matching bindings directly, and builds conversion-error context on failure. The
released v0.4.0 application output is a separate reference; gains already
present in `c26dd3b` are not new gains from the statement cache.

## Environment and method

- Apple M1 Max, macOS 26.6.2, Deno 2.9.6 / V8 15.0.245.2-rusty, Node 26.8.1,
  sqlc 1.31.1.
- Published `@bonakodo/sqlite` 0.1.0, Homebrew SQLite 3.53.4,
  `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`.
- Shyori commit `1efe6390eb1e1ca8e02b833fd09c2c184704c4ce`, Vite 8.2.2,
  SvelteKit 3.0.0-next.12, esbuild 0.28.1.
- Separate detached generator and application worktrees. The application
  checkout stayed unchanged. Each comparison changed only the isolated sqlc
  plugin URL and checksum, then ran `deno task db:generate` and
  `deno task build`. The build used a temporary SQLite path, not application
  data. No generated application files were edited by hand.
- Vite's `generateBundle` hook recorded each JavaScript chunk's byte length and
  each module's `renderedLength`. Generated-module attribution and bundled
  dependencies are reported separately. Attribution is the bundler's measure of
  retained module code; it does not include all chunk-level wrappers and import
  declarations. Full server chunk bytes are measured separately. External
  dependencies are not part of those chunks. Sizes are uncompressed UTF-8 bytes,
  not deployment archive sizes.
- The 800-query source fixture is `tests/integration/large_schema_test.ts`: 100
  tables, 202 overrides, 17 result columns, and query factories enabled.
  Generated SQL, input data, driver/runtime versions, and preparation policies
  stay the same between comparisons.

## Reproduction tools

`tools/measure-generated.ts` counts TypeScript bytes, SQL literal source bytes,
query declarations, and the old repeated execution patterns. It optionally reads
the Vite attribution JSON described above.

```sh
deno run --allow-read tools/measure-generated.ts GENERATED_DIR [BUNDLE_JSON]
```

`tools/measure-sqlite.ts` generates its own fixed workload using stock sqlc. Run
each artifact in a separate directory, then measure each capacity in a separate
Deno process. The starting artifact supports capacity zero only.

```sh
export SQLC="$PWD/bin/.tools/sqlc-1.31.1/sqlc"
export DENO_SQLITE_PATH=/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib
deno run -A tools/measure-sqlite.ts generate bin/sqlc-gen-typescript-native.wasm /tmp/sqlc-measure
deno run -A --config tests/integration/deno.json tools/measure-sqlite.ts run /tmp/sqlc-measure/generated 16 30000
```

The benchmark uses 256 rows in an in-memory database. It reports five timing
samples after warmup, reads returned results into a checksum, and measures
preparation/disposal counts in separate, untimed passes. Reads, writes and
working-set cases run 30,000 iterations per sample; 100-row reads and ten-write
transactions run 3,000. First-query samples use 30 fresh connections, with
schema creation outside the timer. These samples include preparation and
execution, not process startup or connection opening.

Native memory uses SQLite's public
[`sqlite3_memory_used()`](https://www.sqlite.org/c3ref/memory_highwater.html)
from the same loaded library; process RSS and JavaScript heap values come from
`Deno.memoryUsage()`. SQLite lookaside allocations already owned by an open
connection can service small retained statements without increasing the
native-memory total. The memory delta therefore measures actual allocation
growth, not each statement's independent size. Public `prepare` and
`Symbol.dispose` instrumentation counts retained handles without accessing
driver internals.

Pass a workload name to isolate its process memory. Exposing V8's collection
function adds snapshots after two explicit collections; timed loops still run
without forced collection or prepare/dispose instrumentation.

```sh
deno run --v8-flags=--expose-gc -A --config tests/integration/deno.json tools/measure-sqlite.ts run /tmp/sqlc-measure/generated 16 30000 churn128
```

For Vite attribution, add this temporary plugin to the isolated application
config, with `writeFileSync` imported from `node:fs`. Remove it before
application checks and tests. It writes the server build that contains generated
queries.

```ts
{
  name: 'measure-generated-source',
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle)
      .filter((item) => item.type === 'chunk')
      .map((item) => ({
        fileName: item.fileName,
        bytes: Buffer.byteLength(item.code),
        imports: item.imports,
        modules: Object.entries(item.modules).map(([id, info]) => ({
          id,
          renderedLength: info.renderedLength,
        })),
      }));
    if (chunks.some((chunk) => chunk.modules.some((module) =>
      module.id.includes('/server/db/generated/')
    ))) {
      writeFileSync('/tmp/sqlc-bundle.json', JSON.stringify(chunks));
    }
  },
}
```

## Results

### Source and application bundles

| Measure                                         | Starting `c26dd3b` |       Final |             Change |
| ----------------------------------------------- | -----------------: | ----------: | -----------------: |
| 800-query fixture, generated TypeScript         |          804,973 B |   795,997 B |  -8,976 B (-1.12%) |
| Shyori, generated TypeScript                    |        1,840,375 B | 1,859,564 B | +19,189 B (+1.04%) |
| Shyori, retained generated-module code          |        1,089,469 B | 1,084,473 B |  -4,996 B (-0.46%) |
| Shyori, full server JavaScript chunks           |        3,448,385 B | 3,446,933 B | -1,452 B (-0.042%) |
| Bundled dependency module code                  |          535,811 B |   535,811 B |          No change |
| One query imported through the barrel, minified |            2,792 B |     3,924 B |           +1,132 B |

The final application bundle saving over the actual starting point is small.
Static write-result readers and shorter stable names offset the cache and its
import/export overhead. Shyori's TypeScript source grows because stable names
are longer than sequential names and the cache adds support code. The larger
800-query repeated-shape fixture shrinks. These are separate outcomes; neither
source size nor module attribution substitutes for full bundle measurement.

The released v0.4.0 reference produced 2,052,433 bytes of generated TypeScript
and 1,224,883 bytes of retained generated-module code, including 348,507 bytes
from shared query helpers. Its source contained 751 prepare calls, 716
unpacked-binding wrappers, and 3,478 eager field-context calls under the
measurement tool's documented counters. These reproduce the current checkout of
that app reference; the prompt's historical figures used older counts or
different counting boundaries. Most of the reduction from that release was
already present in `c26dd3b`.

Both starting and final application output contain 751 query declarations and
561,103 SQL-literal source bytes. The server build retains 678 SQL literals
occupying 491,817 bytes. SQL text is unchanged. The full-bundle comparison uses
the same pinned, cloned dependency tree on both sides; an earlier run with
linked dependencies gave different dependency attribution and is excluded from
that comparison.

The single-query test imports `Health` from generated `index.ts` and exports
only `Health.checkDatabaseHealth`. esbuild bundles with
`--bundle --format=esm
--platform=neutral --packages=external --minify`. Exactly
one SQL literal remains on both sides. The other 750 queries are removable,
including through the namespace barrel. The cache imposes a fixed cost on this
small bundle; there is no global query registry.

### Repeated execution

Median microseconds per operation, five samples. The last column uses the new
default capacity of 16 statements per connection.

| Workload                                              | Starting `c26dd3b` | Final, capacity 0 | Final, capacity 16 |
| ----------------------------------------------------- | -----------------: | ----------------: | -----------------: |
| Read one row                                          |              3.372 |             3.353 |              0.627 |
| Read and decode 100 rows                              |             24.378 |            23.787 |             18.504 |
| Update one row, `:execrows`                           |              3.482 |             3.563 |              1.139 |
| Update one row, `:exec`                               |              3.476 |             3.518 |              1.165 |
| Transaction with ten updates                          |             29.019 |            29.310 |              6.465 |
| Cycle through 16 static queries                       |              3.647 |             3.553 |              0.896 |
| Cycle through 48 static queries                       |              3.684 |             3.635 |              5.205 |
| Cycle through 128 SQL slice lengths, no matching rows |             18.168 |            18.107 |             21.572 |

All three runs produced the same result checksum. Capacity zero stayed close to
the starting implementation. Reuse helps queries whose working set fits the
cache; repeated eviction makes both larger working-set cases slower. These are
local, in-memory query measurements, not application request timings. They
establish no performance change for other drivers.

The median first query on 30 fresh connections took 10.979, 12.979, and 11.479
microseconds respectively. This does not show a cold-query improvement. The
final measured SQLite runtime SHA-256 was
`2c430479221e702176bbe84d10b901d6a6e3968f9c75023458761ec1521d09df`. The final
helper-name spelling change happened after the timing run; it did not change
this runtime or query behavior.

### Preparation and retained resources

The untimed first 30,000-call pass prepared 30,000 statements with caching
disabled. Capacity 16 prepared one statement for a repeated read or write, 16
for the 16-query working set, and 30,000 for each larger working set. The
100-row case used 3,000 calls. The transaction case used 3,000 transactions with
ten generated writes each. Driver transaction setup happened before timing and
instrumentation in every case; counts cover generated statements.

The cache retained at most its configured capacity during churn. Explicit
clearing disposed every retained statement, and the instrumented retained count
returned to zero. Another 30,000-call pass did not increase native allocation
growth for the same final SQL variants.

A capacity sweep with the same read and slice workloads informed the default:

| Capacity | 16-query read set, µs | 48-query read set, µs | Slice churn, µs | Native allocation growth after churn |
| -------- | --------------------: | --------------------: | --------------: | -----------------------------------: |
| 0        |                 3.711 |                 3.733 |          18.209 |                                  0 B |
| 16       |                 0.952 |                 5.233 |          21.567 |                            145,584 B |
| 32       |                 0.908 |                 5.474 |          22.400 |                            256,832 B |
| 64       |                 0.920 |                 1.025 |          23.752 |                            704,064 B |

This sweep preceded the static write-result helpers; those helpers do not change
these read workloads. A capacity of 16 fits the small working set and retains
less native memory under SQL-variant churn. It is a conservative default, not a
universal optimum. Capacity 64 helps the 48-query working set; capacity zero
avoids churn overhead. Applications should measure their own SQL mix. Native
byte counts vary with statement size and which variants end the pass; an entry
limit is not a byte limit.

Controlled, isolated churn runs distinguish live objects from allocator
behavior. With two explicit collections per snapshot, capacity 16 increased
JavaScript heap use by about 112 KiB after the first pass and 117 KiB after the
second. Clearing brought it back to about 12 KiB above the initial snapshot.
Native allocation growth stayed at 145,584 bytes in both passes and returned to
zero after clearing. Capacity zero retained no generated statements and showed
roughly 11–13 KiB of post-collection heap growth.

Process RSS did not follow live heap or native cache size. In the isolated runs,
post-collection RSS was about 102/138 MiB after the first pass and 150/150 MiB
after the second for capacities 0/16. It stayed high after clearing and
connection closure. Earlier mixed-workload runs also showed a higher RSS with
caching enabled. These results establish bounded retained statements and stable
native growth under this churn workload; they do not establish a process-memory
reduction or a strict RSS bound.

### Application validation

The isolated application built successfully with the normal task and passed
`deno task check` with zero errors and zero warnings. The normal unit task
passed 670 tests and 31 steps with caching and stable helpers enabled. After the
final write-result helper change, the typed database subset passed 12 tests and
18 steps, including preparation of all 751 application queries against its
migrated schema, native integer/date/JSON/null behavior, and transactions. The
final name-spelling-only change was regenerated and built again. The original
application's tracked checkout remained clean.

The generator's driver matrix, live PostgreSQL/MySQL ownership tests, and
failure-path cache tests are separate from these measurements. This report does
not claim server-driver timing gains or lower server memory use. It does not
measure production request latency, disk-backed workloads, worker pools, or
long-running deployment RSS.

Raw measurement JSON and build logs are kept outside the repository; they
contain application module paths and are not release assets.
