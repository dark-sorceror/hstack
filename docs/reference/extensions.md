---
title: "Plugin extensions"
description: "Use the versioned facade and register disposable slash commands."
---

Trusted plugins and scripts can use `plugin.api` without going through the CLI.
Check that the plugin is present and API version 1 is available.

```js
const plugin = app.plugins.plugins["hstack"];
const api = plugin?.api;
if (!api || api.version !== 1) throw new Error("hstack API v1 is unavailable");
```

Plugin enumeration is a host-specific integration surface. Do not retain an
instance after unload. TypeScript consumers can import the `HstackAPI` type
from this repository's `src/api.ts`.

| Method                          | Result                                             |
| ------------------------------- | -------------------------------------------------- |
| `request(request)`              | A Promise of the [bridge reply](/reference/bridge) |
| `formatMarkdown(text)`          | A pure string transform; does not edit a note      |
| `registerSlashCommand(command)` | An idempotent dispose function                     |

## Register a command

```js
const dispose = api.registerSlashCommand({
  id: "stamp",
  name: "stamp",
  aliases: ["timestamp"],
  description: "Insert the current timestamp",
  run({ editor, from, to }) {
    editor.transaction({
      changes: [
        {
          from: editor.offsetToPos(from),
          to: editor.offsetToPos(to),
          text: new Date().toISOString(),
        },
      ],
    });
  },
});
this.register(dispose); // In the caller's Obsidian Plugin subclass.
```

IDs must equal names: lowercase letters/hyphens, 1–40 characters, starting with
a letter. Aliases follow the same rule and must be unique. Descriptions are at
most 200 characters. Built-in names and aliases cannot be overwritten.

`run` receives `{app, editor, from, to, title}`. Offsets cover the invoking slash
text; the callback owns replacement. For asynchronous work, re-read and check
the revision before editing rather than keeping stale offsets. Throw or reject
to report failure visibly.

Callbacks execute trusted code with plugin privileges. For non-executable
insertion commands, use [text templates](/guides/templates).
