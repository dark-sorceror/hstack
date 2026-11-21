"use strict";
const assert = require("node:assert/strict");
const {
  START,
  END,
  scanHeadings,
  headingText,
  contentsBlock,
  planTOC,
} = require("../src/features/outline.js");
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("✓ " + name);
}
function apply(text, plan) {
  for (const change of [...plan.changes].sort((a, b) => b.from - a.from))
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  return text;
}
function command(text, token = "/toc") {
  const from = text.indexOf(token);
  return planTOC(text, from, from + token.length);
}
test("real Git note structure includes actual headings without inventing Three Layers", () => {
  const source =
    "/toc\n\nThree Layers\n- Working directory\n\t- Actual files on disk\n- Staging area\n\n### Git add\n`git add`\n\n### Git restore\nText\n\n### Git commit\nText\n\n### Git reset\n> [!important]\n> ### Example, not page heading\n";
  const plan = command(source);
  assert.equal(plan.headingCount, 4);
  const output = apply(source, plan);
  assert.ok(output.startsWith(`${START}\n**Contents**\n\n* [[#Git add|Git add]]`));
  assert.ok(output.includes("* [[#Git reset|Git reset]]"));
  assert.ok(!output.includes("[[#Three Layers"));
  assert.equal(
    output.slice(output.indexOf("Three Layers")),
    source.slice(source.indexOf("Three Layers"))
  );
});
test("ATX levels, closing hashes, and setext headings are recognized", () => {
  const source =
    "# One #\n## Two\n### Three ###\n#### Four\n##### Five\n###### Six\n####### Not a heading\n#nospace\n\nSetext title\n==============\n\nSecond title\n---\n";
  assert.deepEqual(
    scanHeadings(source).map(({ level, text }) => [level, text]),
    [
      [1, "One"],
      [2, "Two"],
      [3, "Three"],
      [4, "Four"],
      [5, "Five"],
      [6, "Six"],
      [1, "Setext title"],
      [2, "Second title"],
    ]
  );
});
test("YAML, fenced code, callouts, comments and indented code cannot add headings", () => {
  const source =
    "---\ntitle: note\n# yaml\n---\n```md\n# fenced\n```\n~~~md\nTitle\n====\n~~~\n> [!note]\n> # callout\n> ```md\n> # quoted code\n> ```\n<!--\n# comment\n-->\n    # indented\n\t## tab code\n# Real";
  assert.deepEqual(
    scanHeadings(source).map((mark) => mark.text),
    ["Real"]
  );
});
test("nested list headings and code stay out of the page outline", () => {
  const source =
    "* Parent\n  # Nested heading\n  * Child\n    ## Child heading\n  ## Parent heading\n\n# Page heading\n* ```md\n# code\n  ```\n# Another page heading";
  assert.deepEqual(
    scanHeadings(source).map((mark) => mark.text),
    ["Page heading", "Another page heading"]
  );
});
test("inline formatting produces readable rendered heading labels and anchors", () => {
  assert.equal(headingText("**Git** `add` and _restore_"), "Git add and restore");
  assert.equal(headingText("[Docs](https://example.com) &amp; [[Target|Alias]]"), "Docs & Alias");
  assert.equal(headingText("Use <em>small</em> &#x2192; big"), "Use small → big");
  assert.equal(headingText("\\*literal\\* and \\[brackets\\]"), "*literal* and [brackets]");
  const block = contentsBlock(scanHeadings("# **Git** `add`\n## snake_case"));
  assert.ok(block.includes("[[#Git add|Git add]]"));
  assert.ok(block.includes("[[#snake_case|snake_case]]"));
});
test("bullet hierarchy follows actual ancestor heading levels and uses round marker syntax", () => {
  const block = contentsBlock(scanHeadings("### A\n##### B\n###### C\n#### D\n### E\n## F"));
  assert.ok(
    block.includes("* [[#A|A]]\n  * [[#B|B]]\n    * [[#C|C]]\n  * [[#D|D]]\n* [[#E|E]]\n* [[#F|F]]")
  );
});
test("special wiki delimiters use safe same-page Markdown links", () => {
  const block = contentsBlock(scanHeadings("# A | B\n## Array [index]"));
  assert.ok(block.includes("[A \\| B](#A%20%7C%20B)"));
  assert.ok(block.includes("[Array \\[index\\]](#Array%20%5Bindex%5D)"));
});
test("existing managed contents refresh without duplicates and preserve surrounding content", () => {
  const source = `Preface\n\n${START}\n**Contents**\n\n* [[#Old|Old]]\n${END}\n\n# New\nText\n\n/outline\nAfter command\n`;
  const plan = command(source, "/outline"),
    output = apply(source, plan);
  assert.equal(plan.updated, true);
  assert.equal(plan.changes.length, 2);
  assert.equal((output.match(/notes-toc:start/g) || []).length, 1);
  assert.ok(output.startsWith("Preface\n\n"));
  assert.ok(output.includes("[[#New|New]]"));
  assert.ok(!output.includes("[[#Old|Old]]"));
  assert.ok(output.endsWith("# New\nText\n\nAfter command\n"));
  assert.ok(plan.changes[0].to <= plan.changes[1].from);
  assert.equal(output.slice(plan.cursor - END.length, plan.cursor), END);
});
test("refresh is idempotent, excludes generated content, and maps cursor with earlier command removal", () => {
  let source = "/toc\n\n# A\n## B\n";
  source = apply(source, command(source));
  const expected = source;
  source = "/outline\n" + source;
  const plan = command(source, "/outline"),
    output = apply(source, plan);
  assert.equal(output, expected);
  assert.equal(plan.headingCount, 2);
  assert.equal(output.slice(plan.cursor - END.length, plan.cursor), END);
});
test("own managed block headings are ignored even after manual edits", () => {
  const source = `${START}\n# Wrong\n${END}\n# Real`;
  assert.deepEqual(
    scanHeadings(source).map((mark) => mark.text),
    ["Real"]
  );
});
test("missing headings, malformed markers, inline commands, code and partial commands are unchanged", () => {
  for (const source of [
    "/toc\n\nThree Layers\n- plain text",
    "/toc\n\n" + START + "\n# A",
    "Text /toc\n# A",
    "/toc-more\n# A",
    "```md\n/toc\n```\n# A",
    "    /toc\n# A",
  ])
    assert.equal(command(source), null, source);
});
test("duplicate headings retain standard Obsidian heading targets without fabricated suffixes", () => {
  const block = contentsBlock(scanHeadings("# Same\n## Same"));
  assert.equal((block.match(/\[\[#Same\|Same\]\]/g) || []).length, 2);
});
test("highlighted slash command executes directly from bare slash and valid partial aliases", () => {
  for (const token of ["/", "/t", "/to", "/out", "/outli", "/outline"]) {
    const source = token + "\n\n# Heading";
    const plan = planTOC(source, 0, token.length);
    assert.equal(plan?.headingCount, 1, token);
    assert.ok(apply(source, plan).includes("[[#Heading|Heading]]"));
  }
  assert.equal(planTOC("/other\n# Heading", 0, 6), null);
});
test("literal managed markers inside fenced code cannot hijack TOC refresh", () => {
  const source = `/toc\n\n\`\`\`md\n${START}\n# Example\n${END}\n\`\`\`\n\n# Real`;
  const plan = command(source);
  assert.equal(plan.updated, false);
  assert.equal(plan.headingCount, 1);
  assert.ok(apply(source, plan).endsWith(source.slice(source.indexOf("```md"))));
});
test("CRLF headings preserve original UTF-16 offsets across YAML, fences and setext titles", () => {
  const source =
    "\uFEFF---\r\ntitle: note\r\n---\r\n# Root 😀\r\n```md\r\n# Fake\r\n```\r\n\r\nChild\r\n---\r\n";
  assert.deepEqual(scanHeadings(source), [
    { level: 1, text: "Root 😀", from: source.indexOf("# Root"), line: 3 },
    { level: 2, text: "Child", from: source.indexOf("Child"), line: 8 },
  ]);
});
test("CRLF contents insertion and refresh preserve line endings and managed block identity", () => {
  const source = "/toc\r\n\r\n# Root\r\n## Child\r\n";
  const first = command(source);
  const output = apply(source, first);
  assert.equal(first.headingCount, 2);
  assert.equal(output.replaceAll("\r\n", "").includes("\n"), false);
  assert.ok(output.endsWith("\r\n\r\n# Root\r\n## Child\r\n"));
  const refreshSource = "/outline\r\n" + output;
  const refresh = command(refreshSource, "/outline");
  assert.equal(refresh.updated, true);
  assert.equal(apply(refreshSource, refresh), output);
  assert.equal(output.slice(first.cursor - END.length, first.cursor), END);
});
test("display math cannot contribute headings or poison subsequent fence detection", () => {
  for (const eol of ["\n", "\r\n"]) {
    const source = [
      "$$",
      "# Fake",
      "```",
      "$$",
      "",
      "$$ x $$",
      "# Real",
      "```md",
      "# Code",
      "```",
      "# After",
    ].join(eol);
    assert.deepEqual(
      scanHeadings(source).map((h) => h.text),
      ["Real", "After"]
    );
    const indented = ["    $$", "    code", "", "# Real", "- Parent", "  $$", "", "# After"].join(
      eol
    );
    assert.deepEqual(
      scanHeadings(indented).map((h) => h.text),
      ["Real", "After"]
    );
  }
});
console.log(`${checks} outline checks passed.`);
