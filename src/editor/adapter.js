"use strict";
const { EditorSelection } = require("@codemirror/state");

function applyEditorPlan(editor, plan, userEvent) {
  if (editor.cm) {
    editor.cm.dispatch({
      changes: plan.changes,
      selection: EditorSelection.cursor(plan.cursor),
      userEvent,
      filter: false,
      scrollIntoView: true,
    });
    return;
  }
  let result = editor.getValue();
  for (const change of [...plan.changes].sort((a, b) => b.from - a.from))
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  const before = result.slice(0, plan.cursor).split("\n");
  editor.transaction(
    {
      changes: plan.changes.map((change) => ({
        from: editor.offsetToPos(change.from),
        to: editor.offsetToPos(change.to),
        text: change.insert,
      })),
      selection: { from: { line: before.length - 1, ch: before.at(-1).length } },
    },
    userEvent
  );
}

function applyReplacement(plugin, view, plan, remember = true) {
  const { raw, ...change } = plan;
  const end = change.from + change.insert.length;
  plugin.replacements.delete(view);
  view.dispatch({
    changes: change,
    selection: EditorSelection.cursor(end),
    userEvent: "input.type",
    filter: false,
    scrollIntoView: true,
  });
  if (raw && remember)
    plugin.replacements.set(view, { from: change.from, to: end, text: change.insert, raw });
}

function inCode(view, position) {
  const node = view.domAtPos(position).node;
  const element = node.nodeType === 1 ? node : node.parentElement;
  return !!element?.closest(
    ".HyperMD-codeblock, .cm-inline-code, .HyperMD-frontmatter, .cm-math, .HyperMD-math, .cm-url, .cm-hmd-internal-link"
  );
}

// Keep Obsidian's private compatibility surfaces in one adapter.
function editorView(editor) {
  return editor?.cm;
}
function highlightedSuggestion(suggester) {
  const list = suggester.suggestions;
  return Array.isArray(list?.values) && Number.isInteger(list?.selectedItem)
    ? list.values[list.selectedItem]
    : null;
}
function prioritizeSuggesters(app, suggesters) {
  const installed = app.workspace.editorSuggest?.suggests;
  if (!Array.isArray(installed)) return;
  for (const suggester of suggesters) {
    const index = installed.indexOf(suggester);
    if (index > 0) installed.unshift(...installed.splice(index, 1));
  }
}
module.exports = {
  applyEditorPlan,
  applyReplacement,
  inCode,
  editorView,
  highlightedSuggestion,
  prioritizeSuggesters,
};
