"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeLexical, lexicalFor, sourceLines } = require("../src/markdown/source.js");
const previous = require("./helpers/previous-protection.cjs");

test("shared scanner preserves existing LF protection at every offset across mixed contexts", () => {
  const fragments = [
    "ordinary text",
    "#tag [[Link]]",
    "```python\nx = 1\n```",
    "> ```text\n> inner\n> ```",
    "---\ntags: x\n---",
    "before <!-- hidden --> after",
    "<!-- open\ncomment\nend -->",
    "$$\nx\n$$",
    "`code` and ``other``",
    "$math$ and prose",
    "- ```text\n  code\n  ```",
    "\\`escaped`",
    "~~~text\nbody\n~~~",
    "$$ inline $$",
  ];
  for (const first of fragments)
    for (const second of fragments) {
      const text = first + "\n" + second + "\nend";
      const source = analyzeLexical(text);
      for (let position = 0; position <= text.length; position++)
        assert.equal(
          source.protectedAt(position),
          previous(text, position),
          JSON.stringify({ text, position })
        );
    }
});

test("CRLF and BOM frontmatter are protected without changing UTF-16 source positions", () => {
  const text = "\uFEFF---\r\nname: __😀__\r\n---\r\nBody #tag";
  const source = analyzeLexical(text);
  assert.equal(source.protectedAt(text.indexOf("😀")), true);
  assert.equal(source.protectedAt(text.indexOf("#tag")), false);
  assert.equal(source.lines[source.lineIndex(text.indexOf("Body"))].from, text.indexOf("Body"));
  assert.equal(sourceLines(text)[1].value, "name: __😀__");
});

test("same-text queries reuse a bounded lexical index and preserve fence boundary behavior", () => {
  const text = "```text\nbody\n```\nplain";
  assert.equal(lexicalFor(text), lexicalFor(text));
  assert.equal(lexicalFor(text).protectedAt(text.indexOf("body")), true);
  assert.equal(lexicalFor(text).protectedAt(text.indexOf("plain")), false);
});
