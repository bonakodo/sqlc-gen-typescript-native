#!/bin/sh
# Uses dedicated test databases. Never starts or reconfigures a service.
set -eu
cd "$(dirname "$0")/.."
if [ -z "${SQLC:-}" ] && [ -x "$PWD/bin/.tools/sqlc-1.31.1/sqlc" ]; then
  SQLC="$PWD/bin/.tools/sqlc-1.31.1/sqlc"
fi
SQLC=${SQLC:-sqlc}
export SQLC
tools/build.sh
deno test --config tests/integration/deno.json --allow-read --allow-write --allow-env=SQLC --allow-run \
  tests/integration/live_generate_test.ts
cd tests/integration
node_modules/.bin/tsc --ignoreConfig --noEmit --allowImportingTsExtensions \
  --module NodeNext --moduleResolution NodeNext --target ES2023 --strict \
  --noUnusedLocals --noUnusedParameters --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --verbatimModuleSyntax --types node \
  server_live_test.ts .generated/live/pg/*.ts \
  .generated/live/postgres/*.ts .generated/live/mysql2*/*.ts
SQLC_LIVE_TEST=1 node --test server_live_test.ts
