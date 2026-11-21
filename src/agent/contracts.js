"use strict";
const crypto = require("node:crypto");

const LIMITS = Object.freeze({
  snapshotBytes: 32 * 1024 * 1024,
  resultChars: 16000,
  queryRows: 200,
  edits: 128,
  editChars: 2 * 1024 * 1024,
  sqlMs: 1000,
  sqlOutputBytes: 512 * 1024,
  responseBytes: 512 * 1024,
});
function fail(code, message, details) {
  const error = new Error(message);
  Object.assign(error, { code, details });
  throw error;
}
function revision(text) {
  return "sha256:" + crypto.createHash("sha256").update(text).digest("hex");
}
function notePath(value) {
  if (
    typeof value !== "string" ||
    !value.endsWith(".md") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((part) => !part || part === ".." || part.startsWith("."))
  )
    fail(
      "INVALID_PATH",
      "Use an explicit vault-relative Markdown path without hidden or parent directories."
    );
  return value;
}
function bounded(value, fallback, maximum, name) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    fail("INVALID_PARAMS", `${name} must be between 1 and ${maximum}.`);
  return value;
}
function applyEdits(text, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > LIMITS.edits)
    fail("INVALID_EDITS", "Provide 1–128 edits.");
  let inserted = 0;
  const ordered = edits
    .map((edit) => {
      if (
        !edit ||
        !Number.isSafeInteger(edit.from) ||
        !Number.isSafeInteger(edit.to) ||
        edit.from < 0 ||
        edit.to < edit.from ||
        edit.to > text.length ||
        typeof edit.text !== "string"
      )
        fail("INVALID_EDITS", "Each edit needs valid UTF-16 from/to offsets and text.");
      for (const offset of [edit.from, edit.to])
        if (
          offset &&
          offset < text.length &&
          /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
          /[\uDC00-\uDFFF]/.test(text[offset])
        )
          fail("INVALID_EDITS", "An edit cannot split a Unicode surrogate pair.");
      inserted += edit.text.length;
      return { from: edit.from, to: edit.to, text: edit.text };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);
  if (inserted > LIMITS.editChars) fail("INVALID_EDITS", "Inserted text exceeds 2 MiB.");
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1],
      current = ordered[index];
    if (current.from < previous.to || current.from === previous.from)
      fail("INVALID_EDITS", "Edits must not overlap or insert twice at one offset.");
  }
  let result = text;
  for (const edit of [...ordered].reverse())
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
  return { text: result, edits: ordered };
}

module.exports = { LIMITS, fail, revision, notePath, bounded, applyEdits };
