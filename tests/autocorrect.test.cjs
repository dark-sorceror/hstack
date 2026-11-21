"use strict";
const assert = require("node:assert/strict");
const { loadCorrector, boundaryPlan } = require("../src/autocorrect/autocorrect.js");
const { revertPlan } = require("../src/features/logic.js");
const typos = require("../src/data/autocorrect-typos.json");

(async () => {
  const corrector = await loadCorrector(require("node:path").join(__dirname, "../src/data"));
  let checks = 0;
  function test(name, fn) {
    fn();
    checks++;
    console.log("✓ " + name);
  }
  test("the bundled Rust/Wasm engine loads the complete English dictionary", () => {
    assert.equal(corrector.stats.backend, "Rust / WebAssembly");
    assert.equal(corrector.stats.words, 82769);
    assert.ok(corrector.stats.signatures > corrector.stats.words);
  });
  test("all curated obvious typos correct with initial capitalization preserved", () => {
    for (const [word, expected] of Object.entries(typos)) {
      assert.equal(corrector.correctWord(word), expected, word);
      assert.equal(
        corrector.correctWord(word[0].toUpperCase() + word.slice(1)),
        expected[0].toUpperCase() + expected.slice(1),
        word
      );
    }
  });
  test("valid English words, names, acronyms and technical terms are preserved", () => {
    for (const word of [
      "their",
      "there",
      "form",
      "from",
      "its",
      "colour",
      "favourite",
      "Python",
      "python",
      "rustc",
      "numpy",
      "SQL",
      "JSON",
      "Obsidian",
      "haoyan",
      "Zylar",
      "camelCase",
      "snake_case",
      "THIER",
      "naïve",
      "résumé",
      "zzzzzzzz",
    ]) {
      assert.equal(corrector.correctWord(word), null, word);
    }
  });
  test("dictionary inference corrects clear new typos and leaves ambiguous candidates alone", () => {
    for (const [word, expected] of [
      ["capturre", "capture"],
      ["applcation", "application"],
      ["algoritm", "algorithm"],
      ["comptuer", "computer"],
    ])
      assert.equal(corrector.correctWord(word), expected, word);
    assert.equal(corrector.correctWord("speeling"), "spelling");
    assert.equal(corrector.correctWord("poan"), null);
  });
  test("short typing mistakes from the user's sample now correct", () => {
    for (const [word, expected] of [
      ["tesr", "test"],
      ["testr", "test"],
      ["teste", "test"],
      ["testeds", "tested"],
      ["assetr", "assets"],
    ])
      assert.equal(corrector.correctWord(word), expected, word);
    for (const word of [
      "test",
      "tests",
      "assets",
      "pan",
      "awn",
      "pawn",
      "dawn",
      "tested",
      "waewqrioe",
      "erkj",
      "awnm",
    ])
      assert.equal(corrector.correctWord(word), null, word);
  });
  test("long unique and two-edit misspellings are recoverable", () => {
    for (const [word, expected] of [
      ["gltichy", "glitchy"],
      ["accomadate", "accommodate"],
      ["envromnent", "environment"],
    ])
      assert.equal(corrector.correctWord(word), expected, word);
  });
  test("sentence-initial capitalization is preserved without changing names inside prose", () => {
    for (const text of [
      "Applcation",
      "- Applcation",
      "After a sentence. Applcation",
      "**Applcation",
    ])
      assert.equal(boundaryPlan(text, text.length, corrector).insert, "Application ", text);
    assert.equal(boundaryPlan("We met Applcation", 17, corrector), null);
    assert.equal(corrector.correctWord("Applcation"), null);
  });
  test("a Space correction includes exactly one space and retains punctuation", () => {
    assert.deepEqual(boundaryPlan("I recieve,", 10, corrector), {
      from: 2,
      to: 10,
      insert: "receive, ",
      raw: "recieve,",
      original: "recieve",
    });
    assert.equal(boundaryPlan("**teh", 5, corrector).insert, "the ");
    assert.equal(boundaryPlan("* item wiht", 11, corrector).insert, "with ");
  });
  test("repeated spaces never produce another correction or any tab", () => {
    for (let count = 1; count < 40; count++) {
      const text = "teh" + " ".repeat(count);
      assert.equal(boundaryPlan(text, text.length, corrector), null);
    }
  });
  test("code, YAML, math, URLs, identifiers and incomplete links stay literal", () => {
    for (const text of [
      "`teh",
      "```python\nteh",
      "---\nname: teh",
      "$teh",
      "$$\nteh",
      "<!-- teh",
      "    teh",
      "\tteh",
      "https://teh",
      "www.teh",
      "person@teh",
      "snake_teh",
      "file.teh",
      "[[teh",
      "![teh",
      "[label](teh",
      "<tag teh",
      "don't",
      "foo/teh",
    ]) {
      assert.equal(boundaryPlan(text, text.length, corrector), null, text);
    }
    assert.equal(boundaryPlan("tehthing", 3, corrector), null);
  });
  test("a nested dot list still receives prose corrections", () => {
    const text = "1. Parent\n\t* recieve";
    assert.equal(boundaryPlan(text, text.length, corrector).insert, "receive ");
  });
  test("immediate Backspace restores original spelling and removes the trigger space", () => {
    const plan = boundaryPlan("recieve", 7, corrector);
    const record = {
      from: plan.from,
      to: plan.from + plan.insert.length,
      text: plan.insert,
      raw: plan.raw,
    };
    assert.deepEqual(revertPlan(plan.insert, record.to, record), {
      from: 0,
      to: 8,
      insert: "recieve",
    });
    assert.equal(revertPlan(plan.insert + "x", record.to + 1, record), null);
  });
  test("rejected spellings stay unchanged for this session", () => {
    corrector.reject("recieve");
    assert.equal(corrector.correctWord("recieve"), null);
    assert.equal(corrector.correctWord("Recieve"), null);
    assert.equal(corrector.correctWord("seperate"), "separate");
  });
  test("the personal dictionary takes precedence over correction rules", () => {
    corrector.setPersonalWords(["thier", "customterm"]);
    assert.equal(corrector.correctWord("thier"), null);
    corrector.setPersonalWords([]);
    assert.equal(corrector.correctWord("thier"), "their");
  });

  // Include token extraction and protected-context checking in this boundary
  // benchmark, not only a warmed dictionary/cache lookup.
  const note = "An ordinary paragraph about writing clear technical notes.\n".repeat(3500);
  const samples = [];
  for (let index = 0; index < 220; index++) {
    const text = note + (index % 2 ? "definately" : "slgihtly");
    const start = performance.now();
    boundaryPlan(text, text.length, corrector);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      checks,
      ...corrector.stats,
      noteCharacters: note.length,
      boundaryP50Ms: samples[110],
      boundaryP95Ms: samples[209],
      wasmMemoryMiB: corrector.core.memory.buffer.byteLength / 1048576,
    })
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
