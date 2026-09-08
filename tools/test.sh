#!/bin/sh
# Normal regression tests use checked-in reference data and never invoke Go.
set -eu
wat_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
wat_deno=${DENO:-deno}
cd "$wat_root"
DENO="$wat_deno" ./tools/build.sh
"$wat_deno" test --allow-read --allow-write --allow-run tests/tools/
set --
for wat_suite in pack core protocol options text typeexpr bindings overrides types drivers embed scopes; do
  set -- "$@" "tests/wasm/${wat_suite}_test.ts"
done
"$wat_deno" test --allow-read --allow-write --allow-env --allow-run "$@"
for wat_binary in bin/sqlc-gen-typescript-native.raw.wasm bin/sqlc-gen-typescript-native.wasm; do
  "$wat_deno" test --allow-read --allow-env --allow-run \
    tests/wasm/generator_test.ts tests/wasm/adversarial_test.ts -- "$wat_binary"
done
