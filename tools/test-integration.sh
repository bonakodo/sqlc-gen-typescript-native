#!/bin/sh
# Build and test the WASM plugin with stock sqlc and each generated runtime.
set -eu
cd "$(dirname "$0")/.."
if [ -z "${SQLC:-}" ] && [ -x "$PWD/bin/.tools/sqlc-1.31.1/sqlc" ]; then
  SQLC="$PWD/bin/.tools/sqlc-1.31.1/sqlc"
fi
SQLC=${SQLC:-sqlc}
export SQLC
tools/build.sh
"${NODE:-node}" tests/runtime/prepare.ts
rm -rf tests/integration/.generated
"${NODE:-node}" --test --test-concurrency=1 \
  tests/integration/generate_test.ts tests/integration/large_schema_test.ts tests/integration/codec_types_test.ts \
  tests/integration/compact_output_test.ts tests/integration/bindings_execution_test.ts \
  tests/integration/execution_helpers_test.ts tests/integration/stable_names_test.ts \
  tests/integration/lemmascript_test.ts
node_modules/.bin/tsc --project tests/runtime/tsconfig.json
node_modules/.bin/tsc --project tests/integration/tsconfig.json
node_modules/.bin/tsc --project tests/integration/tsconfig.bun.json
"${NODE:-node}" --test tests/runtime/*test.ts

# Node and Bun run the generated modules against their own driver behavior.
"${NODE:-node}" --test tests/integration/sqlite_node_test.ts tests/integration/sqlite_builtin_test.ts \
  tests/integration/ergonomics_test.ts tests/integration/servers_test.ts \
  tests/integration/embed_types_test.ts tests/integration/enum_types_test.ts
node_modules/.bin/bun test tests/integration/sqlite_node_test.ts tests/integration/sqlite_builtin_test.ts \
  tests/integration/sqlite_bun_test.ts \
  tests/integration/ergonomics_test.ts tests/integration/servers_test.ts tests/integration/embed_types_test.ts tests/integration/enum_types_test.ts
