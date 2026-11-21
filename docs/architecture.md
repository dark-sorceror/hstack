# Architecture

## Authoring and distribution

The official sample uses TypeScript plus esbuild. Obsidian runs JavaScript.
hstack uses a strict TypeScript entry/public contracts, existing JavaScript
algorithms, and a Rust core compiled to Wasm. This preserves tested logic while
allowing gradual typed migration. `allowJs` does not mean the JavaScript is
fully type-checked. Global `checkJs` remains false; the source index, settings
normalizer and SQLite capability boundary opt in with `@ts-check`. API requests
and results are typed per method, with compile-time negative tests.

The source repository is independent of a vault. esbuild bundles static imports,
JSON, dictionary text, Wasm bytes and the fixed SQL runner into one CommonJS
main.js. The runtime install contains only main.js, manifest.json and styles.css.
Third-party dataset notices are embedded in the JS header. Obsidian/CodeMirror
are host externals; bundling duplicate editor packages can break extensions.

No source paths, filesystem-relative runtime require calls, Rust compiler, npm
install step or network downloads are needed after installing the three files.
The Wasm binary is versioned alongside its rebuildable Rust source. Changing
assets requires rebuilding the bundle.

## Feature lifecycle

`src/main.ts` exposes the typed public facade. `src/plugin.js` initializes options,
registers input handlers, suggesters, rendering hooks and settings, and owns
cleanup. `src/features` contains pure plans and small compatibility facades. Keyboard
precedence, editor transactions and host-private integration points live in
`src/editor`; source analysis and pairing/rendering are separate modules. `src/ui`
contains settings and help. Editor changes are synchronous plans, not delayed
whole-document rewrites. Autocorrect initializes asynchronously and typing does
not wait for it. Slash command registries are per plugin instance.

Custom JSON templates become literal insertion commands. Trusted script commands
register callbacks and return disposers. The text template path never evaluates
strings. Built-in command names/aliases cannot be overwritten.

## Agent reads and writes

The dispatcher delegates live note access and guarded writes to `note-store`,
source-derived metadata to `metadata`, and process/runtime handling to
`sql-process`. Revision check and write stay together in the note store.

The bridge reads saved content and overlays the current source-mode editor.
Source-derived headings/links/tags/properties share the text's SHA-256 revision.
Cached backlinks are labelled. Snapshots iterate files, not an atomic vault-wide
transaction. Reads include bounded excerpts with UTF-16 source pointers.

For writes to an open note, read/check/apply occurs without an await gap, in one
editor transaction. Closed notes use Vault.process with the revision checked
inside its synchronous callback. Opening/divergent buffers reject stale writes.
The bridge does not create/delete/rename files or manage settings files.

## SQL process

The fixed runner is bundled as code, then executed with local Node using `-e`.
SQL and note contents travel on stdin as JSON, never as executable JavaScript.
Only an in-memory SQLite snapshot is populated. Query-only mode, disabled
extensions, a lexical allowlist boundary, heap/row/cell/output bounds and a
host-owned SIGKILL timeout limit execution. Worker threads cannot reliably
interrupt synchronous native SQLite work, which is why a child process is used.
No persistent index or temporary note database is created.

## Known host integration risks

The typing layer uses native CodeMirror plus some Obsidian internals:
`editor.cm`, syntax-token internals, `workspace.editorSuggest.suggests`, and
native suggestion selection fields. They support the requested typing behavior
and conflict handling, but are not all stable public API. Maintain compatibility
tests and review feedback before a public release. Plugin enumeration used by
external scripts is also host-specific. Do not claim directory approval until
Obsidian's review actually passes.

The personal theme snippet is separate. Feature CSS is scoped to classes/data
attributes created by this plugin. Keep styling changes out of algorithmic edits.

## Shared source index

`src/markdown/source.js` indexes line starts and block state once per document.
Protection queries scan only the relevant line prefix; metadata keeps an explicit
index for its full scan. A bounded two-document cache serves repeated typing and
suggestion checks. CRLF/BOM classification preserves original UTF-16 offsets.
Feature-specific heading, formatter and emphasis policies remain distinct to
preserve their existing behavior. The refactor is checked against the previous
LF protection rules at every offset across mixed contexts.

Heading classification uses CRLF-aware source lines while retaining original
UTF-16 offsets. Metadata combines lexical inline protection with the rendering
scanner's list-aware code and HTML block mask. Display math is excluded from
page headings. Emphasis ancestry and nested asterisk containment use sorted
range indexes instead of comparing every pair of spans. Rendering skips analysis
when both markup display features are disabled. Single-range typing plans and
suggestion menus defer to native editing when multiple selections are present.

## Commands and persistence

Built-in names and aliases come from one command catalog. Saved templates are
restored at startup and disposed on unload. A typed settings normalizer and one
serialized write queue serve feature settings and usage counters. Registries
remain per-instance. Invalid persisted templates report an error without
rewriting the saved configuration or disabling typing helpers.

## Build consistency

The SQL worker is a virtual build dependency with explicit watch files for its
entry and transitive inputs. The Node runtime is capability-probed, not inferred
from an executable's existence. Rust source and toolchain hashes accompany the
Wasm binary; CI reproduces the binary with pinned Rust and remapped source paths.
The Rust lookup algorithm and editor keyboard priority remain unchanged.
