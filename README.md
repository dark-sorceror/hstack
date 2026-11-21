# hstack

<p align="center">
  <img src="docs/images/hstack-logo-centered.png" alt="hstack logo" width="112" height="112" />
</p>

<p align="center">
  <a href="docs/start/quickstart.md">Quickstart</a> ·
  <a href="docs/index.mdx">Documentation</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

**Write comfortably. Find the right section. Review precise edits.**

hstack adds typing helpers, local slash commands, and live note access for tools
to Obsidian. Keep Markdown as the source of truth while scripts read your current
editor and propose changes that reject stale revisions.

Desktop only · 1.0.0 release candidate · Not yet listed in Community Plugins.

## Start with a note

| You want to…                                               | Try                    |
| ---------------------------------------------------------- | ---------------------- |
| Clean up Markdown spacing without rewriting the wording    | `/format`              |
| Add or refresh a heading-linked table of contents          | `/toc`                 |
| Fix a clear typo, then recover it with Backspace if needed | Offline autocorrect    |
| Let a tool read the current note and preview an edit       | The local agent bridge |

Typing tools also include emoji search, mixed lists, reversible arrows/dashes,
callout-aware paste and optional `__underline__` rendering. Each feature has a
toggle. Underline and dashed lists are plugin-specific display conventions.

## Install the candidate

From a source checkout, with Node 22.16+ on 22.x or Node 24+:

```sh
npm ci --ignore-scripts
npm run check
npm run package
```

Copy `main.js`, `manifest.json` and `styles.css` from `dist/1.0.0/` to your vault's
plugin folder, then enable **hstack**. Start in a separate test vault.
[Installation steps](docs/start/installation.md) · [Your first note](docs/start/quickstart.md)

Requires Obsidian 1.14.4+. Native testing is on macOS; Windows/Linux UI validation
remains outstanding. Installed writing features need no Node runtime. SQL needs
a compatible external Node executable.

## Choose your path

- **Use hstack:** [Writing tools](docs/guides/writing.md), [slash commands](docs/guides/commands.md), [templates](docs/guides/templates.md).
- **Connect a tool:** [CLI setup](docs/guides/agent-setup.md), [bridge methods](docs/reference/bridge.md), [preview and apply an edit](docs/reference/patches.md).
- **Contribute:** [Development setup](docs/developers/setup.md), [architecture](docs/developers/architecture.md), [release guide](docs/developers/releases.md).

## Local by design

No runtime network requests, accounts, telemetry or model calls. The bridge is
enabled by default and can be disabled in settings. It can modify existing
visible Markdown notes after revision checks; it does not create or delete files.

SQL launches a local Node process. Node discovery reads executable metadata
outside the vault, and the separate CLI client uses temporary lock files outside
it. Neither indexes outside-vault documents. The bridge is a consistency API for
trusted local code, not a sandbox for the unrestricted Obsidian CLI.
[Permissions and limits](docs/security.md).

## License

Original code: [MIT](LICENSE). Bundled emoji: [gemoji MIT notice](licenses/LICENSE.gemoji).
English frequency data: [SymSpell, Google Books Ngrams and SCOWL notices](licenses/LICENSE.autocorrect-data).
Attribution is also embedded in the release bundle. [Data provenance](docs/developers/data.md).
Not affiliated with Obsidian.
