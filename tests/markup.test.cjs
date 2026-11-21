"use strict";
const assert = require("node:assert/strict");
const { sourceListItem, analyzeSource, getEmphasis, getUnderlineDelimiters, getNestedAsteriskEmphasis, getNestedAsteriskDelimiters, pairPlan, enterPairPlan, postprocessMarkup } = require("../src/features/markup.js");
let checks = 0;
function test(name, fn) { fn(); checks++; console.log("✓ " + name); }

test("underscore emphasis and asterisk bold are distinct", () => {
  assert.deepEqual(getEmphasis("__test__ and **bold**").map(mark => mark.markup), ["__", "**"]);
});
test("nested bold and underline preserve their ancestor roles", () => {
  const marks = getEmphasis("**bold __underlined__** and __underlined **bold**__");
  assert.deepEqual(marks.map(mark => mark.markup), ["**", "__", "__", "**"]);
  assert.equal(marks[1].boldAncestor, true);
  assert.equal(marks[3].underlineAncestor, true);
});
test("underline is recognized inside single, double, and triple asterisk emphasis", () => {
  for (const source of ["*__text__*", "**__text__**", "***__text__***"]) {
    const underline = getEmphasis(source).find(mark => mark.markup === "__");
    assert.ok(underline, source);
    assert.equal(source.slice(underline.innerFrom, underline.innerTo), "text");
    const hidden = getUnderlineDelimiters(source, [source.length]);
    assert.equal(hidden.length, 2, source);
    for (const range of hidden) assert.equal(source.slice(range.from, range.to), "__");
  }
});
test("single, double, and triple asterisk emphasis inside underline keep paired underscores hidden", () => {
  for (const source of ["__*text*__", "__**text**__", "__***text***__"]) {
    const marks = getEmphasis(source), outer = marks.find(mark => mark.markup === "__");
    assert.equal(outer.from, 0);
    assert.equal(outer.to, source.length);
    assert.equal(getUnderlineDelimiters(source, [source.length]).length, 2);
    assert.equal(marks.some(mark => mark.markup === "**" && mark.underlineAncestor), source.includes("**"));
  }
});
test("underline delimiters expose themselves only when the caret enters them", () => {
  assert.equal(getUnderlineDelimiters("__test__", [0]).length, 2);
  assert.equal(getUnderlineDelimiters("__test__", [8]).length, 2);
  assert.equal(getUnderlineDelimiters("__test__", [1]).length, 0);
  assert.equal(getUnderlineDelimiters("__test__", [7]).length, 0);
  assert.equal(getUnderlineDelimiters("____", [2]).length, 0);
});
test("single/double/triple asterisk delimiters inside underline are hidden with correct styles", () => {
  for (const count of [1, 2, 3]) {
    const marker = "*".repeat(count), source = "__" + marker + "text" + marker + "__";
    const pairs = getNestedAsteriskEmphasis(source);
    assert.equal(pairs.length, 1, source);
    assert.equal(source.slice(pairs[0].innerFrom, pairs[0].innerTo), "text");
    assert.equal(pairs[0].bold, count >= 2);
    assert.equal(pairs[0].italic, count % 2 === 1);
    const hidden = getNestedAsteriskDelimiters(source, [source.length], pairs);
    assert.equal(hidden.length, 2);
    assert.deepEqual(hidden.map(range => source.slice(range.from, range.to)), [marker, marker]);
    assert.equal(getUnderlineDelimiters(source, [source.length]).length, 2);
  }
});
test("nested asterisk hiding is scoped to underline and excludes code/escaped markers", () => {
  for (const source of ["*italic* **bold** ***both***", "`__**code**__`", "__\\*literal\\*__", "__**unfinished__"])
    assert.equal(getNestedAsteriskEmphasis(source).length, 0, source);
});
test("explicit caret entry reveals a nested multi-character asterisk delimiter", () => {
  const source = "__**text**__";
  assert.equal(getNestedAsteriskDelimiters(source, [source.length]).length, 2);
  assert.equal(getNestedAsteriskDelimiters(source, [3]).length, 0);
  assert.equal(getNestedAsteriskDelimiters(source, [9]).length, 0);
});
test("bold and italic pairs can nest inside one another under underline", () => {
  const source = "__*outer **inner** outer*__";
  const pairs = getNestedAsteriskEmphasis(source);
  assert.equal(pairs.length, 2);
  assert.ok(pairs.some(pair => pair.bold && !pair.italic && source.slice(pair.innerFrom, pair.innerTo) === "inner"));
  assert.ok(pairs.some(pair => !pair.bold && pair.italic && source.slice(pair.innerFrom, pair.innerTo).startsWith("outer")));
  assert.equal(getNestedAsteriskDelimiters(source, [source.length], pairs).length, 4);
});
function applyPair(text, plan) {
  for (const change of [...plan.changes].sort((a, b) => b.from - a.from))
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  return text;
}
test("empty native single emphasis pairs upgrade to double pairs", () => {
  for (const key of ["*", "_"]) {
    const plan = pairPlan(key.repeat(2), 1, 1, key);
    assert.equal(applyPair(key.repeat(2), plan), key.repeat(4));
    assert.equal(plan.cursor, 2);
  }
});
test("empty double pairs can become triple pairs for nested italic emphasis", () => {
  for (const key of ["*", "_"]) {
    const plan = pairPlan(key.repeat(4), 2, 2, key);
    assert.equal(applyPair(key.repeat(4), plan), key.repeat(6));
    assert.equal(plan.cursor, 3);
  }
});
test("typing an existing one-, two-, or three-marker closer moves over it", () => {
  for (const key of ["*", "_"]) for (const count of [1, 2, 3]) {
    const marker = key.repeat(count), source = marker + "text" + marker;
    for (let cursor = count + 4; cursor < source.length; cursor++) {
      const plan = pairPlan(source, cursor, cursor, key);
      assert.ok(plan, source + " at " + cursor);
      assert.deepEqual(plan.changes, []);
      assert.equal(plan.cursor, cursor + 1);
    }
  }
});
test("selected content in a native pair upgrades without losing selection", () => {
  const plan = pairPlan("*text*", 1, 5, "*");
  assert.equal(applyPair("*text*", plan), "**text**");
  assert.deepEqual(plan.selection, { anchor: 2, head: 6 });
  assert.equal(plan.cursor, 6);
  assert.equal(pairPlan("text", 0, 4, "*"), null);
});
test("pairing does not interfere with single-marker starts, lists, snake_case, code or arithmetic", () => {
  for (const [source, from, to, key] of [
    ["", 0, 0, "*"], ["* ", 2, 2, "*"], ["snake__case", 6, 6, "_"],
    ["`**`", 2, 2, "*"], ["```md\n**\n```", 7, 7, "*"],
    ["x**y", 2, 2, "*"], ["2 * 3 * 4", 6, 6, "*"], ["*a* text*", 8, 8, "*"]
  ]) assert.equal(pairPlan(source, from, to, key), null, source);
});
function atCaret(source) {
  const cursor = source.indexOf("|");
  return { source: source.replace("|", ""), cursor };
}
test("Enter removes empty native emphasis and punctuation pairs without inserting a newline", () => {
  for (const input of ["*|*", "**|**", "***|***", "_|_", "__|__", "___|___", "(|)", "[|]", "{|}", '"|"', "'|'", "“|”", "‘|’", "`|`"]) {
    const { source, cursor } = atCaret(input);
    const plan = enterPairPlan(source, cursor);
    assert.equal(plan?.kind, "empty", input);
    assert.equal(applyPair(source, plan), "", input);
    assert.equal(plan.cursor, 0, input);
  }
});
test("Enter cleans nested empty placeholders while preserving text and native list prefixes", () => {
  for (const [input, expected, cursor] of [
    ["Prefix (**|**) suffix", "Prefix  suffix", 7],
    ["1. __|__", "1. ", 3],
    ["* __|__", "* ", 2],
    ["> * **|**", "> * ", 4],
    ["* Parent\n  * __|__", "* Parent\n  * ", 13]
  ]) {
    const value = atCaret(input), plan = enterPairPlan(value.source, value.cursor);
    assert.equal(plan?.kind, "empty", input);
    assert.equal(applyPair(value.source, plan), expected, input);
    assert.equal(plan.cursor, cursor, input);
  }
});
test("Enter finishes nonempty matching closers at end of line without editing source", () => {
  for (const input of ["*text|*", "**text|**", "***text|***", "__text|__", "(text|)", "[text|]", "{text|}", '"text|"', "‘text|’", "`text|`", "``text|``", "(**__text|__**)", "**text*|*", "**text|**   "]) {
    const { source, cursor } = atCaret(input), plan = enterPairPlan(source, cursor);
    assert.equal(plan?.kind, "finish", input);
    assert.deepEqual(plan.changes, [], input);
    assert.equal(plan.cursor, source.length, input);
  }
});
test("Enter before a closer respects the current line and does not consume following text", () => {
  const { source, cursor } = atCaret("before\n__text|__\nafter");
  assert.equal(enterPairPlan(source, cursor).cursor, source.indexOf("\nafter"));
});
test("Enter leaves selections, middle content, unmatched markers and literal syntax native", () => {
  for (const input of ["**te|xt**", "**text|** suffix", "(text|) suffix", "text|**", "snake__|__case", "4 * 5|*", "`__|__`", "$__|__$", "\\*|*", "[[|]]", "[label|](url)", "plain| text", "* |", "1. |", "---|", "don't|'", "    **|**", "```md\n**|**\n```", "---\nkey: __|__\n---"]) {
    const { source, cursor } = atCaret(input);
    assert.equal(enterPairPlan(source, cursor), null, input);
  }
  assert.equal(enterPairPlan("**text**", 2, 6), null);
});
test("escaped and intraword underscores do not become underline", () => {
  assert.equal(getEmphasis("\\__escaped__ some__word__more").length, 0);
});
test("inline code, URLs, wiki links, and link destinations are excluded", () => {
  assert.deepEqual(getEmphasis("`__code__` https://a.test/__path__ [[__Note__]] [name](x/__url__) __yes__")
    .map(mark => mark.markup), ["__"]);
});
test("fences, frontmatter, math, and comments are excluded", () => {
  const source = "---\nname: __yaml__\n---\n```md\n__code__\n```\n$$\n__math__\n$$\n<!-- __comment__ -->\n__prose__";
  assert.deepEqual(getEmphasis(source).map(mark => source.slice(mark.innerFrom, mark.innerTo)), ["prose"]);
});
test("HTML code contents are excluded without suppressing adjacent prose", () => {
  assert.deepEqual(getEmphasis("<code>__literal__</code> <pre>**literal**</pre> __prose__")
    .map(mark => mark.markup), ["__"]);
});
test("emphasis cannot cross a paragraph break", () => {
  assert.equal(getEmphasis("__first\n\nsecond__").length, 0);
});
test("explicit HTML strong is tracked without becoming underline", () => {
  assert.deepEqual(getEmphasis("<strong>HTML</strong> __underlined__ **bold**").map(mark => mark.markup), ["html", "__", "**"]);
});
test("source list scanning preserves list types and tasks", () => {
  const source = "- Dashed\n    * Dot\n    1. Number\n    - [ ] Task\n```text\n- Not a list\n```\n* Dot again";
  const lists = analyzeSource(source).lists;
  assert.deepEqual(lists.map(list => list.marker), ["-", "*", "1.", "-", "*"]);
  assert.equal(lists[3].task, true);
});
test("orphan indented code is not labeled as a list", () => {
  assert.equal(analyzeSource("    - Code\n    __code__").lists.length, 0);
  assert.equal(getEmphasis("    - Code\n    __code__").length, 0);
});
test("indented code inside a list is excluded but continuation prose is retained", () => {
  assert.equal(getEmphasis("* Parent\n\n      __code__").length, 0);
  assert.equal(getEmphasis("* Parent\n    __continuation__").length, 1);
});
test("quoted list markers can be styled without changing their text", () => {
  assert.equal(sourceListItem("> - Quoted").marker, "-");
  assert.equal(sourceListItem("> 1. Ordered").ordered, true);
});

