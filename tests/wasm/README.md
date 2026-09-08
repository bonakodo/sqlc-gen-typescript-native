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

The runtime-template merge has one narrow exception to historical output text.
`runtime_migration.ts` recognizes seven reviewed old `runtime.ts` hashes and
replaces only that expected file with the merged template's selected source and
an explicit driver preamble. The selector is independent of the WAT fragment
table. Original fixture hashes still pass before migration, and all other files,
their order, diagnostics, and protobuf encoding remain exact. Unknown old
runtime hashes fail. Runtime behavior tests and generated-code integration
checks cover the merged support code itself.

For a focused adversarial run, pass a binary path and a case-name substring:

```sh
deno test --allow-read --allow-env tests/wasm/adversarial_test.ts -- bin/sqlc-gen-typescript-native.wasm 'json/tokens'
```

The optional `ORACLE=/absolute/path/to/reference-plugin` setting compares
selected small adversarial cases against a separately supplied executable. It
needs `--allow-run` and does not build or fetch that reference. Its responses
use the same reviewed runtime migration as the frozen corpus. Normal tests use
only the checked-in fixtures and local WASM binaries. Stock-sqlc and generated
TypeScript checks live in `tests/integration/`.
