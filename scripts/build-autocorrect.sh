#!/bin/sh
set -eu
hstack_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
hstack_rustc=${RUSTC:-rustc}
"$hstack_rustc" --edition=2021 --target=wasm32-unknown-unknown --crate-type=cdylib -O \
  -C panic=abort -C lto=fat -C codegen-units=1 -C strip=symbols \
  -C link-arg=--initial-memory=67108864 -C link-arg=--max-memory=100663296 \
  "$hstack_root/native/autocorrect/core.rs" -o "$hstack_root/src/data/autocorrect.wasm"
printf '%s\n' 'Built src/data/autocorrect.wasm; run npm run build to embed it.'
