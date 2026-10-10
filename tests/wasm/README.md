# WASM regression tests

These Node tests assemble the modules in `src/` and run the complete plugin in a
small WASI host. Code, tools, fixtures, and tests stay in separate directories.

From the repository root, build and run all component tests plus the full-plugin
and adversarial suites against both raw and optimized binaries:

```sh
./tools/test.sh
```

To run one suite after building:

```sh
node --test tests/wasm/bindings_test.ts
WASM_BINARY=bin/sqlc-gen-typescript-native.raw.wasm node --test tests/wasm/generator_test.ts
node --test tests/wasm/adversarial_test.ts
```

The component tests need WABT and use `WAT2WASM` and `WASM2WAT` overrides, the
pinned tools under `bin/.tools/`, or tools on `PATH`, in that order. The
full-plugin tests need a built binary. Adversarial tests use a worker with a
deadline, so a synchronous WASM loop cannot hang the test runner. Each request
gets a fresh instance with fixed memory. Failures must produce a complete
diagnostic and no partial response; traps, hangs, and memory growth fail the
tests.

`fixtures/` holds frozen reference results captured from the prior Go
implementation before the WASM promotion. The JSON files cover component calls;
`generator*.json.gz` contain requests and exact responses or diagnostics;
`text-oracle.json` keeps text results, including invalid UTF-8 bytes. We retain
these fixtures as independent regression checks. Tests never compile Go or
regenerate expected results from the candidate WASM. Add new cases with explicit
expected behavior, and review fixture changes as code changes.

`compact-output.json.gz` records reviewed success-output changes for shared query
types, encoders, row decoders and metadata, plus common and selected engine
runtime files. `runtime_migration.ts` checks each original response hash before
selecting a replacement, checks its hash, and rejects unknown old runtime
responses. Every checked-in replacement must have coverage. Raw and optimized
WASM still match the same complete expected response bytes. Requests, error
statuses and diagnostics keep their original fixtures except for the SQLite
default change described below.

The migration also audits the old and current output independently of the
generator. It expands inherited shared interfaces before comparing public field
names, types and nullability; resolves changed import aliases; compares query
function signatures, complete factories with inferred return types, SQL literals
and user comments; and checks local import targets. Synthetic tests require this
audit to reject type, field, SQL, comment and missing-import regressions, including
quoted names and nested output paths. This audit does not replace behavior tests
or exact snapshots. Review fixture changes alongside generated-code integration
and runtime behavior tests. Never refresh fixtures in a test run or use candidate
output as its own expected result.

`sqlite-default-components.json` and `sqlite-default-generator.json.gz` record
SQLite's move to one type policy. Their reference is commit
`ed8b0d4783a4f0622909d0ceaaec44a71511ab5c`, before the option removal. The
component snapshot captures that commit's type and driver harness results with
`sqlite_type_mode: native` for SQLite and no mode for server engines. It stores
only the 150 changed type cases and four changed driver cases. Tests remove the
old option from historical inputs; the original corpora stay unchanged.

The generator snapshot runs that commit's optimized binary with the same native
setting. It pairs those results with requests that omit the option. It covers
SQLite requests and requests with an explicit old option, retaining method
arguments in each key so identical requests with different methods cannot share
an expectation. Other requests keep the existing reference. Tests check hashes
and require every replacement to have coverage. The parser suite separately
rejects the removed option for every driver, including both former values.
These snapshots must never come from the candidate under test.

Set `WASM_BINARY` to select a binary and `WASM_FILTER` to match case names:

```sh
WASM_FILTER=json/tokens node --test tests/wasm/adversarial_test.ts
```

The optional `ORACLE=/absolute/path/to/reference-plugin` setting compares
selected small adversarial cases against a separately supplied executable. It
does not build or fetch that reference. Error responses
remain byte-for-byte comparisons; success responses use the independent SQL and
public-type audit because the old generator emits different private code. Normal
tests use only checked-in fixtures and local WASM binaries. Stock-sqlc and
generated TypeScript checks live in `tests/integration/`.

Frozen corpora retain historical Deno and `@bonakodo/sqlite` requests for their
hash and output audits. Output checks skip those retired targets. Type and
override component tests reuse applicable cases with Node options; separate
parser and full-plugin tests reject the removed runtime and driver, including
registry and version forms. Transport checks use a supported success fixture.
