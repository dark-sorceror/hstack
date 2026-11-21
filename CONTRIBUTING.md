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
