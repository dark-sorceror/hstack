"use strict";
const assert = require("node:assert/strict");
const { calloutPastePlan } = require("../src/features/callout-paste.js");
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("✓ " + name);
}
function planAt(source, pasted) {
  const from = source.indexOf("|");
  return calloutPastePlan(source.replace("|", ""), from, from, pasted);
}
function apply(source, plan) {
  source = source.replace("|", "");
  return source.slice(0, plan.from) + plan.insert + source.slice(plan.to);
}
test("active callout quotes every pasted continuation including blanks and diagram indentation", () => {
  const source = "> [!important]\n> |";
  const plan = planAt(source, "Before:\nA → B → C\n                    ↑ HEAD\n\nAfter:\nA → B");
  assert.equal(
    apply(source, plan),
    "> [!important]\n> Before:\n> A → B → C\n>                     ↑ HEAD\n> \n> After:\n> A → B"
  );
});
test("already quoted clipboard content does not double the existing first-line prefix", () => {
  const source = "> [!note]\n> |";
  const plan = planAt(source, "> text\n> more\n> > nested\nmissing");
  assert.equal(apply(source, plan), "> [!note]\n> text\n> more\n> > nested\n> missing");
});
test("raw payload preserves nested quotes, fences, tabs, and code indentation", () => {
  const source = "> [!example]\n> |";
  const plan = planAt(source, "text\n> nested\n```python\n\tif ready:\n    run()\n```\n");
  assert.equal(
    apply(source, plan),
    "> [!example]\n> text\n> > nested\n> ```python\n> \tif ready:\n>     run()\n> ```\n> "
  );
});
test("pasting inside a quoted code block still inherits its real callout prefix", () => {
  const source = "> [!note]\n> ```python\n> |\n> ```";
  assert.equal(
    apply(source, planAt(source, "a()\nb()")),
    "> [!note]\n> ```python\n> a()\n> b()\n> ```"
  );
});
test("nested callouts retain the current quote depth", () => {
  const source = "> [!note]\n> > [!tip]\n> > |";
  assert.equal(apply(source, planAt(source, "a\nb")), "> [!note]\n> > [!tip]\n> > a\n> > b");
});
test("whole prefixed line selection and content-only multiline selection both work", () => {
  const source = "> [!note]\n> first\n> second\n> third";
  const start = source.indexOf("> first"),
    end = source.indexOf("\n> third");
  let plan = calloutPastePlan(source, start, end, "a\nb");
  assert.equal(apply(source, plan), "> [!note]\n> a\n> b\n> third");
  plan = calloutPastePlan(source, start + 2, end, "a\nb");
  assert.equal(apply(source, plan), "> [!note]\n> a\n> b\n> third");
});
test("selection ending before next quote prefix does not duplicate it", () => {
  const source = "> [!note]\n> first\n> second";
  const plan = calloutPastePlan(
    source,
    source.indexOf("first"),
    source.indexOf("> second"),
    "a\nb"
  );
  assert.equal(apply(source, plan), "> [!note]\n> a\n> bsecond");
});
test("whole pasted malformed callout is repaired until an unquoted blank boundary", () => {
  const pasted =
    "> [!important]\n> Before:\nA → B\n    ↑ HEAD\n> \nAfter:\nA → C\n\nUnrelated paragraph\nplain text";
  const plan = calloutPastePlan("", 0, 0, pasted);
  assert.equal(
    plan.insert,
    "> [!important]\n> Before:\n> A → B\n>     ↑ HEAD\n> \n> After:\n> A → C\n\nUnrelated paragraph\nplain text"
  );
  assert.equal(plan.cursor, plan.insert.length);
});
test("ordinary quotes, outside prose, literal code and crossed callout boundaries stay native", () => {
  for (const source of [
    "> ordinary\n> |",
    "plain | prose",
    "```md\n> [!note]\n> |\n```",
    "    > [!note]\n    > |",
    "> [!note]\n\n|",
    "> [!note]\nnot quoted\n> |",
  ])
    assert.equal(planAt(source, "a\nb"), null, source);
  const source = "> [!note]\n> text\n\nother";
  assert.equal(calloutPastePlan(source, source.indexOf("text"), source.length, "a\nb"), null);
});
test("correct whole callouts and single-line text need no replacement", () => {
  assert.equal(calloutPastePlan("", 0, 0, "> [!note]\n> okay"), null);
  assert.equal(planAt("> [!note]\n> |", "single line"), null);
});
test("CRLF clipboard content normalizes to Obsidian newlines", () => {
  const source = "> [!note]\n> |";
  assert.equal(apply(source, planAt(source, "a\r\nb\r\n")), "> [!note]\n> a\n> b\n> ");
});
console.log(`${checks} callout paste checks passed.`);
