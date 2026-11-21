<h1 align="center">hstack</h1>

<p align="center">
  <img src="docs/images/hstack-logo-centered.png" alt="hstack logo" width="112" height="112" />
</p>

<p align="center">
  <strong>Collaborate with your agents in Obsidian.</strong>
</p>

<p align="center">
  <a href="docs/start/quickstart.md">Quickstart</a> ·
  <a href="docs/guides/agent-setup.md">Connect an agent</a> ·
  <a href="docs/index.mdx">Documentation</a>
</p>

## Work with agents

- **Share what you're working on.** Give connected agents your current note, selection and headings, including unsaved edits.
- **Find the right context.** Search your vault, read specific sections or query notes with SQL.
- **Review edits first.** Preview changes before applying them. Edits based on an older version are rejected if you've changed the note.

[Connect an agent](docs/guides/agent-setup.md) · [Bridge API](docs/reference/bridge.md)

## Keep writing

- **Tidy a draft.** `/format` cleans up Markdown spacing; `/toc` builds linked contents from your headings.
- **Skip repetitive setup.** Turn your own templates into slash commands for recurring notes and tasks.
- **Keep your flow.** Correct typos, insert symbols and emoji, and preserve list structure and callout formatting while you write.

Choose which typing helpers run in settings. Immediate Backspace restores autocorrections and symbol conversions. Optional `__underline__` rendering and dashed list markers are hstack conventions; other Markdown readers may show them differently.

[Writing tools](docs/guides/writing.md) · [Commands](docs/guides/commands.md) · [Templates](docs/guides/templates.md)

## Install the candidate

Desktop only · 1.0.0 release candidate · Requires Obsidian 1.14.4+.

Build from this checkout with Node 22.16+ on 22.x or Node 24+:

```sh
npm ci --ignore-scripts
npm run check
npm run package
```

Copy `main.js`, `manifest.json` and `styles.css` from `dist/1.0.0/` into your test vault's `.obsidian/plugins/hstack/`, then enable **hstack**. [Installation details](docs/start/installation.md).

After installation, writing features need no Node runtime. The standalone CLI and SQL require a compatible Node executable. Native checks cover macOS/Obsidian 1.15.0; Windows/Linux remain unverified.

[Troubleshooting](docs/start/troubleshooting.md)

## Develop

The plugin, SQL worker and CLI source are strict TypeScript; autocorrect uses Rust/WebAssembly. Ordinary builds need no Rust installation. Use `npm run dev` to watch plugin changes; rebuild with `npm run build` to update `bin/hstack.cjs`.

### Repository structure

```text
.
├── src/                 Plugin runtime and bundled data
│   ├── main.ts          Obsidian entry point
│   └── api.ts           Public API contracts
├── bin/
│   └── hstack.ts        Standalone CLI source
├── native/              Rust autocorrect engine
├── scripts/             Build, test and packaging tools
├── tests/               Runtime and type regressions
├── docs/                User, API and developer guides
├── licenses/            Bundled-data notices
├── .github/
│   └── workflows/       CI and draft releases
└── styles.css           Editor and reading styles
```

[Contributing](CONTRIBUTING.md) · [Architecture](docs/developers/architecture.md) · [Release guide](docs/developers/releases.md)

## Local access

No runtime network requests, accounts, telemetry or model calls. The bridge is enabled by default and can be disabled. Trusted tools can read notes and modify existing visible Markdown after revision checks; the bridge cannot create or delete notes and is not an OS sandbox.

SQL starts a local Node process; runtime discovery inspects executable metadata outside the vault. The CLI uses temporary locks outside it. Neither indexes outside-vault documents. [Permissions and limits](docs/security.md).

## License

[MIT](LICENSE) for original code. Bundled assets retain their [gemoji](licenses/LICENSE.gemoji) and [English-data notices](licenses/LICENSE.autocorrect-data); attribution is embedded in the release. [Data provenance](docs/developers/data.md). Not affiliated with Obsidian.
