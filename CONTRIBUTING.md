# Contributing

Start with [development setup](docs/developers/setup.md). Use Node 22.16+ on
Node 22.x or Node 24+, and a separate test vault.

```sh
npm ci --ignore-scripts
npm run check
```

## Make a focused change

- Edit src/ or bin/hstack.ts; rebuild the generated outputs.
- Preserve Markdown meaning, typing precedence and one-step Undo.
- Add focused regression checks for behavior changes. Use synthetic notes.
- Keep Obsidian/CodeMirror external. Avoid new runtime services or dependencies
  unless the feature needs them.
- Keep runtime TypeScript strict; do not hide gaps behind broad `any` or
  `ts-nocheck`. Preserve runtime validation at external boundaries.

Build scripts can remain .mjs, tests .cjs, and the autocorrect engine Rust.
For Rust changes, rebuild with the pinned compiler and verify the shipped Wasm.

## Prepare a review

Use a scoped issue and topic branch. Commit subjects follow
`type(scope): summary` with no body. Explain the observable change and checks
actually performed; keep unrelated formatting and migration work separate.

Run `npm run package` before release work. Never include vault notes, data.json,
credentials or local research in commits or bug reports.

[Architecture](docs/developers/architecture.md) · [Security](docs/security.md) ·
[Documentation](docs/developers/documentation.md) · [Release guide](docs/developers/releases.md)
