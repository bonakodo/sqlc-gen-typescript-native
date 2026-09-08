#!/bin/sh
# Build and test the WASM plugin with stock sqlc and each generated runtime.
set -eu
cd "$(dirname "$0")/.."
if [ -z "${SQLC:-}" ] && [ -x "$PWD/bin/.tools/sqlc-1.31.1/sqlc" ]; then
  SQLC="$PWD/bin/.tools/sqlc-1.31.1/sqlc"
fi
SQLC=${SQLC:-sqlc}
export SQLC
npm ci --prefix tests/integration
tools/build.sh
deno run --allow-read --allow-write tests/runtime/prepare.ts
rm -rf tests/integration/.generated
deno test --config tests/integration/deno.json --allow-read --allow-write --allow-env=SQLC --allow-run \
  tests/integration/generate_test.ts tests/integration/large_schema_test.ts tests/integration/codec_types_test.ts
deno lint --no-config --rules-tags= --rules-include=no-import-prefix tests/integration/.generated/deno-*/wasm/*.ts
deno check --config tests/integration/deno.json tests/integration/.generated/*/wasm/*.ts \
  tests/integration/sqlite_deno_test.ts tests/integration/ergonomics_test.ts
tests/integration/node_modules/.bin/tsc --project tests/integration/tsconfig.json
deno test --config tests/integration/deno.json --allow-read --allow-write --allow-env --allow-ffi \
  tests/integration/sqlite_deno_test.ts tests/integration/ergonomics_test.ts tests/runtime/

# Node and Bun run the generated modules against their own driver behavior.
node --test tests/integration/sqlite_node_test.ts tests/integration/servers_test.ts \
  tests/integration/embed_types_test.ts tests/integration/enum_types_test.ts
tests/integration/node_modules/.bin/bun test tests/integration/sqlite_node_test.ts \
  tests/integration/servers_test.ts tests/integration/embed_types_test.ts tests/integration/enum_types_test.ts
