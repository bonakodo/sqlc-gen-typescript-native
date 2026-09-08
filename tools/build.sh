#!/usr/bin/env bash
# Assemble hand-written WAT plus static output data using installed native tools.
# Deno may fetch the standard-library packages pinned by deno.lock on first use.
#
# Usage: tools/build.sh [output.wasm]
# Tools: WAT2WASM, WASM2WAT, WASMOPT, DENO may override executable paths.
# SKIP_OPTIMIZE=1 publishes the assembled bytes without Binaryen optimization.
# PACK_DATA=0 keeps static data unpacked; the default packs data only.
set -euo pipefail

wat_repo=$(cd "$(dirname "$0")/.." && pwd)
wat_output=${1:-"$wat_repo/bin/sqlc-gen-typescript-native.wasm"}
case "$wat_output" in
  /*) ;;
  *) wat_output="$PWD/$wat_output" ;;
esac
case "$wat_output" in
  *.wasm) ;;
  *) printf 'Output path must end in .wasm\n' >&2; exit 1 ;;
esac
wat_stem=${wat_output%.wasm}
wat_assembler=${WAT2WASM:-wat2wasm}
wat_disassembler=${WASM2WAT:-wasm2wat}
if [[ -x "$wat_repo/bin/.tools/wabt-1.0.41/bin/wat2wasm" ]]; then
  wat_assembler=${WAT2WASM:-"$wat_repo/bin/.tools/wabt-1.0.41/bin/wat2wasm"}
  wat_disassembler=${WASM2WAT:-"$wat_repo/bin/.tools/wabt-1.0.41/bin/wasm2wat"}
fi
wat_deno=${DENO:-deno}
wat_skip=${SKIP_OPTIMIZE:-0}
wat_pack=${PACK_DATA:-1}
if [[ "$wat_skip" != 0 && "$wat_skip" != 1 ]]; then
  printf 'SKIP_OPTIMIZE must be 0 or 1\n' >&2
  exit 1
fi
if [[ "$wat_pack" != 0 && "$wat_pack" != 1 ]]; then
  printf 'PACK_DATA must be 0 or 1\n' >&2
  exit 1
fi
for wat_tool in "$wat_assembler" "$wat_disassembler" "$wat_deno"; do
  if ! command -v "$wat_tool" >/dev/null 2>&1; then
    printf 'Required tool is unavailable: %s\n' "$wat_tool" >&2
    exit 1
  fi
done
if [[ "$wat_skip" == 0 ]]; then
  if [[ -n "${WASMOPT:-}" ]]; then
    wat_optimizer=$WASMOPT
  elif [[ -x "$wat_repo/bin/.tools/binaryen-132/bin/wasm-opt" ]]; then
    wat_optimizer="$wat_repo/bin/.tools/binaryen-132/bin/wasm-opt"
  else
    wat_optimizer=wasm-opt
  fi
  if ! command -v "$wat_optimizer" >/dev/null 2>&1; then
    printf 'wasm-opt is unavailable; set WASMOPT or SKIP_OPTIMIZE=1\n' >&2
    exit 1
  fi
fi

mkdir -p "$(dirname "$wat_output")"
wat_stage=$(mktemp -d "$(dirname "$wat_output")/.wat-build.XXXXXX")
trap 'rm -rf "$wat_stage"' EXIT

# assets.ts only turns trusted TypeScript templates into data bytes. The WAT
# algorithms below copy that text into generated projects; they never run it.
"$wat_deno" run --config "$wat_repo/deno.json" --allow-read --allow-write "$wat_repo/tools/assets.ts" "$wat_stage/assets.wat"
printf '(module\n' > "$wat_stage/base.wat"
cat "$wat_repo/src/args-imports.wat" "$wat_repo/src/core.wat" "$wat_stage/assets.wat" >> "$wat_stage/base.wat"
for wat_fragment in \
  unicode inflection-data text protocol json options overrides typeexpr bindings \
  types-data types format output state catalog paths module drivers embed query \
  factory runtime generator entrypoint; do
  printf '\n' >> "$wat_stage/base.wat"
  cat "$wat_repo/src/$wat_fragment.wat" >> "$wat_stage/base.wat"
done
# Always publish the readable, complete module with its original static data.
# The packed variant selects a separate hand-written initializer. The packer only
# replaces data declarations; it never changes either version's instructions.
cp "$wat_stage/base.wat" "$wat_stage/plugin.wat"
printf '\n;; Static data is already present in this readable variant.\n(func $init_data)\n)\n' >> "$wat_stage/plugin.wat"
wat_assembly="$wat_stage/plugin.wat"
if [[ "$wat_pack" == 1 ]]; then
  cat "$wat_stage/base.wat" "$wat_repo/src/init-data.wat" > "$wat_stage/packing-source.wat"
  printf '\n)\n' >> "$wat_stage/packing-source.wat"
  "$wat_deno" run --config "$wat_repo/deno.json" --allow-read --allow-write "$wat_repo/tools/pack-data.ts" "$wat_stage/packing-source.wat" "$wat_stage/plugin.packed.wat"
  wat_assembly="$wat_stage/plugin.packed.wat"
fi
"$wat_assembler" "$wat_assembly" -o "$wat_stage/plugin.raw.wasm"
if [[ "$wat_skip" == 1 ]]; then
  cp "$wat_stage/plugin.raw.wasm" "$wat_stage/plugin.wasm"
else
  "$wat_optimizer" -Oz --enable-bulk-memory --enable-multivalue \
    --strip-debug --strip-producers "$wat_stage/plugin.raw.wasm" -o "$wat_stage/plugin.wasm"
fi
"$wat_disassembler" "$wat_stage/plugin.wasm" -o "$wat_stage/verified.wat"

# Validate the final module and create its checksum before publishing files.
"$wat_deno" run --config "$wat_repo/deno.json" --allow-read --allow-write "$wat_repo/tools/verify-wasm.ts" \
  "$wat_stage/plugin.wasm" "$wat_stage/verified.wat" "$wat_output"

# All checks precede publication. Keep the verbose assembled WAT and the raw
# Wasm beside the optimized artifact so readers can inspect both build stages.
mv "$wat_stage/plugin.wat" "$wat_stem.wat"
if [[ "$wat_pack" == 1 ]]; then
  mv "$wat_stage/plugin.packed.wat" "$wat_stem.packed.wat"
else
  rm -f "$wat_stem.packed.wat"
fi
mv "$wat_stage/plugin.raw.wasm" "$wat_stem.raw.wasm"
mv "$wat_stage/plugin.wasm" "$wat_output"
mv "$wat_stage/plugin.wasm.sha256" "$wat_output.sha256"
printf 'WASM plugin: %s\n' "$wat_output"
