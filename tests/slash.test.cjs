"use strict";
const assert = require("node:assert/strict");
const { commands, search, triggerAt, createSlashSuggest } = require("../src/features/slash.js");
const logic = require("../src/features/logic.js");
let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log("✓ " + name);
}
class FakeSuggest {
  constructor(app) {
    this.app = app;
  }
  close() {
    this.closed = true;
  }
}
function setup(initial, extra = {}) {
  let text = initial;
  const calls = [],
    recorded = [];
  const plugin = {
    options: { slash: true, slashUsage: {} },
    logic,
    inCode: () => false,
    runSlashCommand: (...args) => calls.push(args),
    recordSlash: (id) => recorded.push(id),
    ...extra,
  };
  const editor = {
    getValue: () => text,
    getLine: (n) => text.split("\n")[n],
    posToOffset: (p) =>
      text
        .split("\n")
        .slice(0, p.line)
        .reduce((sum, line) => sum + line.length + 1, 0) + p.ch,
    replaceRange: (insert, start, end) => {
      const a = editor.posToOffset(start),
        b = editor.posToOffset(end);
      text = text.slice(0, a) + insert + text.slice(b);
    },
    setCursor: (p) => {
      editor.cursor = p;
    },
  };
  const suggest = createSlashSuggest({}, plugin, FakeSuggest);
  function trigger(line = text.split("\n").length - 1, ch = text.split("\n")[line].length) {
    const result = suggest.onTrigger({ line, ch }, editor);
    if (result) suggest.context = { ...result, editor };
    return result;
  }
  return { plugin, editor, suggest, trigger, calls, recorded, text: () => text };
}

test("bare slash opens immediately with toc, format, then help", () => {
  const s = setup("/");
  assert.equal(s.trigger().query, "");
  assert.deepEqual(
    s.suggest.getSuggestions(s.suggest.context).map((x) => x.id),
    ["toc", "format", "help"]
  );
});
test("usage is live and unknown or invalid counts do not pollute results", () => {
  const s = setup("/");
  s.trigger();
  s.plugin.options.slashUsage = { help: 3, random: 99, toc: Infinity };
  assert.deepEqual(
    s.suggest.getSuggestions(s.suggest.context).map((x) => x.id),
    ["help", "toc", "format"]
  );
  assert.equal(new Set(search("").map((x) => x.id)).size, commands.length);
});
test("canonical names and outline alias filter incrementally", () => {
  assert.equal(search("o")[0].id, "toc");
  assert.equal(search("outline")[0].name, "toc");
  assert.equal(search("/he")[0].id, "help");
  assert.equal(search("format")[0].id, "format");
  assert.equal(search("ti")[0].id, "format");
  assert.equal(search("tidy")[0].name, "format");
  assert.deepEqual(search("unknown"), []);
});
test("line-only matching excludes prose, paths, URLs, digits and trailing content", () => {
  assert.deepEqual(triggerAt("  /out", 6), { column: 2, query: "out" });
  for (const text of [
    "text /toc",
    "/tmp",
    "/toc/path",
    "https://a/toc",
    "/0",
    "//",
    "/toc other",
    " /toc.md",
    "/help; rm",
  ])
    assert.equal(triggerAt(text, text.length), null, text);
  assert.equal(triggerAt("/toc text", 4), null);
});
test("protected prose contexts and native code tokens do not open", () => {
  for (const text of ["```python\n/toc", "---\n/toc", "$$\n/toc", "<!--\n/toc"]) {
    const s = setup(text);
    assert.equal(s.trigger(), null, text);
  }
  const s = setup("/toc", { inCode: () => true });
  s.editor.cm = {};
  assert.equal(s.trigger(), null);
});
test("disabled toggle applies while opening and while already open", () => {
  const s = setup("/toc");
  s.trigger();
  s.plugin.options.slash = false;
  assert.equal(s.trigger(), null);
  assert.equal(s.suggest.completeSuggestion(), false);
  s.suggest.selectSuggestion(commands[0]);
  assert.equal(s.calls.length, 0);
});
test("Tab completes alias to canonical command without running or recording", () => {
  const s = setup("  /out");
  s.trigger();
  assert.equal(s.suggest.completeSuggestion(s.editor), true);
  assert.equal(s.text(), "  /toc");
  assert.deepEqual(s.editor.cursor, { line: 0, ch: 6 });
  assert.equal(s.suggest.context.query, "toc");
  assert.equal(s.suggest.closed, undefined);
  assert.equal(s.calls.length, 0);
  assert.equal(s.recorded.length, 0);
  s.suggest.selectSuggestion(commands[0]);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0][0], "toc");
  assert.equal(s.calls[0][1].query, "toc");
  assert.equal(s.calls[0][2], s.editor);
});
test("Tab honors keyboard highlight before most-used fallback", () => {
  const s = setup("/");
  s.trigger();
  s.suggest.suggestions = { values: commands, selectedItem: 2 };
  assert.equal(s.suggest.autocomplete(), true);
  assert.equal(s.text(), "/help");
  const other = setup("/");
  other.trigger();
  other.plugin.options.slashUsage.help = 5;
  assert.equal(other.suggest.autocomplete(), true);
  assert.equal(other.text(), "/help");
});
test("format prefix and tidy alias Tab-complete without executing", () => {
  for (const input of ["/f", "/tidy"]) {
    const s = setup(input);
    s.trigger();
    assert.equal(s.suggest.completeSuggestion(), true);
    assert.equal(s.text(), "/format");
    assert.equal(s.calls.length, 0);
    assert.equal(s.recorded.length, 0);
    s.suggest.selectSuggestion(commands.find((command) => command.id === "format"));
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0][0], "format");
    assert.deepEqual(s.recorded, ["format"]);
  }
});
test("Enter passes context and editor once and records the canonical id", () => {
  const s = setup("/outline");
  s.trigger();
  s.suggest.selectSuggestion(commands[0]);
  s.suggest.selectSuggestion(commands[0]);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.recorded, ["toc"]);
  assert.equal(s.calls[0][1].query, "outline");
  assert.equal(s.suggest.closed, true);
});
test("stale context and foreign editor cannot replace or execute unrelated text", () => {
  const s = setup("/toc");
  s.trigger();
  assert.equal(s.suggest.completeSuggestion({}), false);
  s.editor.replaceRange("ordinary prose", { line: 0, ch: 0 }, { line: 0, ch: 4 });
  assert.equal(s.suggest.completeSuggestion(), false);
  s.suggest.selectSuggestion(commands[0]);
  assert.equal(s.calls.length, 0);
});
console.log(`${count} slash checks passed.`);
