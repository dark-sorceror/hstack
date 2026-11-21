"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EditorState, EditorSelection } = require("@codemirror/state");
const { history, undo } = require("@codemirror/commands");
const { handleKey } = require("../src/editor/keyboard.js");
const adapter = require("../src/editor/adapter.js");
const { normalizeSettings } = require("../src/settings.js");

function fixture(text, cursor = text.length) {
  const plugin = {
    options: normalizeSettings({}),
    replacements: new WeakMap(),
    typedWords: new WeakMap(),
    logic: require("../src/features/logic.js"),
    markup: require("../src/features/markup.js"),
    autocorrectModule: require("../src/autocorrect/autocorrect.js"),
    emojiSuggest: {},
    slashSuggest: {},
    inCode: () => false,
    app: { vault: { getConfig: (key) => (key === "useTab" ? false : 4) } },
    applyReplacement(view, plan, remember) {
      return adapter.applyReplacement(plugin, view, plan, remember);
    },
  };
  const view = {
    composing: false,
    state: EditorState.create({
      doc: text,
      selection: Array.isArray(cursor)
        ? EditorSelection.create(cursor.map((at) => EditorSelection.cursor(at)))
        : EditorSelection.cursor(cursor),
      extensions: [history(), EditorState.allowMultipleSelections.of(true)],
    }),
    dispatch(spec) {
      view.state = view.state.update(spec).state;
    },
  };
  const key = (value, extra = {}) =>
    handleKey(plugin, { key: value, preventDefault() {}, stopPropagation() {}, ...extra }, view);
  return { plugin, view, key, text: () => view.state.doc.toString() };
}

test("held spaces remain literal in prose and code without invoking native indentation", () => {
  for (const code of [false, true]) {
    const f = fixture("");
    f.plugin.inCode = () => code;
    for (let repeat = 0; repeat < 50; repeat++) assert.equal(f.key(" ", { repeat: true }), true);
    assert.equal(f.text(), " ".repeat(50));
  }
});

test("numbered children become bullets, then resume numbering with a reversible editor transaction", () => {
  const f = fixture("1. parent\n2. child");
  assert.equal(f.key("Tab"), true);
  assert.equal(f.text(), "1. parent\n    * child");
  assert.equal(undo({ state: f.view.state, dispatch: (spec) => f.view.dispatch(spec) }), true);
  assert.equal(f.text(), "1. parent\n2. child");
  f.key("Tab");
  f.key("Tab", { shiftKey: true });
  assert.equal(f.text(), "1. parent\n2. child");
  const empty = fixture("1. parent\n    * ");
  assert.equal(empty.key("Enter"), true);
  assert.equal(empty.text(), "1. parent\n2. ");
});

test("pair cleanup runs before native Enter and before empty-child list continuation", () => {
  const f = fixture("****", 2);
  assert.equal(f.key("Enter"), false); // Native Enter owns newline insertion.
  f.view.dispatch({ ...f.view.state.replaceSelection("\n"), userEvent: "input.type" });
  assert.equal(f.text(), "\n");
  const nested = fixture("1. parent\n    * ****", "1. parent\n    * **".length);
  assert.equal(nested.key("Enter"), true);
  assert.equal(nested.text(), "1. parent\n2. ");
});

test("slash and emoji menus retain priority over pairing and list shortcuts", () => {
  const f = fixture("**", 1);
  f.plugin.emojiSuggest.context = {};
  assert.equal(f.key("Enter"), false);
  assert.equal(f.text(), "**");
  f.plugin.emojiSuggest.context = null;
  let completed = false;
  f.plugin.slashSuggest = {
    context: { editor: { cm: f.view } },
    completeSuggestion: () => {
      completed = true;
      return true;
    },
  };
  assert.equal(f.key("Tab"), true);
  assert.equal(completed, true);
});

test("Space autocorrect and immediate Backspace preserve raw text and rejection semantics", () => {
  const f = fixture("teh");
  const rejected = [];
  f.plugin.autocorrect = {
    correctWord: (word) => (word === "teh" ? "the" : null),
    reject: (word) => rejected.push(word),
  };
  f.plugin.typedWords.set(f.view, 3);
  assert.equal(f.key(" "), true);
  assert.equal(f.text(), "the ");
  assert.equal(f.key("Backspace"), true);
  assert.equal(f.text(), "teh");
  assert.deepEqual(rejected, ["teh"]);
});

test("emphasis pairing leaves multiple carets and selections to native editing", () => {
  for (const marker of ["_", "*"]) {
    const f = fixture(`${marker.repeat(2)}\n${marker.repeat(2)}`, [1, 4]);
    const original = f.view.state;
    assert.equal(f.key(marker), false);
    assert.equal(f.view.state, original);
    f.view.dispatch(f.view.state.replaceSelection(marker));
    assert.equal(f.text(), `${marker.repeat(3)}\n${marker.repeat(3)}`);
    assert.equal(f.view.state.selection.ranges.length, 2);
    f.view.dispatch({
      selection: EditorSelection.create([EditorSelection.range(0, 2), EditorSelection.range(4, 6)]),
    });
    const selected = f.view.state;
    assert.equal(f.key(marker), false);
    assert.equal(f.view.state, selected);
  }
});
