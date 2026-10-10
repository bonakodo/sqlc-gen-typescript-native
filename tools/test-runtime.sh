#!/bin/sh
# Exercise actual WASM-generated support modules without an installed sqlc.
set -eu
cd "$(dirname "$0")/.."
tools/build.sh
"${NODE:-node}" tests/runtime/prepare.ts
node_modules/.bin/tsc --project tests/runtime/tsconfig.json
"${NODE:-node}" --test tests/runtime/*test.ts
