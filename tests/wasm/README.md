# WASM regression tests

These Deno tests assemble the modules in `src/` and run the complete plugin in a
small WASI host. Code, tools, fixtures, and tests stay in separate directories.

From the repository root, build and run all component tests plus the full-plugin
and adversarial suites against both raw and optimized binaries:

```sh
./tools/test.sh
```

To run one suite after building:

```sh
deno test --allow-read --allow-write --allow-env --allow-run tests/wasm/bindings_test.ts
deno test --allow-read --allow-env --allow-run tests/wasm/generator_test.ts -- bin/sqlc-gen-typescript-native.raw.wasm
deno test --allow-read --allow-env tests/wasm/adversarial_test.ts
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
statuses and diagnostics keep their original fixtures.

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

For a focused adversarial run, pass a binary path and a case-name substring:

```sh
deno test --allow-read --allow-env tests/wasm/adversarial_test.ts -- bin/sqlc-gen-typescript-native.wasm 'json/tokens'
```

The optional `ORACLE=/absolute/path/to/reference-plugin` setting compares
selected small adversarial cases against a separately supplied executable. It
needs `--allow-run` and does not build or fetch that reference. Error responses
remain byte-for-byte comparisons; success responses use the independent SQL and
public-type audit because the old generator emits different private code. Normal
tests use only checked-in fixtures and local WASM binaries. Stock-sqlc and
generated TypeScript checks live in `tests/integration/`.
