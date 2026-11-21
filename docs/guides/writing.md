---
title: "Writing tools"
description: "Choose the typing behaviors that fit your notes."
---

Each feature has its own switch in hstack's settings. The candidate enables
them by default; turning one off leaves the others available.

| Tool                     | What it changes                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Mixed lists              | Tab creates bullet children; exiting an empty child resumes its parent's list type |
| Literal spaces           | Repeated Space stays literal; Tab still indents                                    |
| English autocorrect      | Corrects clear typos after Space; skips paste and protected contexts               |
| Callout paste            | Keeps quote prefixes and indentation across multiline paste                        |
| Arrow and dash shortcuts | Converts symbol sequences immediately                                              |
| List-prefix shortcuts    | `.-` starts a dot bullet; `[]` starts a checkbox                                   |
| Dashed lists             | Displays ordinary hyphen list markers as dashes                                    |
| Underscore underlining   | Renders `__text__` as underline; `**text**` stays bold                             |
| Close emphasis pairs     | Extends native emphasis pairs and cleans empty pairs on Enter                      |
| Emoji picker             | `:` opens search; Enter inserts the selected colored emoji                         |

## Recover a change

Immediately press Backspace after a symbol conversion to restore its raw input.
After an autocorrection, Backspace restores the spelling and removes the trigger
space. The rejected word stays unchanged for the rest of that session.

**Words to keep** permanently preserves your technical or personal terms.

## Symbol shortcuts

| Input  | Result |
| ------ | ------ |
| `--`   | –      |
| `---`  | —      |
| `-->`  | ⟶      |
| `<--`  | ⟵      |
| `<-->` | ⟷      |

These conversions happen while typing, without waiting for Space. Multiple-cursor
input falls back to native behavior so secondary carets are preserved.

## Markdown portability

Underline and dashed-list display are hstack conventions. Another renderer may
show `__text__` as bold and hyphen lists as ordinary bullets. The stored source
remains Markdown; global fonts, colors and themes are separate from the plugin.
