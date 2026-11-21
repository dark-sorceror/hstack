---
title: "Your first note"
description: "Clean up a note and add linked contents in a few steps."
---

By the end, you'll have a formatted note with a table of contents and know how
to undo a typing correction. [Install hstack](/start/installation) first.

## 1. Create a small note

Paste this into a new test note:

```markdown
# Git reset

Three ways to move a branch.

## Soft

Keep staged changes.

## Mixed

Keep changes in the working directory.
```

## 2. Clean up spacing

On a new, empty line, type `/format` and press Enter. hstack adds spacing around
headings without rewriting the explanations. One Undo restores the previous note.

## 3. Add contents

At the top, type `/toc` on its own line and press Enter. You should get a linked
list of the note's headings. Run `/toc` again after changing headings to refresh it.

## 4. Try reversible input

Type `teh` followed by Space. With English autocorrect enabled, it becomes
`the `. Immediate Backspace restores `teh` and suppresses that spelling for
the rest of the session.

Type `:` to open the emoji picker, or `--` to try an immediate dash conversion.
Backspace restores a symbol shortcut immediately after conversion.

## Make it yours

Open hstack's settings to turn features on or off. Add technical names to
**Words to keep**. The current candidate enables the feature toggles by default.

Next: [Writing tools](/guides/writing), [custom templates](/guides/templates),
or [connect an agent](/guides/agent-setup).
