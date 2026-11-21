---
title: "Architecture"
description: "Follow an edit from the plugin boundary to source analysis and storage."
---

hstack plans synchronous editor changes and gives tools revision-aware note
access. Markdown remains authoritative; there is no persistent note index.

## Source map

| Boundary                              | Responsibility                                            |
| ------------------------------------- | --------------------------------------------------------- |
| src/main.ts, src/api.ts               | Typed entry and per-method public contracts               |
| src/plugin.ts                         | Feature lifecycle, hooks and cleanup                      |
| src/editor/                           | Keyboard precedence, rendering and host adapters          |
| src/features/                         | Small writing planners and compatibility facades          |
| src/markdown/                         | UTF-16 source indices, emphasis and containment queries   |
| src/commands/, src/ui/                | Command dispatch, settings and help                       |
| src/agent/                            | Reads, metadata, guarded writes and the SQL child process |
| src/autocorrect/, native/autocorrect/ | TypeScript integration and Rust/Wasm engine               |
| bin/hstack.ts                         | Standalone official-CLI client                            |

## Edit consistency

Reads overlay a live source-mode buffer on saved vault content. Text, headings
and source-derived metadata share a SHA-256 revision; backlinks are labelled as
saved-cache data. Vault-wide snapshots are sequential rather than atomic.

Open-note patches read, check and apply without an await gap in one editor
transaction. Closed notes use Vault.process and check inside its callback.
Divergent buffers or a newly opened editor reject stale writes.

## Typing and rendering

The lexical index caches repeated document queries and preserves CRLF/BOM
offsets. Metadata also uses a list-aware code-block mask. Emphasis containment
uses sorted range indexes rather than all-pairs comparisons. Multiple selections
defer to native input; disabled markup display skips source analysis.

Autocorrect starts asynchronously. Typing does not wait for dictionary loading.
Settings and usage counts share one serialized save queue; command registries
belong to each plugin instance and dispose on unload.

## Distribution

esbuild embeds emoji, dictionary text, Wasm, required notices and a fixed SQL
runner in one CommonJS main.js. Obsidian/CodeMirror remain external. SQL sends a
bounded snapshot on stdin to an external Node child with a host-owned timeout.
Watch tracks the worker's transitive inputs. [Permissions](/security).

## Host compatibility

editor.cm, suggester ordering/selection fields and other host internals are not
all stable public APIs. Keep adapters localized and verify native behavior on
the supported app versions, including pop-out editors. TypeScript contracts and
mock-host tests do not prove host compatibility.
