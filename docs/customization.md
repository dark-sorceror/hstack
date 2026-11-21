# Customization

Settings independently control lists, spaces, typography, underline, emphasis
pairs, emoji, autocorrect, callout paste, slash commands and the agent bridge.
Words to keep is a whitespace-separated preservation list, matched without case.

## Text templates

Use the JSON array in **Custom slash templates**. Each entry has:

- `name`: unique lowercase letters/hyphens, 1–40 characters.
- `description`: optional menu text, at most 200 characters.
- `template`: literal Markdown, at most 16,000 characters.

At most 50 templates are accepted. Built-in names and aliases are reserved.
Use JSON `\n` for newlines. Expansion is one pass: content inserted by a
placeholder is never interpreted again. Unknown placeholders remain literal.
Dates and time use local `YYYY-MM-DD` and `HH:mm`. Title is the active note's
basename; selection is the editor selection (usually empty for own-line slash).

Example:

```json
[{"name":"question","description":"Capture an uncertainty","template":"> [!question] {{date}}\n> \n> Source: [[{{title}}]]\n"}]
```

These are stored per vault through Obsidian's settings API. No code from JSON,
notes or placeholders is evaluated. Invalid edits retain the last valid set.

## Trusted JavaScript extensions

Other plugins can use `plugin.api.registerSlashCommand`; see [API](api.md).
Names and aliases cannot override built-ins or another registered command.
Return/dispose registrations on unload (hstack also disposes public
registrations on its own unload). Script registrations are session-only;
text templates persist. Scripts should be maintained in a trusted plugin or
script runner, never automatically loaded from arbitrary note content.

## Styling

Feature styles ship in styles.css and target hstack-created classes or data
attributes. Global fonts, background colors and code palettes belong in your
own CSS snippet or theme. The personal Notes vault's theme is not bundled.
The public CSS currently retains the `notes-` prefix for migration compatibility;
do not rename it casually in integrations.
