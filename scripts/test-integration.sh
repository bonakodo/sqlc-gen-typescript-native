#!/bin/sh
# Test tools are separate from the pure Go generator and its build.
set -eu
cd "$(dirname "$0")/.."
GO=${GO:-go}
SQLC=${SQLC:-sqlc}
export SQLC
npm ci --prefix scripts
rm -rf scripts/.integration
SQLC_TEST_INTEGRATION=1 SQLC_TEST_OUTPUT="$PWD/scripts/.integration" "$GO" test ./internal/endtoend -count=1 -v
deno lint --no-config --rules-tags= --rules-include=no-import-prefix scripts/.integration/deno-*/wasm/*.ts
deno check --config scripts/deno.json scripts/.integration/*/wasm/*.ts scripts/sqlite_deno_test.ts
scripts/node_modules/.bin/tsgo --project scripts/tsconfig.json
deno test --config scripts/deno.json --allow-read --allow-write --allow-env --allow-net --allow-ffi scripts/sqlite_deno_test.ts
node --test scripts/sqlite_node_test.ts scripts/servers_test.ts scripts/embed_types_test.ts scripts/enum_types_test.ts
make runtime

# Bun runs the same modules; Go checks Node/Bun output bytes match.
scripts/node_modules/.bin/bun test scripts/sqlite_node_test.ts scripts/servers_test.ts scripts/embed_types_test.ts scripts/enum_types_test.ts
