#!/bin/sh
# Exercise actual WASM-generated support modules without an installed sqlc.
set -eu
cd "$(dirname "$0")/.."
tools/build.sh
deno run --allow-read --allow-write tests/runtime/prepare.ts
deno test --config tests/integration/deno.json --allow-read --allow-write --allow-env --allow-ffi tests/runtime/
