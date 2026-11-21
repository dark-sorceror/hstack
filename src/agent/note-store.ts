import type { TFile } from "obsidian";
import type { BridgeResults } from "../api.js";
import type { AgentHost, InputParameters, MarkdownViewPort, Note } from "./types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fail, notePath, revision, applyEdits } from "./contracts.js";
import { headingsFor } from "./metadata.js";
import { lexicalFor } from "../markdown/source.js";

function createNoteStore(plugin: AgentHost, isDisposed: () => boolean) {
  const app = plugin.app;
  // Desktop adapters may expose this method outside the public DataAdapter type.
  const adapter = app.vault.adapter as typeof app.vault.adapter & { getBasePath?: () => string };
  const base = adapter?.getBasePath?.();
  const baseReal = base ? fs.realpathSync(base) : null;
  function fileFor(value: unknown): TFile {
    const name = notePath(value),
      file = app.vault.getAbstractFileByPath(name) as TFile | null;
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
  function editorsFor(name: string) {
    return app.workspace
      .getLeavesOfType("markdown")
      .filter(
        (leaf) =>
          (leaf.view as MarkdownViewPort).file?.path === name &&
          (!(leaf.view as MarkdownViewPort).getMode ||
            (leaf.view as MarkdownViewPort).getMode!() === "source") &&
          (leaf.view as MarkdownViewPort).editor
      )
      .map((leaf) => (leaf.view as MarkdownViewPort).editor!);
  }
  function primaryEditor(name: string) {
    const all = editorsFor(name),
      active =
        app.workspace.activeEditor?.editor ||
        (app.workspace.activeLeaf?.view as MarkdownViewPort | undefined)?.editor;
    return active && all.includes(active) ? active : all[0];
  }
  function activePath() {
    const file =
      app.workspace.activeEditor?.file ||
      (app.workspace.activeLeaf?.view as MarkdownViewPort | undefined)?.file;
    if (!file?.path?.endsWith(".md")) fail("NO_ACTIVE_NOTE", "Open a Markdown note first.");
    return file.path;
  }
  async function readNote(name: unknown): Promise<Note> {
    const file = fileFor(name),
      // Revisions/offsets follow Obsidian-decoded text, which may omit a leading BOM.
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
      cursorOffset: cursor ? editor!.posToOffset(cursor) : 0,
    };
  }
  async function patch(params: InputParameters): Promise<BridgeResults["patch"]> {
    const file = fileFor(params.path);
    if (["AGENTS.md", "CLAUDE.md"].includes(file.name || path.posix.basename(file.path)))
      fail("INVALID_PATH", "Agent instruction files are outside the note-editing API.");
    if (!/^sha256:[a-f0-9]{64}$/.test((params.expectedRevision || "") as string))
      fail("REVISION_REQUIRED", "patch requires the revision returned by a read.");
    if (params.dryRun != null && typeof params.dryRun !== "boolean")
      fail("INVALID_PARAMS", "dryRun must be a boolean.");
    const dryRun = params.dryRun !== false;
    let outcome!: Omit<BridgeResults["patch"], "source"> & { source?: "editor" | "vault" };
    const prepare = (current: string) => {
      if (isDisposed()) fail("BRIDGE_UNLOADED", "The notes bridge has been unloaded.");
      const actual = revision(current);
      if (actual !== params.expectedRevision)
        fail("REVISION_CONFLICT", "The note changed. Read its current revision before patching.", {
          path: file.path,
          currentRevision: actual,
        });
      const edit = applyEdits(current, params.edits);
      const first = edit.edits[0]!,
        last = edit.edits.at(-1)!;
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
      const editor = primaryEditor(file.path)!,
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
    // Each branch assigns the source after prepare has established the outcome.
    return outcome as BridgeResults["patch"];
  }
  return { fileFor, readNote, activePath, patch };
}
export { createNoteStore };
