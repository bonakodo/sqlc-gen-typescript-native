# Generated execution work

Baseline: clean commit `c26dd3b` (2026-09-09). Historical app figures in the
request are not a current measurement.

## Source review and plan

1. `src/drivers.wat`, `src/compact.wat`, and
   `src/templates/execution_{sqlite,postgresql,mysql}.ts` already share execution,
   pass matching encoded tuples directly, and retain special placeholder/slice
   binding. `codec_error.ts` and the conversion templates already build full
   context only on failure. Keep direct typed row readers and named exports.
2. Replace counter-based private converter/field names with stable names based
   on their contracts; test insertion of unrelated queries before changing WAT.
3. Add focused statement leases to the shared SQLite runtime for
   `@bonakodo/sqlite` only. The published 0.1.0 `Statement` implementation resets
   and clears temporary bindings inside `get`, `all`, and `run`; `raw` and
   `safeIntegers` invalidate its row reader, so configure only on preparation.
   `Symbol.dispose` finalizes explicitly; `Database.close` finalizes all handles.
   See [published source](https://jsr.io/@bonakodo/sqlite/0.1.0/src/api/statement.ts).
4. Do not add a better-sqlite3 cache: its supported API has no explicit
   statement disposal; dropping references cannot promise native eviction.
   See [13.0.3 API](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/docs/api.md).
   Keep MySQL2's per-connection `execute` cache, pg's unnamed queries, and
   postgres.js's `unsafe` preparation policy. Audit those policies and test live
   server resource counts separately in `driver-preparation.md`.

## Ownership

A module-local WeakMap uses actual SQLite Database objects as keys. All query
files in one generated output use that runtime. Each cache holds a bounded LRU
of SQL plus execution mode, never values or results. Encode before acquisition.
A statement stays exclusively leased through result conversion and driver
cleanup. Full/active caches use temporary statements, finalized at call exit;
no waiting, replay, or retained growth. Errors discard leases. Idle eviction
and explicit clearing finalize handles. Clearing active leases marks them for
release on return. Connection close remains the caller's responsibility; clear
before close when practical, and rely on the driver's close for all native
handles. Do not treat transaction boundaries as cache invalidation.

Expose per-connection capacity (zero disables caching) and explicit clearing.
Choose the default after comparing a small hot set and churn at several limits.
A limit counts statements; measure native memory and process RSS as well.

## Tests before implementation

Add regression tests for repeated and missing arguments, error identity and
value-free conversion context, reset/cleanup errors, SQL errors then success,
LRU/capacity/disabled caching, active protection, nested decoders, exact SQL and
mode keys, clear/shrink while leased, churn, transactions/rollback, separate
connections, external iterators, schema rebuilds, close/reopen, and resource
release. Existing suites cover placeholders/slices, nulls/codecs, joins, counts,
IDs, synchronous callbacks, and all 13 driver/runtime combinations. Extend live
PostgreSQL/MySQL tests for pools, transaction handles, reconnection, preparation
counts, and release that stubs cannot establish.

## Measurement and acceptance

Regenerate the generic fixtures and Shyori through normal tooling in isolated
checkouts. Measure current source, full application server bundle attribution,
and a one-query bundle with external drivers excluded. Compare equal SQL, data,
driver/runtime versions, and preparation policy. Capture cold and hot reads,
multirow decoding, writes, transactions, preparation counts, churn, JS heap,
RSS, and native/server statement memory where available. Record limitations.

Require all repository checks and driver integrations to pass; no changed query
API or error semantics, no cache-owned live resources after clearing/close, no
unbounded retained cache growth, and effective removal of unused queries.
Repeated-query gains must come from execution measurements. A byte reduction
alone cannot justify slower row mapping or a speedup claim.
