#!/usr/bin/env bash
set -euo pipefail

expected_sha256=69abc30005d2186baf7737feacd8da35633b93cf5af38838ecff17c5f8e924f6

if [[ $# -ne 2 || "$1" != /* || "$2" != /* ]]; then
  echo "usage: build-static-bwrap.sh /absolute/path/to/bubblewrap-0.11.2.tar.xz /absolute/output/path" >&2
  exit 2
fi

archive=$1
output=$2
actual_sha256=$(sha256sum "$archive" | cut -d' ' -f1)
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "Bubblewrap source checksum mismatch: $actual_sha256" >&2
  exit 1
fi

build_root=$(mktemp -d)
trap 'rm -rf "$build_root"' EXIT
tar -xJf "$archive" -C "$build_root"
source_root="$build_root/bubblewrap-0.11.2"

CFLAGS="${CFLAGS:-} -static" LDFLAGS="${LDFLAGS:-} -static" \
  meson setup "$build_root/build" "$source_root" \
    --buildtype=release \
    -Ddefault_library=static \
    -Dc_link_args=-static \
    -Dselinux=disabled \
    -Dsupport_setuid=false \
    -Dtests=false \
    -Dman=disabled \
    -Dbash_completion=disabled \
    -Dzsh_completion=disabled
meson compile -C "$build_root/build"
install -Dm755 "$build_root/build/bwrap" "$output"

if grep -aEq 'ld-linux|ld-musl|/nix/store' "$output"; then
  echo "Bubblewrap output is not a portable static executable" >&2
  exit 1
fi
"$output" --version | grep -F '0.11.2'
