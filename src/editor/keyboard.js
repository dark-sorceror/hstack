"use strict";
const { editorView } = require("./adapter.js");
const { EditorSelection } = require("@codemirror/state");

function handleKey(plugin, event, view) {
  if (
    view.state.readOnly ||
    event.isComposing ||
    view.composing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return false;
  let selection = view.state.selection.main;
  const singleCaret = view.state.selection.ranges.length === 1 && selection.empty;
  if (
    plugin.slashSuggest.context &&
    ["Enter", "Tab", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)
  ) {
    if (event.key === "Tab" && !event.shiftKey) {
      const editor = plugin.slashSuggest.context.editor;
      if (editorView(editor) === view && plugin.slashSuggest.completeSuggestion(editor)) {
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
    } else return false;
  }
  if (
    plugin.emojiSuggest.context &&
    ["Enter", "Tab", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)
  )
    return false;
  if (event.key === "Enter" && !event.shiftKey && singleCaret && plugin.options.formatPairs) {
    const plan = plugin.markup.enterPairPlan?.(
      view.state.doc.toString(),
      selection.from,
      selection.to
    );
    if (plan) {
      plugin.replacements.delete(view);
      view.dispatch({
        changes: plan.changes,
        selection: EditorSelection.cursor(plan.cursor),
        userEvent: "input.type",
        filter: false,
        scrollIntoView: true,
      });
      // Let the usual Enter command handle newlines and indentation using the
      // cleaned-up text; empty child lists still pass through our list rules.
      selection = view.state.selection.main;
    }
  }
  if (event.key === "Backspace" && singleCaret) {
    const replacement = plugin.replacements.get(view);
    const change = plugin.logic.revertPlan(view.state.doc.toString(), selection.head, replacement);
    if (change) {
      if (replacement.kind === "autocorrect") plugin.autocorrect?.reject(replacement.word);
      plugin.replacements.delete(view);
      view.dispatch({
        changes: change,
        selection: EditorSelection.cursor(change.from + change.insert.length),
        userEvent: "input.notes-revert",
        filter: false,
        scrollIntoView: true,
      });
      event.preventDefault();
      return true;
    }
  }
  if (event.key === " ") {
    plugin.replacements.delete(view);
    if (
      plugin.options.autocorrect &&
      singleCaret &&
      plugin.typedWords.get(view) === selection.head &&
      !plugin.inCode(view, selection.head)
    ) {
      const plan = plugin.autocorrectModule.boundaryPlan(
        view.state.doc.toString(),
        selection.head,
        plugin.autocorrect
      );
      if (plan) {
        const { original, ...replacement } = plan;
        plugin.applyReplacement(view, replacement);
        Object.assign(plugin.replacements.get(view), { kind: "autocorrect", word: original });
        event.preventDefault();
        return true;
      }
    }
    if (!plugin.options.literalSpaces) return false;
    // Bypass automatic transaction formatters for a literal Space key.
    view.dispatch({
      ...view.state.replaceSelection(" "),
      userEvent: "input.type",
      filter: false,
      scrollIntoView: true,
    });
    event.preventDefault();
    return true;
  }
  if (
    plugin.options.formatPairs &&
    view.state.selection.ranges.length === 1 &&
    ["*", "_"].includes(event.key) &&
    !plugin.inCode(view, selection.from)
  ) {
    const plan = plugin.markup.pairPlan(
      view.state.doc.toString(),
      selection.from,
      selection.to,
      event.key
    );
    if (plan) {
      plugin.replacements.delete(view);
      view.dispatch({
        changes: plan.changes,
        selection: plan.selection
          ? EditorSelection.range(plan.selection.anchor, plan.selection.head)
          : EditorSelection.cursor(plan.cursor),
        userEvent: "input.notes-pair",
        filter: false,
        scrollIntoView: true,
      });
      event.preventDefault();
      return true;
    }
  }
  // Closing a native auto-paired [] can be a key command rather than input.
  if (
    event.key === "]" &&
    plugin.options.listShortcuts &&
    singleCaret &&
    !plugin.inCode(view, selection.head)
  ) {
    const plan = plugin.logic.prefixPlan(
      view.state.doc.toString(),
      selection.from,
      selection.to,
      "]"
    );
    if (plan) {
      plugin.applyReplacement(view, plan, false);
      event.preventDefault();
      return true;
    }
  }
  if (!["-", ">", "Shift"].includes(event.key)) plugin.replacements.delete(view);
  if (!plugin.options.mixedLists || view.state.selection.ranges.length !== 1) return false;
  if (!selection.empty || plugin.inCode(view, selection.head)) return false;
  let action;
  if (event.key === "Tab") action = event.shiftKey ? "outdent" : "indent";
  else if (!event.shiftKey && (event.key === "Enter" || event.key === "Backspace")) action = "exit";
  else return false;
  const line = view.state.doc.lineAt(selection.head);
  const plan = plugin.logic.listPlan(
    view.state.doc.toString(),
    line.number - 1,
    selection.head - line.from,
    action,
    {
      tabSize: plugin.app.vault.getConfig("tabSize") || 4,
      useTabs: plugin.app.vault.getConfig("useTab") !== false,
    }
  );
  if (!plan) return false;
  view.dispatch({
    changes: plan.changes,
    selection: EditorSelection.cursor(plan.cursor),
    userEvent: "input.notes-list",
    scrollIntoView: true,
  });
  event.preventDefault();
  return true;
}

module.exports = { handleKey };
