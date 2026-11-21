---
title: "Bridge API"
description: "Methods, JSON replies and source pointers for API version 1."
---

Send requests through `plugin.api.request()` or the [CLI client](/guides/agent-setup).
The legacy `plugin.agent.request()` alias uses the same dispatcher.

```json
{ "apiVersion": 1, "id": "r1", "method": "query", "params": { "text": "compiler", "limit": 5 } }
```

## Replies

```json
{
  "apiVersion": 1,
  "id": "r1",
  "ok": true,
  "result": { "matches": [], "truncated": false, "limit": 5, "snapshotNotes": 0 }
}
```

Failures return `{apiVersion:1,id,ok:false,error:{code,message,details?}}`.
`apiVersion` can be omitted for v1. IDs are short strings or safe integers.

## Methods

| Method         | Parameters                                                                                |
| -------------- | ----------------------------------------------------------------------------------------- |
| `capabilities` | None; returns enabled state, methods, SQL capability and limits                           |
| `context`      | Optional `path`, `radius` (1–8,000; default 1,000)                                        |
| `query`        | Optional `text`, `folder`, `tag`, `properties`, `linksTo`, `limit` (1–200; default 30)    |
| `readSection`  | Required `path`; heading/occurrence or source range; `maxChars` (1–16,000; default 8,000) |
| `sql`          | Required `sql`; optional bound `params`, `folder`, `limit` (1–200; default 50)            |
| `patch`        | Required `path`, `expectedRevision`, `edits`; `dryRun` defaults to true                   |
| `reveal`       | Required `path`; heading/range; `focus` defaults to false                                 |

`properties` filters by equality. `linksTo` uses a resolved note path. Text search
is substring-based. Duplicate heading targets need a zero-based `occurrence`.

## Paths and offsets

Paths identify existing visible vault-relative `.md` files. Absolute, hidden,
parent and escaping symlink paths are rejected. The bridge cannot create,
delete or rename files, and cannot patch AGENTS.md or CLAUDE.md.

Source pointers carry `path`, SHA-256 `revision`, `source` (`editor` or `vault`),
`from`, `to`, `lineStart`, `lineEnd` and `headingPath`. Offsets are UTF-16 half-open
ranges; lines and occurrences start at zero.
Offsets refer to Obsidian’s decoded text, not file bytes. Use the returned text
as the offset source; saved-file decoding may omit a leading BOM.

## Read limits

Context returns live selections, cursor, headings, links, tags, properties and
saved-cache backlinks. Check truncation flags. Backlinks can lag unsaved text.
`readSection.sectionTo` is the full range/subtree end even when its text is clipped.

Metadata covers common Markdown rather than every extension. Corpus snapshots
capture notes sequentially, not as one atomic vault transaction. Invalid YAML
reports an error rather than inventing properties.

Responses are capped at 512 KiB. For writes see [patches](/reference/patches); for tables,
parameters and query limits see [SQL](/reference/sql). `src/api.ts` defines method-specific
TypeScript request/result contracts, including negative compile-time tests.
