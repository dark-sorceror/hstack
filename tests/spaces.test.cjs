"use strict";
const assert = require("node:assert/strict");
const { leadingSpaceGroups, createLiteralSpaceExtension } = require("../src/features/spaces.js");
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("✓ " + name);
}
function groups(text) {
  return leadingSpaceGroups(text).map(({ from, to }) => [from, to]);
}

test("one through three leading spaces keep their native glyph widths", () => {
  for (let count = 0; count < 4; count++) assert.deepEqual(groups(" ".repeat(count) + "text"), []);
});
test("each completed four-space group gets its own geometry override", () => {
  assert.deepEqual(groups("    text"), [[0, 4]]);
  assert.deepEqual(groups("         text"), [
    [0, 4],
    [4, 8],
  ]);
});
test("tabs are never marked or flattened", () => {
  assert.deepEqual(groups("\t\ttext"), []);
  assert.deepEqual(groups("\t    \t    text"), [
    [1, 5],
    [6, 10],
  ]);
  for (const group of leadingSpaceGroups("\t    \t    text"))
    assert.equal("\t    \t    text".slice(group.from, group.to), "    ");
});
test("mixed partial spaces and a tab follow native grouping", () => {
  assert.deepEqual(groups("  \t    text"), [[3, 7]]);
  assert.deepEqual(groups("    \ttext"), [[0, 4]]);
});
test("quote prefixes consume the native optional quote space", () => {
  assert.deepEqual(groups(">    text"), []);
  assert.deepEqual(groups(">     text"), [[2, 6]]);
  assert.deepEqual(groups("> >     text"), [[4, 8]]);
  assert.deepEqual(groups("  >     text"), [[3, 7]]);
});
test("spaces within prose or after a list marker are not leading indent spans", () => {
  assert.deepEqual(groups("text    more"), []);
  assert.deepEqual(groups("-     list text"), []);
  assert.deepEqual(groups("1.     numbered text"), []);
});
test("nonbreaking space is not rewritten or included in an ASCII-space group", () => {
  assert.deepEqual(groups("\u00a0    text"), [[1, 5]]);
});

// A small decoration adapter exercises viewport offset planning and toggling
// without loading or changing an Obsidian note.
function document(text) {
  const lines = text.split("\n");
  let offset = 0;
  const entries = lines.map((value, index) => {
    const line = { text: value, from: offset, to: offset + value.length, number: index + 1 };
    offset += value.length + 1;
    return line;
  });
  return {
    line: (number) => entries[number - 1],
    lineAt: (position) => entries.find((line) => position <= line.to) || entries.at(-1),
  };
}
const Decoration = {
  none: [],
  mark: (spec) => ({ range: (from, to) => ({ from, to, class: spec.class }) }),
  set: (ranges) => ranges,
};
const ViewPlugin = { fromClass: (Type, spec) => ({ Type, spec }) };

test("viewport decoration planning leaves stored text and actual tabs intact", () => {
  const text = "outside\n\t    code\n        next";
  const doc = document(text);
  const plugin = { options: { literalSpaces: true } };
  const extension = createLiteralSpaceExtension(plugin, { Decoration, ViewPlugin });
  const view = { state: { doc }, visibleRanges: [{ from: 8, to: text.length }] };
  const value = new extension.Type(view);
  assert.deepEqual(
    value.decorations.map(({ from, to }) => [from, to]),
    [
      [9, 13],
      [18, 22],
      [22, 26],
    ]
  );
  assert.equal(text, "outside\n\t    code\n        next");
  for (const range of value.decorations) assert.equal(text.slice(range.from, range.to), "    ");
});
test("overlapping visible ranges do not duplicate line decorations", () => {
  const text = "    first\n    second";
  const extension = createLiteralSpaceExtension(
    { options: { literalSpaces: true } },
    { Decoration, ViewPlugin }
  );
  const view = {
    state: { doc: document(text) },
    visibleRanges: [
      { from: 0, to: 12 },
      { from: 10, to: text.length },
    ],
  };
  assert.equal(new extension.Type(view).decorations.length, 2);
});
test("disabling literal-space mode removes only this extension's overrides", () => {
  const plugin = { options: { literalSpaces: true } };
  const extension = createLiteralSpaceExtension(plugin, { Decoration, ViewPlugin });
  const view = { state: { doc: document("\t    text") }, visibleRanges: [{ from: 0, to: 9 }] };
  const value = new extension.Type(view);
  assert.equal(value.decorations.length, 1);
  plugin.options.literalSpaces = false;
  value.update({ view, docChanged: false, viewportChanged: false });
  assert.deepEqual(value.decorations, []);
  plugin.options.literalSpaces = true;
  value.update({ view, docChanged: false, viewportChanged: false });
  assert.equal(value.decorations.length, 1);
});
console.log(`${checks} literal-space geometry checks passed.`);
