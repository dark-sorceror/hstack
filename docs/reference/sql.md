---
title: "Read-only SQL"
description: "Query live note snapshots with bound parameters."
---

SQL builds a fresh in-memory snapshot, including live source-mode editor buffers.
It does not persist an index or write notes. Requires an external Node executable
with the required SQLite APIs: 22.16+ on Node 22.x or a compatible Node 24+ runtime.

```sh
NOTES_VAULT=MyVault node bin/hstack.cjs sql '{"sql":"SELECT path, heading FROM headings WHERE path LIKE ?","params":["Git/%"],"limit":20}'
```

Expect `columns`, positional `rows`, `rowCount`, truncation flags, snapshot counts,
`durationMs`, `capturedAt` and `readOnly: true` in a successful result.

## Tables

| Table        | Columns                                                  |
| ------------ | -------------------------------------------------------- |
| `notes`      | path, title, folder, revision, source, content, modified |
| `headings`   | path, heading, level, line, start, end                   |
| `links`      | source, target, resolved, heading, line                  |
| `tags`       | path, tag                                                |
| `properties` | path, key, value_json                                    |

`modified` is mtime in milliseconds. Heading `end` is the subtree boundary.
Tags include `#`; `resolved` is 0 or 1. Properties store JSON text.

## Parameters and scope

Only one SELECT/WITH statement is accepted. Bind user values with `?` or named
parameters instead of concatenating SQL. Values can be strings, finite numbers,
booleans or null. The optional `folder` narrows the snapshot before querying.

Set **SQL Node executable** to an absolute path if discovery fails. `capabilities`
probes the runtime's methods and reports why SQL is unavailable.

## Limits

| Resource               | Maximum                       |
| ---------------------- | ----------------------------- |
| SQL / parameters       | 8,192 characters / 128 values |
| Snapshot               | 32 MiB                        |
| Child execution budget | 1 second                      |
| SQLite heap            | 128 MiB                       |
| Rows / columns         | 200 / 100                     |
| Cell / response        | 4,096 characters / 512 KiB    |

Check cell/row truncation before treating an absent value as evidence. Notes are
captured sequentially, so use each note's revision for a later patch. Query-only
mode, disabled extensions and a kill timeout constrain the child process; SQL
cannot use PRAGMA, attach databases or load file functions.
