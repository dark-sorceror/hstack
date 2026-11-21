"use strict";
const assert = require("node:assert/strict");
const { formatMarkdown, planFormat, minimalChange } = require("../src/features/format.js");
let checks = 0;
function test(name, fn) { fn(); checks++; console.log("✓ " + name); }
function apply(text, plan) {
  for (const change of [...plan.changes].sort((a, b) => b.from - a.from))
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  return text;
}
test("existing ATX headings get consistent gaps and blank separation", () => {
  const before = "Intro \n##   Heading   ## \nParagraph \n### Child\nMore text";
  assert.equal(formatMarkdown(before), "Intro\n\n## Heading ##\n\nParagraph\n\n### Child\n\nMore text");
  assert.equal(formatMarkdown("#Not a heading \nText"), "#Not a heading\nText");
});
test("list marker types, ordered numbers, and checkbox states survive spacing cleanup", () => {
  const before = "-   Dash\n*  Dot\n+   Plus\n04.   Fourth\n2)  Second\n- [ ]   Todo\n* [x]  Done\n* [-]  Partial\n-   ";
  const expected = "- Dash\n* Dot\n+ Plus\n04. Fourth\n2) Second\n- [ ] Todo\n* [x] Done\n* [-] Partial\n- ";
  assert.equal(formatMarkdown(before), expected);
});
test("continuation indentation and parent marker gaps remain exact", () => {
  const before = "-   Parent\n    continuation  \n    *   Nested\n\t*\tTabbed\n- Leaf ";
  assert.equal(formatMarkdown(before), "-   Parent\n    continuation  \n    *   Nested\n\t*\tTabbed\n- Leaf");
});
test("prose trailing spaces are trimmed while intentional hard breaks stay two spaces", () => {
  assert.equal(formatMarkdown("One \nTwo  \nThree    \nFour\t\n  \nEnd"), "One\nTwo  \nThree  \nFour\n\nEnd");
});
test("wording and inline underline, bold, links and emphasis syntax stay intact", () => {
  const before = "__underlined__ **bold** *italic* snake_case [Docs](https://example.com) \nNext";
  assert.equal(formatMarkdown(before), "__underlined__ **bold** *italic* snake_case [Docs](https://example.com)\nNext");
});
test("frontmatter, fenced code, indented code and quoted callout code are exact", () => {
  const blocks = [
    "---\ntitle:  Note  \nitems: [a,  b] \n---",
    "```python\n#   code   \nx = 1  \n\n```",
    "~~~json\n{  \"a\": 1  }  \n~~~",
    "    #   indented  \n\tprint('exact')  ",
    "> [!example]\n> ```python\n> #   code  \n> \n>   print('exact')  \n> ```"
  ];
  for (const block of blocks) assert.equal(formatMarkdown(block), block, block);
});
test("math, HTML comments and HTML code blocks remain exact", () => {
  for (const source of [
    "$$\nx  =  y   \n$$", "\\[\nx  = y   \n\\]", "Inline $x  + y$   ",
    "<!--\n#  Hidden  \n  comment   \n-->", "<pre>\n#   raw  \n</pre>", "<div>\nText   \n</div>"
  ]) assert.equal(formatMarkdown(source), source);
});
test("ASCII diagrams, Unicode diagrams and Markdown tables retain alignment", () => {
  for (const source of [
    "A --- B --- C   \n      |  \n      v  ",
    "A → B → C   \n        ↑ HEAD  ",
    "Name   State   Owner   \n---    ---     ---   ",
    "| A    | B |  \n| :--- | --: |\n| one  | two |  "
  ]) assert.equal(formatMarkdown(source), source);
});
test("Setext headings and managed TOC sections remain byte-for-byte intact", () => {
  for (const source of ["Title   \n======\n\nOther  \n---", "<!-- notes-toc:start -->\n**Contents**   \n\n* [[#A|A]]  \n<!-- notes-toc:end -->"])
    assert.equal(formatMarkdown(source), source);
});
test("CRLF and final newline presence are preserved", () => {
  assert.equal(formatMarkdown("Text \r\nNext\r\n"), "Text\r\nNext\r\n");
  assert.equal(formatMarkdown("Text "), "Text");
});
test("formatting is idempotent across headings, lists, code and hard breaks", () => {
  const source = "#   Title\nIntro \n-   Parent\n  *   Child\n\n## Second ##\nText    \n\n```md\n#   Literal\n```\n";
  const once = formatMarkdown(source);
  assert.equal(formatMarkdown(once), once);
});
test("slash format and tidy aliases and their valid prefixes remove the command in one patch", () => {
  for (const token of ["/", "/f", "/for", "/format", "/t", "/tid", "/tidy"]) {
    const source = token + "\n\n##   Heading\nText ";
    const plan = planFormat(source, 0, token.length);
    assert.equal(plan.changes.length, 1, token);
    assert.equal(apply(source, plan), "\n## Heading\n\nText", token);
    assert.equal(plan.cursor, 0);
    assert.equal(plan.changed, true);
  }
});
test("unchanged formatting still removes its slash command and reports no cleanup", () => {
  const source = "/format\nAlready clean\n";
  const plan = planFormat(source, 0, 7);
  assert.equal(apply(source, plan), "Already clean\n");
  assert.equal(plan.changed, false);
  assert.deepEqual(plan.changes, [{ from: 0, to: 8, insert: "" }]);
});
test("minimal diff preserves unchanged prefix and suffix around an edit", () => {
  assert.deepEqual(minimalChange("Keep\nText \nEnd", "Keep\nText\nEnd"), { from: 9, to: 10, insert: "" });
  assert.equal(minimalChange("same", "same"), null);
});
test("inline commands, invalid prefixes, callouts, fences and frontmatter cannot trigger whole-note formatting", () => {
  for (const source of ["Prose /format\nText ", "/formatting\nText ", "> /format\nText ", "```md\n/format\n```\nText ", "---\n/format\n---\nText ", "    /format\nText "]) {
    const from = source.indexOf("/format");
    assert.equal(planFormat(source, from, from + 7), null, source);
  }
});
console.log(`${checks} format checks passed.`);
