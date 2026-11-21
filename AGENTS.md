# hstack source project

This repository contains plugin source, not a personal vault. Edit src/ and
rebuild; do not edit generated main.js. Keep notes, data.json, credentials and
local paths out of commits. Do not deploy into a personal vault without explicit
session authorization. Use a separate test vault for new development.

Read README.md and docs/architecture.md. Run npm run check for a release-worthy
change. npm run package produces the three release files. TypeScript checks the entry, per-method API contracts, selected checked-JS
boundaries and negative type tests; remaining JavaScript migration is incremental.
Run `npm run format` after changes. If Rust source changes, rebuild with the pinned
compiler and verify the bundled Wasm.
Preserve existing Markdown semantics and typing behavior when reorganizing code.

Public name/ID: hstack / hstack. Private legacy deployment uses the old ID,
notes-typing-helpers, only to preserve an existing installation and settings.
The CLI client supports both. No remote or public release is configured yet.
Use docs/releasing.md before publishing; release workflow drafts require review.


Workflow conventions: topic branches use type/slug; main is the primary branch.
Commit subjects use type(scope): summary, with no body. The sole root exception
is Initial Commit with only a title README.md, .gitattributes and .gitignore.
Use one scoped issue per PR and keep publication bodies free of conversational
history, personal paths and competitor comparisons. Do not invent issue numbers
or claim checks that have not run.

If context/index.md exists locally, read it for product decisions and handoff.
context/ and drafts/ are local-only workspace folders. Never force-add, commit,
publish or copy them into public documentation. Their exclusion belongs in
.git/info/exclude, not .gitignore. Local hooks are an additional guard, not a
reason to bypass this policy. Do not publish or deploy as part of documentation
or history-only work.
