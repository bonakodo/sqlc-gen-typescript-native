#!/bin/sh
# Normal regression tests use checked-in reference data and never invoke Go.
set -eu
wat_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
wat_node=${NODE:-node}
cd "$wat_root"
NODE="$wat_node" ./tools/build.sh
"$wat_node" --test tests/tools/*_test.ts
set --
for wat_suite in pack core protocol options text typeexpr bindings overrides types drivers embed scopes; do
  set -- "$@" "tests/wasm/${wat_suite}_test.ts"
done
"$wat_node" --test "$@"
for wat_binary in bin/sqlc-gen-typescript-native.raw.wasm bin/sqlc-gen-typescript-native.wasm; do
  WASM_BINARY="$wat_binary" "$wat_node" --test \
    tests/wasm/generator_test.ts tests/wasm/adversarial_test.ts
done
