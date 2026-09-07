#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
output=${1:-"$root/bin/sqlc-gen-typescript-native.wasm"}
[[ $# -le 1 ]] || { printf 'usage: %s [output.wasm]\n' "$0" >&2; exit 1; }
[[ "$output" == /* ]] || output="$PWD/$output"
cd "$root"

fail() { printf 'build-wasm: %s\n' "$*" >&2; exit 1; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}
find_tool() {
  local override=$1 installed=$2 command_name=$3
  if [[ -n "$override" ]]; then
    command -v "$override" || fail "cannot find $command_name at $override"
  elif [[ -x "$installed" ]]; then
    printf '%s\n' "$installed"
  else
    command -v "$command_name" || fail "$command_name is missing; run make tools or set its command path"
  fi
}

go=$(command -v "${GO:-go}") || fail "Go is missing; set GO to its command path"
goroot=$("$go" env GOROOT)
# TinyGo invokes Go itself. Use the toolchain selected by GO and go.mod, without
# changing the shell profile or the machine's Go installation.
export GOROOT="$goroot"
export PATH="$goroot/bin:$(dirname "$go"):$PATH"

tinygo_version=${TINYGO_VERSION:-0.42.0}
binaryen_version=${BINARYEN_VERSION:-132}
tinygo=$(find_tool "${TINYGO:-}" "$root/bin/.tools/tinygo-$tinygo_version/bin/tinygo" tinygo)
wasmopt=$(find_tool "${WASMOPT:-}" "$root/bin/.tools/binaryen-$binaryen_version/bin/wasm-opt" wasm-opt)
case "$("$tinygo" version)" in
  "tinygo version $tinygo_version "*) ;;
  *) fail "expected TinyGo $tinygo_version; run make tools or set TINYGO" ;;
esac
case "$("$wasmopt" --version)" in
  "wasm-opt version $binaryen_version"|"wasm-opt version $binaryen_version "*) ;;
  *) fail "expected Binaryen $binaryen_version; run make tools or set WASMOPT" ;;
esac
export WASMOPT="$wasmopt"

dependencies=$(GOOS=wasip1 GOARCH=wasm "$go" list -deps ./plugin)
for package in $dependencies; do
  case "$package" in
    google.golang.org/protobuf|google.golang.org/protobuf/*|\
    google.golang.org/grpc|google.golang.org/grpc/*|\
    github.com/golang/protobuf|github.com/golang/protobuf/*|\
    github.com/sqlc-dev/plugin-sdk-go|github.com/sqlc-dev/plugin-sdk-go/*)
      fail "production plugin imports $package; keep the protobuf SDK in host tools and tests"
      ;;
  esac
done

max_bytes=${WASM_MAX_BYTES:-1050000}
[[ "$max_bytes" =~ ^[1-9][0-9]*$ ]] || fail "WASM_MAX_BYTES must be a positive byte count"
mkdir -p "$(dirname "$output")"
stage=$(mktemp -d "$(dirname "$output")/.build-wasm.XXXXXX")
trap 'rm -rf "$stage"' EXIT

# TINYGO_GC=precise uses less CPU for very large schemas. Conservative GC gives
# the smallest tested file. Both keep bounds checks and recoverable panics.
tinygo_gc=${TINYGO_GC:-conservative}
tinygo_flags=(-target=wasip1 -opt=z -no-debug -panic=print -gc="$tinygo_gc")
if [[ -n "${TINYGO_FLAGS:-}" ]]; then
  read -r -a extra_tinygo_flags <<< "$TINYGO_FLAGS"
  tinygo_flags+=("${extra_tinygo_flags[@]}")
fi
"$tinygo" build "${tinygo_flags[@]}" -o "$stage/tinygo.wasm" ./plugin

opt_flags=(-Oz --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int \
  --strip-debug --strip-producers)
if [[ -n "${WASMOPT_FLAGS:-}" ]]; then
  read -r -a extra_wasmopt_flags <<< "$WASMOPT_FLAGS"
  opt_flags+=("${extra_wasmopt_flags[@]}")
fi
"$wasmopt" "$stage/tinygo.wasm" "${opt_flags[@]}" -o "$stage/pass1.wasm"
"$wasmopt" "$stage/pass1.wasm" "${opt_flags[@]}" \
  --strip-target-features -o "$stage/final.wasm"

size=$(wc -c < "$stage/final.wasm" | tr -d '[:space:]')
[[ "$size" -lt "$max_bytes" ]] || fail "WASM is $size bytes; must stay below $max_bytes bytes (WASM_MAX_BYTES)"
checksum=$(sha256 "$stage/final.wasm")
printf '%s  %s\n' "$checksum" "$(basename "$output")" > "$stage/final.sha256"
chmod 644 "$stage/final.wasm" "$stage/final.sha256"
mv "$stage/final.wasm" "$output"
mv "$stage/final.sha256" "$output.sha256"
printf '%s: %s bytes, sha256 %s\n' "$output" "$size" "$checksum"
