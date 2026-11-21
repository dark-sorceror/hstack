# hstack source project

This repository contains plugin source, not a personal vault. Edit src/ and
rebuild; do not edit generated main.js. Keep notes, data.json, credentials and
local paths out of commits. Do not deploy into a personal vault without explicit
session authorization. Use a separate test vault for new development.

Read README.md and docs/architecture.md. Run npm run check for a release-worthy
change. npm run package produces the three release files. TypeScript checks only
the TS entry/API plus inferred JS boundaries, not a full checked-JS migration.
Preserve existing Markdown semantics and typing behavior when reorganizing code.

Public name/ID: hstack / hstack. Private legacy deployment uses the old ID,
notes-typing-helpers, only to preserve an existing installation and settings.
The CLI client supports both. No remote or public release is configured yet.
Use docs/releasing.md before publishing; release workflow drafts require review.
