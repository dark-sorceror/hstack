# Architecture

## Authoring and distribution

The official sample uses TypeScript plus esbuild. Obsidian runs JavaScript.
hstack uses a strict TypeScript entry/public contracts, existing JavaScript
algorithms, and a Rust core compiled to Wasm. This preserves tested logic while
allowing gradual typed migration. `allowJs` does not mean the JavaScript is
fully type-checked; `checkJs` is currently false.

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
cleanup. `src/features` contains pure plans and presentation adapters. `src/ui`
contains settings and help. Editor changes are synchronous plans, not delayed
whole-document rewrites. Autocorrect initializes asynchronously and typing does
not wait for it. Slash command registries are per plugin instance.

Custom JSON templates become literal insertion commands. Trusted script commands
register callbacks and return disposers. The text template path never evaluates
strings. Built-in command names/aliases cannot be overwritten.

## Agent reads and writes

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
