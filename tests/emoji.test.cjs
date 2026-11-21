"use strict";
const assert = require("node:assert/strict");
const {
  normalize,
  search,
  triggerAt,
  directCompletion,
  createEmojiSuggest,
  defaultIndex,
} = require("../src/features/emoji.js");
const logic = require("../src/features/logic.js");
let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log("✓ " + name);
}
function completion(text) {
  return directCompletion(text, text.length, text.length, ":");
}

test("official offline dataset contains more than 1800 emoji", () => {
  assert.ok(defaultIndex.entries.length > 1800);
});
test("hyphens, underscores, and tags normalize consistently", () => {
  assert.equal(normalize("Thumbs_Up"), "thumbs-up");
  assert.equal(normalize("+1"), "+1");
  assert.equal(search("thumbs-up")[0].emoji, "👍");
  assert.equal(search("thumbs_up")[0].emoji, "👍");
  assert.equal(search("thumbsup")[0].emoji, "👍");
});
test("empty colon menu is useful and bounded", () => {
  const results = search("");
  assert.equal(results[0].emoji, "👍");
  assert.equal(results.length, 30);
  assert.deepEqual(
    results.slice(0, 2).map((value) => value.emoji),
    ["👍", "👎"]
  );
  assert.equal(new Set(results.map((value) => value.emoji)).size, results.length);
});
test("empty menu ranks by use count, then common defaults without duplicates", () => {
  const results = search("", defaultIndex, 30, { "🚀": 9, "🐙": 15, "👍": 9, "not-an-emoji": 100 });
  assert.deepEqual(
    results.slice(0, 3).map((value) => value.emoji),
    ["🐙", "👍", "🚀"]
  );
  assert.equal(new Set(results.map((value) => value.emoji)).size, results.length);
  assert.ok(!results.some((value) => value.emoji === "not-an-emoji"));
  assert.equal(search("", defaultIndex, 1, { "👎": -2, "🚀": Infinity })[0].emoji, "👍");
});
test("each typed prefix filters the complete catalog", () => {
  assert.ok(search("thumb").length > 1);
  assert.equal(search("thumbs-up")[0].name, "thumbs-up");
  assert.deepEqual(search("this-name-does-not-exist"), []);
  assert.equal(search("rocket")[0].emoji, "🚀");
  assert.ok(search("approve").some((entry) => entry.emoji === "👍"));
});
test("colon opens at line start or after prose whitespace", () => {
  assert.deepEqual(triggerAt(":", 1), { column: 0, query: "" });
  assert.deepEqual(triggerAt("Hello :thumbs-up", 16), { column: 6, query: "thumbs-up" });
  assert.equal(triggerAt("https://example.com", 7), null);
  assert.equal(triggerAt("12:30", 5), null);
  assert.deepEqual(triggerAt("Great:thumbs-up", "Great:thumbs-up".length), {
    column: 5,
    query: "thumbs-up",
  });
});
test("closing colon expands canonical and gemoji aliases", () => {
  for (const alias of ["thumbs-up", "thumbs_up", "thumbsup", "+1"]) {
    const result = completion("Hello :" + alias);
    assert.equal(result.insert, "👍");
    assert.equal(result.from, 6);
  }
  assert.equal(completion(":rocket").insert, "🚀");
  assert.equal(completion("Great:thumbs-up").insert, "👍");
  assert.equal(completion(":not-a-real-emoji"), null);
});
test("completion requires a typed closing colon and empty selection", () => {
  assert.equal(directCompletion(":rocket", 0, 7, ":"), null);
  assert.equal(directCompletion(":rocket", 7, 7, " "), null);
  assert.equal(directCompletion(":rocket", 7, 7, ":rocket:"), null);
});
test("code, math, YAML, HTML comments and URLs are preserved", () => {
  for (const text of [
    "` :thumbs-up",
    "```python\n:thumbs-up",
    "---\nname: :thumbs-up",
    "$ :thumbs-up",
    "<!-- :thumbs-up",
    "https://example.com/:thumbs-up",
  ])
    assert.equal(completion(text), null, text);
});

class FakeSuggest {
  constructor(app) {
    this.app = app;
  }
  close() {
    this.closed = true;
  }
}
const plugin = { options: { emoji: true }, logic, inCode: () => false };
test("native suggest exposes progressively filtered contexts", () => {
  const suggest = createEmojiSuggest({}, plugin, FakeSuggest);
  const text = "Hello :thumbs-up";
  const editor = { getLine: () => text, getValue: () => text, posToOffset: (cursor) => cursor.ch };
  const context = suggest.onTrigger({ line: 0, ch: text.length }, editor);
  assert.equal(context.query, "thumbs-up");
  assert.equal(suggest.getSuggestions(context)[0].emoji, "👍");
});
test("bare colon triggers a zero-character menu immediately and reads live usage", () => {
  const local = { ...plugin, options: { emoji: true, emojiUsage: {} } };
  const suggest = createEmojiSuggest({}, local, FakeSuggest);
  const editor = { getLine: () => ":", getValue: () => ":", posToOffset: (cursor) => cursor.ch };
  const context = suggest.onTrigger({ line: 0, ch: 1 }, editor);
  assert.deepEqual(context, { start: { line: 0, ch: 0 }, end: { line: 0, ch: 1 }, query: "" });
  assert.deepEqual(
    suggest
      .getSuggestions(context)
      .slice(0, 2)
      .map((value) => value.emoji),
    ["👍", "👎"]
  );
  local.options.emojiUsage["🚀"] = 1;
  assert.equal(suggest.getSuggestions(context)[0].emoji, "🚀");
});
test("Enter selection replaces only the active shortcode and closes the picker", () => {
  const selected = [];
  const suggest = createEmojiSuggest(
    {},
    { ...plugin, recordEmoji: (emoji) => selected.push(emoji) },
    FakeSuggest
  );
  let text = "Hello :thumbs-up";
  let cursor = null;
  const editor = {
    getLine: () => text,
    replaceRange: (value, start, end) => {
      text = text.slice(0, start.ch) + value + text.slice(end.ch);
    },
    setCursor: (value) => {
      cursor = value;
    },
  };
  suggest.context = { editor, start: { line: 0, ch: 6 }, end: { line: 0, ch: text.length } };
  suggest.selectSuggestion(search("thumbs-up")[0]);
  assert.equal(text, "Hello 👍");
  assert.deepEqual(cursor, { line: 0, ch: 8 });
  assert.equal(suggest.closed, true);
  assert.deepEqual(selected, ["👍"]);
  suggest.selectSuggestion(search("thumbs-up")[0]);
  assert.equal(text, "Hello 👍");
  assert.deepEqual(selected, ["👍"]);
});
test("picker respects disabled option and code contexts", () => {
  const text = ":rocket";
  const editor = {
    getLine: () => text,
    getValue: () => text,
    posToOffset: (cursor) => cursor.ch,
    cm: {},
  };
  const disabled = createEmojiSuggest({}, { ...plugin, options: { emoji: false } }, FakeSuggest);
  assert.equal(disabled.onTrigger({ line: 0, ch: text.length }, editor), null);
  const code = createEmojiSuggest({}, { ...plugin, inCode: () => true }, FakeSuggest);
  assert.equal(code.onTrigger({ line: 0, ch: text.length }, editor), null);
});
console.log(`${count} emoji checks passed.`);
