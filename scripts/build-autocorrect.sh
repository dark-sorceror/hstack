#!/bin/sh
set -eu
hstack_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec node "$hstack_root/scripts/wasm-build.mjs" "$@"
