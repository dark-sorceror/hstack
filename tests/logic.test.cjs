"use strict";
const assert = require("node:assert/strict");
const {
  listPlan,
  typographyPlan,
  prefixPlan,
  revertPlan,
  protectedContext,
} = require("../src/features/logic.js");
let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log("✓ " + name);
}
function apply(text, changes) {
  for (const change of [...changes].sort((a, b) => b.from - a.from))
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  return text;
}
function move(text, line, action, options) {
  const plan = listPlan(text, line, text.split("\n")[line].length, action, options);
  assert.ok(plan, "Expected a list operation");
  return { text: apply(text, plan.changes), cursor: plan.cursor };
}
function type(text, character) {
  const change = typographyPlan(text, text.length, text.length, character);
  return change ? apply(text, [change]) : text + character;
}

test("new numbered item becomes a bullet child on Tab", () => {
  assert.equal(move("1. Parent\n2. ", 1, "indent").text, "1. Parent\n\t* ");
});
test("typed items preserve their content while indenting", () => {
  assert.equal(move("1. Parent\n2. Details", 1, "indent").text, "1. Parent\n\t* Details");
});
test("Shift+Tab resumes the numbered parent at the next number", () => {
  assert.equal(move("1. Parent\n\t- Details", 1, "outdent").text, "1. Parent\n2. Details");
});
test("empty Enter/Backspace resumes numbering after previous bullet children", () => {
  assert.equal(move("7. Parent\n\t- First\n\t- ", 2, "exit").text, "7. Parent\n\t- First\n8. ");
});
test("outdenting respects the parent's numbered delimiter", () => {
  assert.equal(move("3) Parent\n    - ", 1, "exit", { useTabs: false }).text, "3) Parent\n4) ");
});
test("a bullet parent remains a bullet when returning from its child", () => {
  assert.equal(move("* Parent\n\t- Details", 1, "outdent").text, "* Parent\n* Details");
});
test("an explicitly existing numbered child list stays numbered", () => {
  assert.equal(
    move("1. Parent\n\t1. Existing\n2. Next", 2, "indent").text,
    "1. Parent\n\t1. Existing\n\t2. Next"
  );
});
test("moving a parent also moves descendants, but not following siblings", () => {
  const before = "1. Parent\n2. Move me\n\t- Child\n\t\t- Grandchild\n3. Keep me";
  assert.equal(
    move(before, 1, "indent").text,
    "1. Parent\n\t* Move me\n\t\t- Child\n\t\t\t- Grandchild\n3. Keep me"
  );
});
test("spaces-only indentation uses the configured width", () => {
  assert.equal(
    move("1. Parent\n2. ", 1, "indent", { useTabs: false, tabSize: 2 }).text,
    "1. Parent\n  * "
  );
});
test("cursor remains after the changed prefix", () => {
  const result = move("1. Parent\n2. ", 1, "indent");
  assert.equal(result.cursor, result.text.length);
});
test("nonempty Enter falls through to Obsidian", () => {
  assert.equal(listPlan("1. Parent\n\t- Text", 1, 7, "exit"), null);
});
test("task items, ordinary prose and blockquotes are left to Obsidian", () => {
  for (const line of ["- [ ] task", "plain text", "> 1. quoted"])
    assert.equal(listPlan(line, 0, line.length, "indent"), null);
});
test("fenced list-looking text is never reformatted", () => {
  const text = "```python\n1. fake\n2. ";
  assert.equal(listPlan(text, 2, 3, "indent"), null);
});
test("all dash/arrow chains convert immediately", () => {
  const cases = { "--": "–", "---": "—", "-->": "⟶", "<--": "⟵", "<-->": "⟷" };
  for (const [raw, expected] of Object.entries(cases)) {
    for (const prefix of ["", "Prose "]) {
      let text = prefix;
      for (const char of raw) text = type(text, char);
      assert.equal(text, prefix + expected);
    }
  }
});
test("the short dash extends to the matching long dash or wide arrow", () => {
  assert.equal(type("Prose –", "-"), "Prose —");
  assert.equal(type("Prose –", ">"), "Prose ⟶");
  assert.equal(type("Prose --", "-"), "Prose —");
  assert.equal(type("Prose --", ">"), "Prose ⟶");
  assert.equal(type("Prose <–", ">"), "Prose ⟷");
  assert.equal(type("Prose —", ">"), "Prose —>");
});
test("Space does not trigger a typography conversion", () => {
  assert.equal(type("Restored -->", " "), "Restored --> ");
  assert.equal(type("Restored --", " "), "Restored -- ");
});
test("immediate Backspace restores the entire raw chain", () => {
  for (const raw of ["--", "---", "-->", "<--", "<-->"]) {
    let text = "Prose ",
      plan;
    for (const char of raw) {
      plan = typographyPlan(text, text.length, text.length, char);
      text = plan ? apply(text, [plan]) : text + char;
    }
    const record = {
      from: plan.from,
      to: plan.from + plan.insert.length,
      text: plan.insert,
      raw: plan.raw,
    };
    assert.equal(apply(text, [revertPlan(text, record.to, record)]), "Prose " + raw);
    assert.equal(revertPlan(text, record.to - 1, record), null);
  }
});
test("code, frontmatter, comments and escaped shortcuts are preserved", () => {
  for (const text of [
    "---\ntitle: a -",
    "Text `a-",
    "```python\na-",
    "<!-- comment -",
    "<!-",
    "Escaped \\-",
    "Value $x-",
  ])
    assert.equal(typographyPlan(text, text.length, text.length, "-"), null);
});
test("prose after closed code and math blocks is eligible", () => {
  for (const prefix of ["```python\nx = 1\n```\n", "$$x = 1$$\n"]) {
    const text = prefix + "Next -";
    assert.equal(type(text, "-"), prefix + "Next –");
  }
});
test("dot-list and checkbox shortcuts work in empty prefix positions", () => {
  for (const [text, char, expected] of [
    [".", "-", "* "],
    ["    .", "-", "    * "],
    ["2. .", "-", "* "],
    ["[", "]", "- [ ] "],
    ["2. [", "]", "- [ ] "],
    ["* [", "]", "- [ ] "],
  ]) {
    assert.equal(apply(text, [prefixPlan(text, text.length, text.length, char)]), expected);
  }
});
test("the checkbox shortcut consumes a native paired closing bracket", () => {
  const plan = prefixPlan("[]", 1, 1, "]");
  assert.equal(apply("[]", [plan]), "- [ ] ");
  const nested = "    - []";
  assert.equal(
    apply(nested, [prefixPlan(nested, nested.length - 1, nested.length - 1, "]")]),
    "    - [ ] "
  );
});
test("prefix shortcuts leave ordinary text and code alone", () => {
  for (const [text, char] of [
    ["Version 1.", "-"],
    ["Array [", "]"],
    ["```python\n[", "]"],
  ])
    assert.equal(prefixPlan(text, text.length, text.length, char), null);
});
test("empty checkbox children return to parent numbering", () => {
  assert.equal(move("1. Parent\n\t- [ ] ", 1, "exit").text, "1. Parent\n2. ");
});
test("descendant movement stops before a separate indented block", () => {
  const before = "1. Parent\n2. Move\n\n\n    separate block";
  const after = move(before, 1, "indent").text;
  assert.ok(after.endsWith("\n\n\n    separate block"));
});
console.log(`${count} checks passed.`);
