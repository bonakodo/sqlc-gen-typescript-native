# Server driver preparation

Generated server execution keeps the existing driver policy. A second statement
cache would either duplicate MySQL2's cache or add PostgreSQL ownership and retry
rules that the public driver APIs cannot safely support.

The audit used the pinned test packages: `pg` 8.23.0, `postgres` 3.4.9, and
`mysql2` 3.24.3. The live tests ran on Node 26.8.1, PostgreSQL 17.11, and MySQL
8.4.11, on ARM64 Linux database containers reached from macOS over loopback.

| Driver | Generated execution | Retention and settings |
| --- | --- | --- |
| pg | `query({ text, values, rowMode: "array" })`, without a name | No generated named statement cache. Parameterized calls still use the extended protocol and require server parsing. |
| postgres.js | `unsafe(sql, params)` with `.values()` or `.raw()` as required | `unsafe()` defaults to `prepare: false`, even when the connection's `prepare` option is true. The driver may separately prepare its startup type query. |
| MySQL2 | `execute({ sql, values, rowsAsArray, ... })` | The driver owns an LRU per physical connection. Set `maxPreparedStatements` on the connection or pool; the pinned default is 16,000. |

Sources: [pg query API](https://node-postgres.com/features/queries),
[pg 8.23.0 query implementation](https://github.com/brianc/node-postgres/blob/pg%408.23.0/packages/pg/lib/query.js),
[postgres.js 3.4.9 unsafe implementation](https://github.com/porsager/postgres/blob/v3.4.9/src/index.js),
[MySQL2 preparation API](https://sidorares.github.io/node-mysql2/docs/documentation/prepared-statements).

## Ownership and cleanup

MySQL2's key includes exact SQL, `rowsAsArray`, and `nestTables`; its execution
path still handles the configured integer modes. Values and returned rows do not
form part of that key. Dynamic slice lengths therefore compete in the same
bounded driver cache. An eviction queues a server statement close. Statement
close has no protocol acknowledgement, so a later round trip on that connection
establishes ordering when checking server counts. Preparing a replacement can
briefly add a server handle before its queued close runs. A count limit does not
bound bytes. See the pinned
[connection implementation](https://github.com/sidorares/node-mysql2/blob/v3.24.3/lib/base/connection.js).

Use `connection.unprepare({ sql, rowsAsArray: true })` to release a generated
read's cached statement on that physical connection; use `rowsAsArray: false`
for writes. An SQL-only string uses a different key from these generated calls.
`reset()`, `changeUser()`, and connection closure invalidate server handles and
the driver handles its own cache. A normal commit, rollback, or pool release
does not require a cache flush; `resetOnRelease` is an explicit pool policy.
`maxPreparedStatements: 0` does **not** disable this driver's cache: the pinned
configuration falls back to 16,000. The generator adds no MySQL cache to disable.
See [reset API](https://sidorares.github.io/node-mysql2/docs/documentation/reset-connection)
and [configuration source](https://github.com/sidorares/node-mysql2/blob/v3.24.3/lib/connection_config.js).

For pg transactions, acquire a client, pass it through every generated call,
and release it after commit or rollback. A pool is not a transaction connection.
Named preparation is a separate opt-in driver feature with no public bounded
statement eviction API. The generator neither creates names nor sends
`DEALLOCATE` behind pg's tracking. See
[pg transactions](https://node-postgres.com/features/transactions) and
[pool lifecycle](https://node-postgres.com/apis/pool).

Postgres.js owns its pool, `begin()` transaction handles, and `reserve()` handles.
Release a reserved handle with `release()` and close the pool with `end()`.
Its normal prepared queries use SQL and parameter types as a signature. There
is no public per-statement LRU/eviction API; its default connection lifetime is
randomized between 30 and 60 minutes. Generated `unsafe()` calls retain their
current policy. The generator adds no retry; postgres.js's own prepared-plan
retry behavior remains driver-owned. See the pinned
[connection source](https://github.com/porsager/postgres/blob/v3.4.9/src/connection.js)
and [driver guide](https://github.com/porsager/postgres/blob/v3.4.9/README.md).

Keeping unnamed PostgreSQL execution avoids adding a new pooler requirement.
Named statements through PgBouncer transaction pooling require its protocol
tracking support and nonzero `max_prepared_statements`. SQL-level preparation
has different rules. No PgBouncer or other proxy was tested here; see
[PgBouncer configuration](https://www.pgbouncer.org/config.html#max_prepared_statements).

## Live checks and measurements

`deno task live` builds and generates fresh fixtures, checks published TypeScript
driver declarations under strict settings, and runs five live suites. Tests use
server views and status counters rather than private JavaScript driver caches.
They cover separate physical connections, pool calls, concurrent operations,
reserved handles, concurrent transactions, rollback, missing arguments, absent
rows, SQL errors followed by reuse, DDL, connection replacement and closure,
MySQL reset and explicit unprepare, and a postgres.js cursor alongside reads on
another connection. Existing suites retain JSON, array, geometry, slice,
placeholder, affected-row, and exact BIGINT/insert-ID coverage.

One full passing run on 2026-09-09 gave these smoke measurements for 200 warm
generated one-row reads, including assertions and network round trips:

| Driver and unchanged policy | Total ms | Added prepares | Retained generated named statements | Node RSS change | Node heap-used change |
| --- | ---: | --- | ---: | ---: | ---: |
| pg, unnamed | 95.79 | Not instrumented | 0 | +2,785,280 B | -65,032 B |
| postgres.js, unsafe | 96.94 | Not instrumented | 0 | +999,424 B | +1,954,104 B |
| MySQL2, driver capacity 3 | 73.90 | 0 | Not applicable | +3,588,096 B | +503,216 B |

Postgres.js retained one driver startup statement per physical connection; the
generated calls left that snapshot unchanged. MySQL's 120 distinct generated
slice variants caused 120 prepares and 120 closes. Two physical connections
retained at most six statements with capacity three. A separate access-order
test distinguishes LRU from FIFO. Pool closure returned global
`Prepared_stmt_count` to zero. The server's
`memory/sql/Prepared_statement::main_mem_root` then reported zero live
allocations and zero bytes; Performance Schema's own instrumentation retained
its allocation.

A separate MySQL2-only run measured the existing driver cache with capacity
three using `SELECT CAST(? AS CHAR) AS value`, string arguments, and comments
to distinguish 120 SQL variants. The first call took 2.77 ms; 1,000 warm calls
took 186.82 ms; 5,000 calls cycling those variants took 1,528.65 ms. Server
counters reported 5,001 prepares and 4,998 closes before connection closure.
Performance Schema's prepared-statement memory was 20,576 B with one retained
statement, 61,728 B with three after churn, and zero after closure. MySQL process
RSS stayed at 502,564 KiB through churn and reached 502,580 KiB after closure:
releasing statements does not require the process allocator to return pages to
the operating system. These are driver-policy measurements using direct
`execute()` calls, not a generated-code comparison.

These samples establish current behavior, not a generator speedup or a driver
ranking. No server execution or preparation policy changed in this work.
The small read loops do not isolate allocations from JIT compilation or garbage
collection, measure tail latency, or replace application benchmarks. Live tests
do not inject network loss during a write or test proxy failover. Generated
conversion and cleanup errors also have separate runtime regression tests.
