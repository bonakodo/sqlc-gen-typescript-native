#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tools_dir="$root/bin/.tools"
mkdir -p "$tools_dir"
stage=$(mktemp -d "$tools_dir/.setup-wasm.XXXXXX")
trap 'rm -rf "$stage"' EXIT

fail() { printf 'setup-wasm-tools: %s\n' "$*" >&2; exit 1; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)
    wabt_platform=linux-x64
    wabt_sha=83f8122e924745fcd70636e3594bc01c4c47f2d4c8f3c63b5d70d3f83a482677
    binaryen_platform=x86_64-linux
    binaryen_sha=195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572
    ;;
  Linux/aarch64|Linux/arm64)
    wabt_platform=linux-arm64
    wabt_sha=5e35416ee8725dc7cc0572e4392a8117cbf008b0e34c0db65c75506b0299cdbf
    binaryen_platform=aarch64-linux
    binaryen_sha=c58562417836c5d0493d89bdefc434933bdc097db641b483df86bcfa557a107f
    ;;
  Darwin/arm64)
    wabt_platform=macos-arm64
    wabt_sha=e5269d6bbe05dfeb179e4f21111b3a641d6ccaa38b0b21d472ae5c65f8c4ff5d
    binaryen_platform=arm64-macos
    binaryen_sha=98aad827847af7ef990ed7098d885725c8e5b5aae75073403635617ae4e259aa
    ;;
  Darwin/x86_64)
    # This WABT release has no macOS Intel archive. Use an installed assembler.
    command -v "${WAT2WASM:-wat2wasm}" >/dev/null 2>&1 ||
      fail 'install WABT 1.0.41 and set WAT2WASM/WASM2WAT on macOS Intel'
    command -v "${WASM2WAT:-wasm2wat}" >/dev/null 2>&1 ||
      fail 'install WABT 1.0.41 and set WAT2WASM/WASM2WAT on macOS Intel'
    wabt_platform=
    binaryen_platform=x86_64-macos
    binaryen_sha=40c3de90bb3766bd0282a895e139a6f50253dba49b4f5bb89e66faca162d832e
    ;;
  *) fail "no pinned tool archives for $(uname -s)/$(uname -m)" ;;
esac

# Hashes come from the official release assets. This is the only build command
# that downloads tools; it writes only to the ignored bin/.tools directory.
install_tool() {
  local name=$1 url=$2 expected=$3 archive_root=$4 executable=$5
  local destination="$tools_dir/$name"
  if [[ -d "$destination" ]]; then
    if [[ -x "$destination/$executable" && -f "$destination/.archive-sha256" ]] &&
      [[ "$(cat "$destination/.archive-sha256")" == "$expected" ]]; then
      printf '%s already installed\n' "$name"
      return
    fi
    fail "$destination exists without the pinned archive stamp; move it aside before retrying"
  fi
  local work="$stage/$name"
  mkdir -p "$work/unpacked"
  printf 'Downloading %s\n' "$name"
  curl --fail --location --silent --show-error --retry 3 "$url" -o "$work/archive"
  [[ "$(sha256 "$work/archive")" == "$expected" ]] || fail "$name archive checksum mismatch"
  if [[ "$url" == *.zip ]]; then
    unzip -q "$work/archive" -d "$work/unpacked"
  else
    tar -xzf "$work/archive" -C "$work/unpacked"
  fi
  local unpacked="$work/unpacked"
  [[ "$archive_root" == . ]] || unpacked="$unpacked/$archive_root"
  [[ -x "$unpacked/$executable" ]] || fail "$name archive has no $executable"
  printf '%s\n' "$expected" > "$unpacked/.archive-sha256"
  mv "$unpacked" "$destination"
}

if [[ -n "$wabt_platform" ]]; then
  install_tool wabt-1.0.41 \
    "https://github.com/WebAssembly/wabt/releases/download/1.0.41/wabt-1.0.41-$wabt_platform.tar.gz" \
    "$wabt_sha" wabt-1.0.41 bin/wat2wasm
fi
install_tool binaryen-132 \
  "https://github.com/WebAssembly/binaryen/releases/download/version_132/binaryen-version_132-$binaryen_platform.tar.gz" \
  "$binaryen_sha" binaryen-version_132 bin/wasm-opt

printf 'Pinned tools ready in %s\n' "$tools_dir"
