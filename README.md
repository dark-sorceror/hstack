# hstack

**A comfortable place to write. A precise place for agents to work.**

hstack combines small writing tools with live, revision-aware access to an
Obsidian vault. Write raw notes, navigate and format them with local commands,
then let an agent retrieve the right context and propose focused edits.

**Status:** local 1.0.0 release candidate. Not published to the Community
Plugins directory yet. Desktop only. Minimum tested Obsidian version: 1.14.4.
macOS has live testing; Windows/Linux still need native-app testing before a
public support claim. SQL needs a separately installed Node.js 22.16+ (22.x) or 24+ runtime.
Other writing features do not require a local Node installation.

## What you get

- **Writing:** mixed numbered/bullet lists, literal spaces, optional dashed list
  markers, `__underline__`, emphasis pairs, arrows/dashes, and callout-aware paste.
- **Offline assistance:** searchable colored emoji and Rust/WebAssembly English
  autocorrect after Space, with immediate Backspace recovery and preserved words.
- **Local slash commands:** `/toc` (`/outline`), `/format` (`/tidy`), `/help`.
  A bare `/` opens suggestions; Tab completes, Enter runs. Frequency ranks choices.
- **Your commands:** JSON templates in settings; a versioned API for trusted scripts
  or plugins to register commands without changing generated code.
- **Agent bridge:** live context/selections, text and metadata queries, heading
  reads, read-only SQL snapshots, guarded edit previews and revision-checked writes.

`/format` normalizes Markdown spacing. It preserves explanations, custom marker
types, numbering, indentation, code, tables and diagrams. It does not rewrite
notes, fact-check them or reformat code inside fences. One Undo reverses it.
Custom `__underline__` and dashed-list rendering are plugin-specific; other
Markdown renderers may display underscores as bold and hyphen lists as bullets.

## Install locally

Until a public release exists:

```sh
npm ci
npm run check
npm run package
```

Copy `main.js`, `manifest.json`, and `styles.css` from `dist/1.0.0/` into
`<vault>/<config-dir>/plugins/hstack/`, then enable **hstack** in Community
plugins. The usual configuration directory is `.obsidian`; use your vault's
actual directory if customized. Never run the old typing helper and hstack
simultaneously: both handle the same input.

For development, use a separate test vault:

```sh
npm run build
npm run deploy -- /absolute/path/to/test-vault
npm run dev
```

Watch rebuilds the source project's bundle only. Deploy and reload deliberately
after a rebuild; it does not silently overwrite your personal vault. Deploy
preserves `data.json`. [Development guide](docs/development.md).

## Make it yours

Every typing feature has a toggle in settings. Add technical/personal words in
**Words to keep**. To add `/study`, put this in **Custom slash templates**:

```json
[
  {
    "name": "study",
    "description": "Start a short study session",
    "template": "## {{title}} — {{date}}\n\n### What I understand\n\n### Questions\n- [ ] \n\n### Sources\n"
  }
]
```

Templates are text, never evaluated code. Placeholders are `{{title}}`, `{{date}}`,
`{{time}}` and `{{selection}}`. Slash commands normally run at an empty caret, so
selection is usually empty. Valid JSON saves immediately; invalid input shows an
error and retains the previous configuration. [Customization guide](docs/customization.md).

## Use with Codex or a script

Enable Obsidian's official CLI separately; the desktop app must be running.
This repository includes the Node client, separate from the plugin release:

```sh
NOTES_VAULT=MyVault node bin/hstack.cjs context
NOTES_VAULT=MyVault node bin/hstack.cjs query '{"text":"staging"}'
NOTES_VAULT=MyVault node bin/hstack.cjs sql '{"sql":"SELECT path, heading FROM headings WHERE path LIKE ?","params":["Git/%"]}'
```

With no `NOTES_VAULT`, the official CLI chooses its active vault. Set
`OBSIDIAN_CLI` if the executable is elsewhere. The client serializes CLI calls to
avoid cross-routed eval output. No MCP server is installed by hstack.

Other plugins/scripts can access `plugin.api` (version 1): `request`,
`formatMarkdown` and `registerSlashCommand`. The legacy `plugin.agent.request`
alias remains available. [API reference](docs/api.md), [agent workflow](docs/agents.md).

## Privacy and permissions

- No runtime network requests, accounts, telemetry, model calls or paid services.
- No automatic downloads, dependency installation, self-updates, or network listener.
- The agent bridge can read visible Markdown notes and modify explicit existing
  notes after revision checks; disable **Agent bridge** to reject those requests.
- SQL sends a bounded in-memory snapshot to a local Node child process. It does
  not persist an index or write notes. It has execution, heap and output limits.
- The CLI client launches the official Obsidian CLI and uses temporary lock files
  outside the vault. SQL discovers an external Node executable or uses the path
  configured in settings. No outside-vault documents are indexed by the bridge.
- Plugin settings/usage counts stay in Obsidian's `data.json`. Notes are not
  rewritten on load. Custom commands from scripts execute trusted code you install.
- The bridge is a consistency API, not a security sandbox for an unrestricted CLI.

See [security and limitations](docs/security.md) before agent integrations.

## Source map

```text
src/main.ts             TypeScript plugin entry
src/api.ts              Public API contracts
src/plugin.js           Editor integration and feature lifecycle
src/features/           Small, independently tested writing algorithms
src/editor/             Keyboard, editor compatibility and rendering adapters
src/markdown/           Shared lexical index and source/emphasis analysis
src/commands/           Command catalog and dispatch
src/ui/                 Settings and slash help
src/agent/              Context, queries, patches, isolated SQLite runner
src/autocorrect/        JavaScript/Wasm integration
src/data/               Bundled dictionary, emoji and Wasm assets
native/autocorrect/     Rust engine source
bin/hstack.cjs         Standalone official-CLI client
scripts/                Build verification, packaging, deploy, versioning
tests/                 Unit, integration and preservation checks
docs/                  User, API, architecture and release documentation
```

The TypeScript entry/API and method-specific request/result contracts are checked
strictly. Settings, the source index and SQLite capability checks also opt into
checked JavaScript. Remaining JavaScript migration is incremental. Release `main.js` is a
CommonJS bundle with assets and required notices embedded; no runtime npm
packages are downloaded. CodeMirror and Obsidian stay external host dependencies.

## Maintainability checks

`npm run check` includes linting, formatting, source/Wasm provenance, typed API
contracts, editing/lifecycle regression tests and the three-file install smoke
test. CI also tests the minimum Node 22.16.0 runtime and rebuilds the shipped
Wasm with the compiler pinned in `rust-toolchain.toml`. See the development guide
for local Rust verification. Watch mode tracks the embedded SQL worker's inputs.

## License and credits

Original code: [MIT](LICENSE), copyright Hao Yan. Emoji data: GitHub gemoji
([MIT notice](licenses/LICENSE.gemoji)). English frequency data: pinned SymSpell
intersection of Google Books Ngrams and SCOWL; [data provenance](docs/autocorrect-data.md)
and [underlying notices](licenses/LICENSE.autocorrect-data). These notices are
also embedded in the release bundle. Not affiliated with Obsidian.

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) ·
[Architecture](docs/architecture.md) · [Release checklist](docs/releasing.md)