// A tiny DOM adapter exercises the postprocessor's structural changes without
// introducing a browser dependency into this local plugin's checks.
const document = { createElement: tag => new Element(tag) };
class Element {
  constructor(tag, ...children) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = new Map();
    this.ownerDocument = document; this.parentElement = null;
    this.classList = { add: value => this.setAttribute("class", ((this.attrs.get("class") || "") + " " + value).trim()) };
    for (const child of children) this.appendChild(child);
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  get firstChild() { return this.children[0] || null; }
  setAttribute(name, value) { this.attrs.set(name, value); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  matches(selector) { return this.tagName.toLowerCase() === selector; }
  closest(selector) {
    const tags = selector.split(",").map(value => value.trim().toUpperCase());
    for (let node = this; node; node = node.parentElement) if (tags.includes(node.tagName)) return node;
    return null;
  }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) if (child instanceof Element) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  appendChild(child) {
    if (child.parentElement) child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
    child.parentElement = this; this.children.push(child); return child;
  }
  replaceWith(replacement) {
    const parent = this.parentElement, index = parent.children.indexOf(this);
    parent.children[index] = replacement; replacement.parentElement = parent; this.parentElement = null;
  }
}
const text = value => ({ textContent: value, parentElement: null });
const strong = value => new Element("strong", text(value));
function process(root, source, options = {}) {
  postprocessMarkup(root, { getSectionInfo: () => ({ text: source, lineStart: 0, lineEnd: source.split("\n").length - 1 }) }, { options });
}

