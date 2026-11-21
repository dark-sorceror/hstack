# Public API v1

Find the enabled plugin instance through a trusted integration:

```ts
import type { HstackAPI } from './path/to/hstack/src/api';
const plugin = app.plugins.plugins['hstack'];
const api: HstackAPI = plugin.api;
if (api.version !== 1) throw new Error('Unsupported API');
```

Plugin enumeration is an Obsidian integration surface, not a guarantee against
future host changes. Check for absence; do not access an instance after unload.
The private helper deployment ID is `notes-typing-helpers`.

- `api.formatMarkdown(text)` → pure string transform. It does not edit a note.
- `api.registerSlashCommand(command)` → idempotent dispose function.
- `api.request(request)` → Promise of the bridge JSON envelope below.

## Register a command

```js
const dispose = api.registerSlashCommand({
  id: 'stamp', name: 'stamp', aliases: ['timestamp'],
  icon: '🕒', description: 'Insert the current ISO timestamp',
  run({editor, from, to}) {
    editor.replaceRange(new Date().toISOString(),
      editor.offsetToPos(from), editor.offsetToPos(to));
  }
});
this.register(dispose); // For a Plugin subclass.
```

IDs must equal names, use lowercase letters/hyphens, 1–40 characters. Aliases
follow the same rule and must be unique. Descriptions are at most 200 characters.
`run` receives `{app,editor,from,to,title}`. Offsets cover the invoking slash
text. A callback owns replacement; it should use a single editor transaction.
For asynchronous work, re-read and revision-check before editing. Do not retain
stale offsets. Throw/reject failures for a visible notice. No callback is built
from a string or a note.

## Bridge request/response

```json
{"apiVersion":1,"id":"r1","method":"query","params":{"text":"compiler","limit":10}}
```

`apiVersion` may be omitted for v1. IDs are short strings or safe integers.
Success: `{apiVersion:1,id,ok:true,result}`. Failure:
`{apiVersion:1,id,ok:false,error:{code,message,details?}}`.
The legacy `plugin.agent.request` dispatches to the same implementation.

| Method | Parameters |
| --- | --- |
| `capabilities` | None: enabled flag, methods, schema, limits |
| `context` | Optional `path`, `radius` (1–8,000; default 1,000) |
| `query` | Optional `text`, `folder`, `tag`, `properties` equality object, `linksTo` resolved path, `limit` (1–200; default 30) |
| `readSection` | Required `path`; exact `heading` plus optional zero-based `occurrence`, or `from`/`to`; `maxChars` (1–16,000; default 8,000) |
| `sql` | `sql`, optional bound `params`, `folder`, `limit` (1–200; default 50) |
| `patch` | `path`, `expectedRevision`, `edits:[{from,to,text}]`, optional `dryRun` (default true) |
| `reveal` | `path` plus heading/range; optional `focus` (default false) |

Paths must identify existing visible `.md` files inside the vault. Hidden,
parent, absolute and escaping symlink paths are rejected. Instruction files
named AGENTS.md and CLAUDE.md cannot be patched. Creates/deletes/renames are not
in v1. Offsets use UTF-16, half-open ranges; lines and occurrences are zero-based.
Reads return the exact text revision (`sha256:…`) and `editor`/`vault` source.

Context includes live selections, cursor, heading ranges, links, tags,
properties and saved-cache backlinks. Payloads are bounded and report
truncation. Long context property values may be truncated JSON text. Query
flags empty notes. Duplicate heading targets require occurrence selection.
`readSection.sectionTo` is the full subtree/range end even when text is clipped.

## SQL schema

| Table | Columns |
| --- | --- |
| `notes` | path, title, folder, revision, source, content, modified (mtime milliseconds) |
| `headings` | path, heading, level, line, start, end (subtree bounds) |
| `links` | source, target, resolved (0/1), heading, line |
| `tags` | path, tag (includes #) |
| `properties` | path, key, value_json |

A fresh in-memory SQLite snapshot includes live editor buffers. It is not a
vault-wide atomic transaction; note revisions identify the individual captures.
Markdown remains authoritative. Tables are for retrieval; queries cannot edit.
Only a single SELECT/WITH is allowed. Use `?` or named bound parameters; do not
concatenate user values into SQL. Result has `columns`, positional `rows`,
truncation/cell flags, snapshot counts, `durationMs`, `capturedAt`, `readOnly:true`.

Limits: SQL 8,192 chars, 128 bound params, 1-second child-process budget,
128 MiB SQLite heap, 32 MiB snapshot, 200 rows max, 4,096 chars per cell,
512 KiB response max. No persistent DB, extensions, file functions or PRAGMA.
Set an absolute **SQL Node executable** in settings if discovery fails.
Capabilities probes the executable for the required SQLite methods and reports
`available:false` with a reason if it is incompatible. On the Node 22.x line,
22.16.0 is the minimum; current 24+ runtimes are also supported.

## Safe patch sequence

1. Read the explicit target and its revision.
2. Submit a default dry-run patch and inspect its edits and bounded preview.
3. Apply the same revision/edits with `dryRun:false`.
4. On conflict, refetch and reconsider the change. Do not force-write old text.

Open source-mode notes use a synchronous editor transaction. Closed notes use
atomic `Vault.process`. Divergent editor buffers and changes in source reject
writes. Up to 128 non-overlapping edits; at most 2 MiB inserted text. Surrogate
pairs cannot be split. The CLI wrapper imposes a smaller 48 KiB request limit.
`transformedByEditor` reports native/plugin filters; the returned revision is
the actual editor result. Preview text is bounded, not a full diff.

Common errors: `BRIDGE_DISABLED`, `NOTE_NOT_FOUND`, `INVALID_PATH`,
`TARGET_NOT_FOUND`, `AMBIGUOUS_TARGET`, `REVISION_REQUIRED`, `REVISION_CONFLICT`,
`SOURCE_CHANGED`, `DIVERGENT_EDITORS`, `INVALID_EDITS`, `INVALID_FRONTMATTER`,
`SQL_UNAVAILABLE`, `SQL_BUSY`, `SQL_TIMEOUT`, `READ_ONLY_SQL`, `RESULT_TOO_LARGE`.
The wrapper exits nonzero for errors and validates response IDs. If a write
loses its acknowledgement or times out, re-read before retrying.

TypeScript contracts in `src/api.ts` correlate each method with its required
parameters and response. For example, patch requires `expectedRevision`, and a
successful SQL result has typed columns/rows. Runtime validation remains in
place for JavaScript/CLI callers. Existing API v1 envelopes and aliases are
preserved.
