#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
version=1.31.1
tools_dir="$root/bin/.tools"
destination="$tools_dir/sqlc-$version"

fail() { printf 'setup-sqlc: %s\n' "$*" >&2; exit 1; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Official asset digests from:
# https://api.github.com/repos/sqlc-dev/sqlc/releases/tags/v1.31.1
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)
    platform=linux_amd64
    expected=497ae4fcdfa64c5b0c311ffe4c2bd991e43991e82e5367792ed78bc2dca27354
    ;;
  Linux/aarch64|Linux/arm64)
    platform=linux_arm64
    expected=b7cae247740d0c51a1e657479e5b2d21e6fef428f596682a01bc55bf4ab8a23d
    ;;
  Darwin/arm64)
    platform=darwin_arm64
    expected=21602158c99eb1f2bae197a66abfb1941d1e9e50b23125bb193349c6b1acc71e
    ;;
  Darwin/x86_64)
    platform=darwin_amd64
    expected=c5af76772e3785d21663a62697056b383f07629979b1bd25b93872e73dbd519b
    ;;
  *) fail "no pinned sqlc archive for $(uname -s)/$(uname -m)" ;;
esac

if [[ -d "$destination" ]]; then
  if [[ -x "$destination/sqlc" && -f "$destination/.archive-sha256" ]] &&
    [[ "$(cat "$destination/.archive-sha256")" == "$expected" ]] &&
    [[ "$("$destination/sqlc" version)" == "v$version" ]]; then
    printf 'sqlc %s already installed in %s\n' "$version" "$destination"
    exit 0
  fi
  fail "$destination exists without the pinned archive stamp or version; move it aside before retrying"
fi

mkdir -p "$tools_dir"
stage=$(mktemp -d "$tools_dir/.setup-sqlc.XXXXXX")
trap 'rm -rf "$stage"' EXIT
archive="sqlc_${version}_${platform}.tar.gz"
printf 'Downloading %s\n' "$archive"
curl --fail --location --silent --show-error --retry 3 \
  "https://github.com/sqlc-dev/sqlc/releases/download/v$version/$archive" \
  --output "$stage/$archive"
[[ "$(sha256 "$stage/$archive")" == "$expected" ]] || fail "archive checksum mismatch"
mkdir "$stage/unpacked"
tar -xzf "$stage/$archive" -C "$stage/unpacked"
[[ -x "$stage/unpacked/sqlc" ]] || fail "archive has no sqlc executable"
[[ "$("$stage/unpacked/sqlc" version)" == "v$version" ]] || fail "unexpected sqlc version"
printf '%s\n' "$expected" > "$stage/unpacked/.archive-sha256"
mv "$stage/unpacked" "$destination"
printf 'sqlc %s ready in %s\n' "$version" "$destination"
