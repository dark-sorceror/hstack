---
title: "Text templates"
description: "Add your own slash command without executable code."
---

Add a template to **Custom slash templates** in hstack's settings. Valid JSON
saves immediately; invalid input shows an error and keeps the prior configuration.

```json
[
  {
    "name": "study",
    "description": "Start a short study session",
    "template": "## {{title}} — {{date}}\n\n### Questions\n- [ ] \n\n### Sources\n"
  }
]
```

Type `/study` on its own line to use it. Templates are restored when the plugin
loads and persist in the vault's plugin settings.

## Placeholders

| Placeholder     | Value                                                          |
| --------------- | -------------------------------------------------------------- |
| `{{title}}`     | Active note's basename                                         |
| `{{date}}`      | Local date as `YYYY-MM-DD`                                     |
| `{{time}}`      | Local time as `HH:mm`                                          |
| `{{selection}}` | Editor selection; normally empty for own-line slash invocation |

Expansion happens once. Inserted values are not interpreted as more placeholders
or code; unknown placeholders stay literal.

## Limits

- At most 50 templates.
- Lowercase names: 1–40 letters/hyphens, beginning with a letter.
- At most 16,000 characters of template text and 200 in a description.
- Built-in command names, aliases and registered names cannot be overwritten.

For callbacks that execute trusted code, use the [extension API](/reference/extensions)
instead of the JSON template field.