test("identical bold and underline text are paired by source order", () => {
  const first = strong("same"), second = strong("same"), root = new Element("p", first, second);
  process(root, "__same__ **same**");
  assert.equal(root.children[0].tagName, "U");
  assert.equal(root.children[1], second);
});
test("underlining an outer span preserves a nested bold element", () => {
  const inner = strong("inner"), outer = new Element("strong", inner), root = new Element("p", outer);
  process(root, "__**inner**__");
  assert.equal(root.children[0].tagName, "U");
  assert.equal(root.children[0].children[0], inner);
});
test("HTML strong is preserved while Markdown underscores become underline", () => {
  const html = strong("HTML"), underlined = strong("text"), root = new Element("p", html, underlined);
  process(root, "<strong>HTML</strong> __text__");
  assert.equal(root.children[0], html);
  assert.equal(root.children[1].tagName, "U");
});
test("ambiguous source/DOM counts leave existing bold alone", () => {
  const original = strong("manual"), root = new Element("p", original);
  process(root, "__one__ **two**");
  assert.equal(root.children[0], original);
});
test("reading-view list styling marks only ordinary hyphen items", () => {
  const items = Array.from({ length: 4 }, () => new Element("li"));
  const root = new Element("div", ...items);
  process(root, "- Dash\n* Dot\n1. Number\n- [ ] Checkbox");
  assert.equal(items[0].getAttribute("data-notes-list-style"), "dash");
  for (const item of items.slice(1)) assert.equal(item.getAttribute("data-notes-list-style"), null);
});
test("each style feature respects its disabled setting", () => {
  const original = strong("text"), li = new Element("li"), root = new Element("div", original, li);
  process(root, "__text__\n- Item", { underline: false, listStyles: false });
  assert.equal(root.children[0], original);
  assert.equal(li.getAttribute("data-notes-list-style"), null);
});
console.log(`${checks} markup checks passed.`);
