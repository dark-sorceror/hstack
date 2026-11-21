---
title: "Release a version"
description: "Tag the verified source, review the assets, then submit or update the listing."
---

A merged PR is not a Community Plugins listing. Release the verified source to
GitHub, inspect the installable assets, then complete directory review.

## Before tagging

- Confirm the intended code is on the default branch and CI passes.
- Complete the Obsidian-specific lint audit and native compatibility checks.
- Review the manifest, license, data notices, README disclosures and support contact.
- Keep the already-prepared `1.0.0` for the first unpublished release; do not
  increment it just to trigger packaging.
- Prepare notes for that version. The draft workflow currently reads the whole
  CHANGELOG.md, so remove candidate-only “Unreleased/no release” text or supply
  a version-specific notes file before publishing.

## Verify the package

```sh
npm ci --ignore-scripts
npm run check
npm run package
```

From dist/1.0.0, test **main.js**, **manifest.json** and **styles.css** in a fresh
vault. SHA256SUMS is an additional verification file. Do not attach source-only
assets or user settings as install files.

## Tag the approved commit

The tag must match manifest.version exactly: `1.0.0`, without a `v` prefix.
Only from the verified release commit:

```sh
git tag -a 1.0.0 -m "hstack 1.0.0"
git push origin refs/tags/1.0.0
```

The tag push runs the draft-release workflow. It checks the version, rebuilds
the pinned Wasm, runs checks/packages, and attaches the three plugin files plus
checksums to a **draft**. Review its body, SHA, downloaded assets and installation
before publishing. A GitHub source ZIP is not the plugin package.

Use either this workflow or a deliberate manual release, not two creators for
the same tag. Inspect partial results before retrying a failed job.

## Submit the first version

Follow the [current submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin):
sign in to community.obsidian.md, connect GitHub, add the repository and address
review results. The default-branch manifest and matching published release must
agree. Do not assume the older community-plugins.json PR flow still applies.

Verify installation through the directory before announcing availability.
Publishing docs or a GitHub release alone does not approve the listing.

## Subsequent versions

Use `npm version patch --no-git-tag-version` (or minor/major), review all changed
version files, and commit them under the project convention before tagging.
The version hook updates manifest.json and versions.json. The package smoke
test expects their current entries to agree.

Publish a new version for a correction after release; do not move an existing
release tag or replace its assets. Check the [versions mapping](https://docs.obsidian.md/Reference/Versions)
when changing minAppVersion. Keep the plugin ID stable after public installs.
