---
title: "Work on the docs"
description: "Edit one canonical set of pages and validate it locally."
---

The README is the repository introduction. `docs/` contains the user guides,
bridge reference and contributor documentation; docs.json is the Mintlify
navigation. There is no separate generated copy to keep in sync.

## Preview

From the repository root, run the local structure check:

```sh
npm run docs:check
```

From `docs/`, use the pinned documentation CLI:

```sh
npx --yes mint@4.2.1210 dev --no-open --telemetry=false
```

The local preview does not publish a site or connect a repository. Mintlify's
preview client may download tooling and caches outside this checkout. The
documentation CLI is separate from the plugin's build dependencies.

## Validate before review

```sh
npx --yes mint@4.2.1210 validate --telemetry=false
npx --yes mint@4.2.1210 broken-links --telemetry=false
```

`docs:check` catches missing navigation pages, orphan pages and broken local
file links. Mintlify also checks MDX/configuration and performs a strict build.
Run the real renderer; a JSON-only config check is not a visual preview.

The Documentation workflow runs these checks when documentation changes in a
pull request or on main. It validates content without publishing a site.

## Write for a task

- Lead with what the reader will accomplish.
- Put prerequisites before commands, then show the expected result.
- Keep user setup separate from contributor internals.
- Put method details and limits in reference pages, not the front page.
- Use short sections, concrete examples and tables for comparable fields.
- Describe only shipped behavior. Label candidates and compatibility limits.

Most pages use plain Markdown; the overview uses MDX cards. Use extensionless site paths for links between documentation pages. A `.md`
URL serves raw Markdown in Mintlify; README links use source-file paths for GitHub. When adding a page,
add its extensionless path to docs.json and verify navigation.

## Hosting

Hosting is not configured by these files. A maintainer must choose a Mintlify
project, connect the repository with `docs/` as its content directory, and review
deployment access before publishing. Until then, README links point to source
pages. The plugin itself has no dependency on the documentation host.
