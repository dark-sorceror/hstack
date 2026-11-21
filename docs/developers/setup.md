---
title: "Develop hstack"
description: "Build, test and reload in a separate vault."
---

Keep the source checkout separate from a personal vault. Edit `src/`, then
rebuild; generated main.js and installed copies are not the source of truth.

## Run the checks

Use Node 22.16+ on Node 22.x or Node 24+, and npm.

```sh
npm ci --ignore-scripts
npm run check
```

`check` runs lint, formatting, documentation links/navigation, source/Wasm
provenance, TypeScript contracts, runtime tests and the three-file install smoke
test. The smoke host is mocked; native Obsidian testing is still needed.

## Use a test vault

```sh
npm run build
mkdir -p /absolute/path/to/test-vault
npm run deploy -- /absolute/path/to/test-vault
npm run dev
```

Enable or reload hstack in that vault. Watch mode rebuilds the source bundle
with a development source map; it does not deploy automatically. Deploy and
reload deliberately after a rebuild. Deploy preserves data.json.

For a custom config directory, add `--config-dir=.config` to deploy. Do not
enable hstack and its legacy helper simultaneously.

## Languages and boundaries

The entry and public request/result/settings contracts are TypeScript. Most
runtime modules are JavaScript; four use `@ts-check`. Global `checkJs` is false.
This is not full strict TypeScript coverage. Prefer strict types for new public
interfaces and migrate runtime modules with behavior-parity checks.

Build scripts may remain .mjs, tests .cjs, and the autocorrect engine Rust.
Keep Obsidian and CodeMirror as host externals.

## Rebuild Rust only when needed

The versioned Wasm supports ordinary builds without Rust. For engine changes,
install the compiler and target pinned in rust-toolchain.toml, then run:

```sh
npm run build:wasm
npm run verify:wasm
npm run check
```

`RUSTC` can select an isolated compiler. The script checks the exact version and
never installs it. [Architecture](/developers/architecture) · [Data provenance](/developers/data).
