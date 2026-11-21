---
title: "Slash commands"
description: "Format a note, create contents or open command help."
---

Type `/` on an otherwise empty line to open the command picker.
Tab completes the highlighted choice; Enter runs it. Your usage ranks choices.

| Command   | Alias      | Result                                          |
| --------- | ---------- | ----------------------------------------------- |
| `/format` | `/tidy`    | Normalizes Markdown spacing in the current note |
| `/toc`    | `/outline` | Inserts or refreshes heading-linked contents    |
| `/help`   | —          | Shows available commands and keyboard behavior  |

Commands run at a single caret outside protected code contexts. You can also
open slash help from Obsidian's command palette.

## Format without rewriting

`/format` adjusts spacing around headings and list markers. It preserves wording,
numbering, indentation, marker types, code fences, tables and diagrams. It does
not fact-check or reformat code. One Undo reverses the command.

## Refresh contents

`/toc` uses the note's actual headings and updates its existing managed block.
Code, display math and callout examples do not become page headings. CRLF source
offsets and line endings are preserved. Duplicate headings keep Obsidian's
normal heading targets rather than invented suffixes.

If contents markers were edited into an incomplete or ambiguous block, hstack
refuses to overwrite it. Repair the block before retrying.

## Add your own commands

[Text templates](/guides/templates) insert literal text with placeholders.
For trusted plugin code, [register a callback](/reference/extensions).
Slash commands do not call a model or generate explanations.
