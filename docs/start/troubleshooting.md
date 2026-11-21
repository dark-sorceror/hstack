---
title: "Troubleshooting"
description: "Resolve installation, command and bridge problems."
---

## Slash commands do not open

Check that hstack is enabled and **Slash commands** is on. Type `/` on its own
line, outside code, with a single caret. Tab completes a choice; Enter runs it.
Multiple selections use native editing rather than a single-range command.

If another suggestion plugin takes the key, reproduce it in a test vault with
only hstack enabled, then re-enable the other plugins one at a time.

## A typing feature changes text unexpectedly

Use immediate Backspace to recover a symbol shortcut or autocorrected word.
Add the word to **Words to keep**, or disable the relevant toggle. `/format`
has normal editor Undo. Report a synthetic reproducer if recovery fails.

## The CLI cannot reach the plugin

1. Keep the Obsidian desktop app running and the intended vault open.
2. Enable Obsidian's official CLI separately.
3. Set `NOTES_VAULT` to select the vault and check that **Agent bridge** is on.
4. Set `OBSIDIAN_CLI` if the executable is installed elsewhere.

If your agent is sandboxed, it may need permission to reach the CLI's local IPC.
An “unable to find Obsidian” message alone does not prove the app is stopped.

## SQL is unavailable

Run `capabilities` through the client. SQL needs Node 22.16+ on 22.x or a
compatible Node 24+ runtime. Set **SQL Node executable** to its absolute path
if discovery fails. This setting does not affect writing features.

## A patch is rejected

| Error                                | Next step                                                         |
| ------------------------------------ | ----------------------------------------------------------------- |
| `REVISION_CONFLICT`                  | Read the note again and rebuild the edit against its new revision |
| `DIVERGENT_EDITORS`                  | Reconcile different open buffers before editing                   |
| `SOURCE_CHANGED`                     | Read again after a closed note opens in an editor                 |
| `BRIDGE_DISABLED`                    | Enable Agent bridge if you intend to allow access                 |
| `SQL_TIMEOUT` / `SNAPSHOT_TOO_LARGE` | Narrow the folder or query                                        |

If a write times out or loses its reply, read the note before retrying.
For reports, include app/plugin/OS versions, exact actions and a synthetic note.
