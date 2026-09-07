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
    tinygo_platform=linux-amd64
    tinygo_sha=b87688fa2e19cee7d813cad7fd7dadb71dff3198e47125aba66ba4af5e490438
    binaryen_platform=x86_64-linux
    binaryen_sha=195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572
    protoc_platform=linux-x86_64
    protoc_sha=c4bc672d9d49214dc8cafdceadf4df92182d6ca8e3ec65a56b2d7de5602669b4
    ;;
  Linux/aarch64|Linux/arm64)
    tinygo_platform=linux-arm64
    tinygo_sha=f2f3f863e63728b87772e7306bd6030df6e6c89773a7082eb0122113cf9e453d
    binaryen_platform=aarch64-linux
    binaryen_sha=c58562417836c5d0493d89bdefc434933bdc097db641b483df86bcfa557a107f
    protoc_platform=linux-aarch_64
    protoc_sha=237a68856edf1bd28b6204bddd0596c1cf46d298bc29c620012540b2e44c73e7
    ;;
  Darwin/arm64)
    tinygo_platform=darwin-arm64
    tinygo_sha=493da3585e66c5da677a4be39402faf2041b4e45a61eb456e4547eca753a544e
    binaryen_platform=arm64-macos
    binaryen_sha=98aad827847af7ef990ed7098d885725c8e5b5aae75073403635617ae4e259aa
    protoc_platform=osx-universal_binary
    protoc_sha=09cd927fd2a132e8fa5e2663f4cb6f11168126eb62cf21da68b51d74c2107a7e
    ;;
  Darwin/x86_64)
    tinygo_platform=darwin-amd64
    tinygo_sha=ef7b96cf59de5714a7493a696e9db141a85a99459620b00c42cb3bad14be2af2
    binaryen_platform=x86_64-macos
    binaryen_sha=40c3de90bb3766bd0282a895e139a6f50253dba49b4f5bb89e66faca162d832e
    protoc_platform=osx-universal_binary
    protoc_sha=09cd927fd2a132e8fa5e2663f4cb6f11168126eb62cf21da68b51d74c2107a7e
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

install_tool tinygo-0.42.0 \
  "https://github.com/tinygo-org/tinygo/releases/download/v0.42.0/tinygo0.42.0.$tinygo_platform.tar.gz" \
  "$tinygo_sha" tinygo bin/tinygo
install_tool binaryen-132 \
  "https://github.com/WebAssembly/binaryen/releases/download/version_132/binaryen-version_132-$binaryen_platform.tar.gz" \
  "$binaryen_sha" binaryen-version_132 bin/wasm-opt
install_tool protoc-36.1 \
  "https://github.com/protocolbuffers/protobuf/releases/download/v36.1/protoc-36.1-$protoc_platform.zip" \
  "$protoc_sha" . bin/protoc

printf 'Pinned tools ready in %s\n' "$tools_dir"
