"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { fail, notePath, revision, applyEdits } = require("./contracts.js");
const { headingsFor } = require("./metadata.js");
const { lexicalFor } = require("../markdown/source.js");

function createNoteStore(plugin, isDisposed) {
  const app = plugin.app;
  const base = app.vault.adapter?.getBasePath?.();
  const baseReal = base ? fs.realpathSync(base) : null;
  function fileFor(value) {
    const name = notePath(value),
      file = app.vault.getAbstractFileByPath(name);
    if (!file || file.extension !== "md") fail("NOTE_NOT_FOUND", "Markdown note not found.");
    if (baseReal) {
      const target = fs.realpathSync(path.join(baseReal, file.path));
      if (
        !target.startsWith(baseReal + path.sep) ||
        path
          .relative(baseReal, target)
          .split(path.sep)
          .some((part) => part.startsWith("."))
      )
        fail("INVALID_PATH", "Note resolves outside the visible vault notes.");
    }
    return file;
  }
  function editorsFor(name) {
    return app.workspace
      .getLeavesOfType("markdown")
      .filter(
        (leaf) =>
          leaf.view.file?.path === name &&
          (!leaf.view.getMode || leaf.view.getMode() === "source") &&
          leaf.view.editor
      )
      .map((leaf) => leaf.view.editor);
  }
  function primaryEditor(name) {
    const all = editorsFor(name),
      active = app.workspace.activeEditor?.editor || app.workspace.activeLeaf?.view?.editor;
    return all.includes(active) ? active : all[0];
  }
  function activePath() {
    const file = app.workspace.activeEditor?.file || app.workspace.activeLeaf?.view?.file;
    if (!file?.path?.endsWith(".md")) fail("NO_ACTIVE_NOTE", "Open a Markdown note first.");
    return file.path;
  }
  async function readNote(name) {
    const file = fileFor(name),
      saved = await app.vault.read(file),
      editor = primaryEditor(file.path);
    const content = editor ? editor.getValue() : saved;
    const selections = editor
      ? editor.listSelections().map((selection) => ({
          anchor: selection.anchor,
          head: selection.head,
          from: Math.min(editor.posToOffset(selection.anchor), editor.posToOffset(selection.head)),
          to: Math.max(editor.posToOffset(selection.anchor), editor.posToOffset(selection.head)),
        }))
      : [];
    const cursor = editor ? editor.getCursor() : null;
    return {
      path: file.path,
      title: file.basename || path.posix.basename(file.path, ".md"),
      folder: path.posix.dirname(file.path) === "." ? "" : path.posix.dirname(file.path),
      content,
      revision: revision(content),
      source: editor ? "editor" : "vault",
      dirty: content !== saved,
      modified: file.stat?.mtime || 0,
      lexical: lexicalFor(content),
      headings: headingsFor(plugin.outline, content),
      selections,
      cursor,
      cursorOffset: cursor ? editor.posToOffset(cursor) : 0,
    };
  }
  async function patch(params) {
    const file = fileFor(params.path);
    if (["AGENTS.md", "CLAUDE.md"].includes(file.name || path.posix.basename(file.path)))
      fail("INVALID_PATH", "Agent instruction files are outside the note-editing API.");
    if (!/^sha256:[a-f0-9]{64}$/.test(params.expectedRevision || ""))
      fail("REVISION_REQUIRED", "patch requires the revision returned by a read.");
    if (params.dryRun != null && typeof params.dryRun !== "boolean")
      fail("INVALID_PARAMS", "dryRun must be a boolean.");
    const dryRun = params.dryRun !== false;
    let outcome;
    const prepare = (current) => {
      if (isDisposed()) fail("BRIDGE_UNLOADED", "The notes bridge has been unloaded.");
      const actual = revision(current);
      if (actual !== params.expectedRevision)
        fail("REVISION_CONFLICT", "The note changed. Read its current revision before patching.", {
          path: file.path,
          currentRevision: actual,
        });
      const edit = applyEdits(current, params.edits);
      const first = edit.edits[0],
        last = edit.edits.at(-1);
      outcome = {
        path: file.path,
        previousRevision: actual,
        revision: revision(edit.text),
        dryRun,
        changed: edit.text !== current,
        edits: edit.edits.map((e) => ({ from: e.from, to: e.to, insertedChars: e.text.length })),
        preview: {
          before: current.slice(first.from, Math.min(last.to, first.from + 3000)),
          after: edit.text.slice(first.from, Math.min(edit.text.length, first.from + 3000)),
        },
      };
      return edit;
    };
    const editors = editorsFor(file.path);
    if (editors.length) {
      const editor = primaryEditor(file.path),
        current = editor.getValue();
      if (editors.some((e) => e.getValue() !== current))
        fail(
          "DIVERGENT_EDITORS",
          "Open editors have different buffers; choose a consistent revision first."
        );
      const edit = prepare(current); // No await between reading, checking, and editing.
      if (!dryRun && outcome.changed) {
        editor.transaction(
          {
            changes: edit.edits.map((e) => ({
              from: editor.offsetToPos(e.from),
              to: editor.offsetToPos(e.to),
              text: e.text,
            })),
          },
          "input.notes-agent"
        );
        const actual = editor.getValue();
        outcome.transformedByEditor = actual !== edit.text;
        outcome.revision = revision(actual);
      }
      outcome.source = "editor";
    } else if (dryRun) {
      prepare(await app.vault.read(file));
      outcome.source = "vault";
    } else {
      await app.vault.process(file, (current) => {
        if (editorsFor(file.path).length)
          fail("SOURCE_CHANGED", "The note opened in an editor. Read it again before patching.");
        return prepare(current).text;
      });
      outcome.source = "vault";
    }
    return outcome;
  }
  return { fileFor, readNote, activePath, patch };
}
module.exports = { createNoteStore };
