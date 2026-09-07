#!/bin/sh
# Requires isolated PostgreSQL and MySQL test databases; never starts or changes
# an existing service. See server_live_test.ts for URL environment variables.
set -eu
cd "$(dirname "$0")/.."
GO=${GO:-go}
SQLC=${SQLC:-sqlc}
mkdir -p scripts/.integration/live
CGO_ENABLED=0 GOOS=wasip1 GOARCH=wasm "$GO" build -o scripts/.integration/live/plugin.wasm ./plugin
node --input-type=module <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const wasm = resolve('scripts/.integration/live/plugin.wasm');
const sql = ['pg', 'postgres', 'mysql2'].map(driver => {
  const engine = driver === 'mysql2' ? 'mysql' : 'postgresql';
  return { engine, schema: `../../live/${engine}/schema.sql`, queries: `../../live/${engine}/query.sql`,
    codegen: [{ plugin: 'live', out: driver, options: { driver, runtime: 'node' } }] };
});
for (const [name, strings] of [['mysql2-mixed', false], ['mysql2-strings', true]]) {
  sql.push({ engine: 'mysql', schema: '../../live/mysql/schema.sql', queries: '../../live/mysql/query.sql',
    codegen: [{ plugin: 'live', out: name, options: { driver: 'mysql2', runtime: 'node',
      mysql2: { support_big_numbers: true, big_number_strings: strings } } }] });
}
for (const [name, unsigned] of [['mysql2-signed', false], ['mysql2-unsigned', true]]) {
  sql.push({ engine: 'mysql', schema: '../../live/mysql/schema.sql', queries: '../../live/mysql/query.sql',
    codegen: [{ plugin: 'live', out: name, options: { driver: 'mysql2', runtime: 'node',
      mysql2: { support_big_numbers: true, big_number_strings: true, insert_id_unsigned: unsigned } } }] });
}
writeFileSync('scripts/.integration/live/sqlc.json', JSON.stringify({ version: '2', plugins: [{ name: 'live', wasm: {
  url: `file://${wasm}`, sha256: createHash('sha256').update(readFileSync(wasm)).digest('hex') } }], sql }, null, 2));
JS
"$SQLC" generate -f scripts/.integration/live/sqlc.json
cd scripts
node_modules/.bin/tsgo --ignoreConfig --noEmit --allowImportingTsExtensions \
  --module NodeNext --moduleResolution NodeNext --target ES2023 --strict \
  --noUnusedLocals --noUnusedParameters --noUncheckedIndexedAccess \
  --exactOptionalPropertyTypes --verbatimModuleSyntax --types node \
  server_live_test.ts .integration/live/pg/*.ts \
  .integration/live/postgres/*.ts .integration/live/mysql2*/*.ts
SQLC_LIVE_TEST=1 node --test server_live_test.ts
