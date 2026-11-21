---
title: "Preview and apply edits"
description: "Apply focused changes only to the revision you inspected."
---

A patch requires the revision returned by a read. It previews by default;
only `dryRun: false` writes. Keep the target explicit and the edit small.

## 1. Read the target

```sh
NOTES_VAULT=MyVault node bin/hstack.cjs readSection '{"path":"Git.md","heading":"Reset"}'
```

Use the returned `revision`, `from` and `sectionTo` to construct the edit.
Offsets refer to the full note, not to the excerpt alone.

## 2. Preview, then apply

This trusted-plugin example derives the range and revision rather than guessing:

```js
const read = await api.request({
  method: "readSection",
  params: { path: "Git.md", heading: "Reset" },
});
if (!read.ok) throw new Error(read.error.message);

const params = {
  path: read.result.path,
  expectedRevision: read.result.revision,
  edits: [
    {
      from: read.result.from,
      to: read.result.sectionTo,
      text: "## Reset\nReviewed replacement.\n",
    },
  ],
};
const preview = await api.request({ method: "patch", params });
// Inspect preview.result and get the workflow's approval before writing.
// Apply the same params with dryRun: false only after that review.
```

After reviewing a successful preview, send the same request with
`params: { ...params, dryRun: false }`. A preview is a bounded excerpt, not a full diff.

## Conflict behavior

- `REVISION_CONFLICT`: read the current revision and reconsider the edit.
- `DIVERGENT_EDITORS`: open source buffers disagree; reconcile them first.
- `SOURCE_CHANGED`: the closed file opened in an editor before writing; read again.

Open source notes use one synchronous editor transaction. Closed notes use
`Vault.process` with the revision checked inside its callback. Native/plugin
filters can transform an open-editor edit; `transformedByEditor` and the returned
revision describe the actual result.

## Limits

Provide 1–128 non-overlapping edits, with at most 2 MiB inserted text. Do not
split a Unicode surrogate pair. The CLI client has a smaller 48 KiB request cap.
After a timeout or lost acknowledgement, read before retrying the write.
