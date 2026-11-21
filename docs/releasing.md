# Release checklist

This is a prepared local project, not an accepted Community Plugin listing.

1. Review name, MIT license, author, description, public API and disclosures.
   The ID should stay stable after public installs. Recheck directory collisions.
2. Test in a separate vault on supported Obsidian/installer/platform versions.
   Current manifest conservatively requires 1.14.4, the tested app version.
   SQL additionally needs external Node 22.13+. Windows/Linux native UI testing
   and review of host-internal APIs remain necessary before wider support claims.
3. Run `npm ci`, `npm run check`, `npm run package`. Rebuild Wasm if Rust changed.
   Review `docs/architecture.md` host-internal API risks and official guidance.
4. Create a public GitHub repository for this source (manual owner choice).
   No private notes, data.json, tokens, generated main.js, node_modules or local
   vault paths should be committed. Set up Issues/security advisory contact.
5. Version with `npm version patch` (or minor/major), review the resulting
   manifest/versions/package-lock changes, then push an exact x.y.z tag without
   a leading v. The release workflow rejects mismatched tags.
6. The workflow builds/tests and attaches main.js, manifest.json and styles.css
   to a **draft** GitHub release. Inspect assets/checksums, then publish manually.
   Initial manual release can use `dist/<version>/` from `npm run package`.
7. Follow the current [official submission flow](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin): sign in to community.obsidian.md, link
   the repository owner's GitHub account, add/claim the plugin, address automated
   review and increment releases when changes are required. Check the live guide
   at submission time; do not assume an older community-plugins.json PR flow.
8. Announce only after review and installation work. Maintain CHANGELOG and
   compatibility versions, especially editor internals and SQLite prerequisites.

The source uses incremental TS/JS migration. The typed entry/API pass tsc; this
does not imply the legacy JS passed a full Obsidian-specific lint audit. Such
review may require changes before acceptance. The three-file smoke test validates
asset packaging and runtime loading using a mock host; native UI testing remains
part of each release. Nothing in this repo automatically publishes a release.
