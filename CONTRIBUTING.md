# Contributing

Use a separate test vault and Node 22.13+. Start with `npm ci` and `npm run check`.
Read docs/architecture.md and docs/security.md before editor or bridge changes.

Keep algorithms small, deterministic and independent of host UI where possible.
Add focused preservation/regression checks for changed behavior, rather than
mirroring implementation. Protect code, custom list semantics and uncertainty
in notes. Test pasted rich content, nested lists and one-step Undo when relevant.
Use synthetic examples; never commit real vault notes or settings.

Edit src/, not generated main.js or an installed copy. New public interfaces use
strict TypeScript; migrate JS modules incrementally when you can verify parity.
Keep Obsidian/CodeMirror external in the build. Avoid new runtime dependencies,
network services or broad file writes unless the feature explicitly needs them.

Before release, review data licenses and runtime disclosures. Explain the
concrete behavior change and meaningful validation in PRs. Follow the existing
syntax/style in a module. Run npm run package to verify the actual release shape.

## Branches and commits

Use feat/slug, fix/slug, refactor/slug, style/slug, chore/slug, perf/slug,
docs/slug, test/slug, build/slug or ci/slug. main is the primary branch.
Every change starts from a scoped issue and is reviewed in a corresponding PR.

Commit subjects must be type(scope): concise summary with no description/body.
The root commit is the sole exception: Initial Commit, containing only the title
README.md, .gitattributes and .gitignore. Use the issue/PR templates, avoid unrelated
scope, and distinguish completed checks from checks still to run.

Prefer TypeScript for new runtime modules. Port remaining JavaScript through a
separate behavior-preserving change with strict checking and parity coverage;
do not use mass any or ts-nocheck annotations to simulate a completed migration.
Build tooling may remain Node .mjs and tests may remain .cjs.
