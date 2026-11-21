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

All plugin runtime modules, the SQL worker and CLI source are TypeScript.
`strict`, `noUncheckedIndexedAccess`, `isolatedModules` and
`verbatimModuleSyntax` are enabled; JavaScript source is excluded from the
TypeScript project. Use type-only imports for contracts.

The build emits Obsidian's CommonJS main.js and the standalone bin/hstack.cjs
client. Edit bin/hstack.ts for CLI changes. Build scripts remain .mjs, existing
runtime tests .cjs, and the autocorrect engine Rust. Host-specific fields stay
behind narrow adapter types; Obsidian and CodeMirror remain external.

Tests compile source into a temporary directory, run the existing CommonJS
regressions there, then remove it. Run a focused suite with:

```sh
npm test -- tests/autocorrect.test.cjs
```

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
