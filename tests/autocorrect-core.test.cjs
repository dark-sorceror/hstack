"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

function referenceDistance(left, right) {
  const distance = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) distance[i][0] = i;
  for (let j = 0; j <= right.length; j++) distance[0][j] = j;
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
    distance[i][j] = Math.min(distance[i - 1][j] + 1, distance[i][j - 1] + 1,
      distance[i - 1][j - 1] + Number(left[i - 1] !== right[j - 1]));
    if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1])
      distance[i][j] = Math.min(distance[i][j], distance[i - 2][j - 2] + 1);
  }
  return distance[left.length][right.length];
}

async function main() {
  const binary = fs.readFileSync(path.join(__dirname, "../src/data/autocorrect.wasm"));
  const module = await WebAssembly.compile(binary);
  assert.deepEqual(WebAssembly.Module.imports(module), [], "Core must not need host imports");
  const { exports: core } = await WebAssembly.instantiate(module, {});
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const pointer = core.input_ptr();
  assert.ok(core.input_capacity() >= 128);
  function input(text) {
    const bytes = encoder.encode(text);
    assert.ok(bytes.length <= core.input_capacity());
    new Uint8Array(core.memory.buffer, pointer, bytes.length).set(bytes);
    return bytes.length;
  }
  function add(text, frequency) { return core.add_word(pointer, input(text), frequency); }
  function word(id) {
    return id < 0 ? null : decoder.decode(new Uint8Array(core.memory.buffer, core.word_ptr(id), core.word_len(id)));
  }
  function lookup(text, limit = 1) {
    const length = input(text);
    return word(limit === 1 ? core.lookup(pointer, length) : core.lookup_with_limit(pointer, length, limit));
  }
  function known(text) { return core.known(pointer, input(text)); }
  let checks = 0;
  function test(name, callback) { callback(); checks++; console.log("✓ " + name); }

  test("dictionary input is bounded and duplicate IDs remain stable", () => {
    core.reset();
    assert.equal(core.add_word(pointer + 1, 3, 1), -1);
    assert.equal(add("", 1), -1);
    assert.equal(add("x".repeat(33), 1), -1);
    assert.equal(add("café", 1), -1);
    assert.equal(add("word", NaN), -1);
    assert.equal(add("word", Infinity), -1);
    assert.equal(add("word", -1), -1);
    const id = add("THE", 1000);
    assert.equal(add("the", 900), id);
    assert.equal(core.word_frequency(id), 1000);
    assert.equal(add("the", 1200), id);
    assert.equal(core.word_frequency(id), 1200);
    assert.equal(core.word_count(), 1);
    assert.equal(known("The"), 1);
    assert.equal(core.word_ptr(-1), 0);
    assert.equal(core.word_len(999), 0);
  });
  test("known words are never proposed as corrections", () => {
    core.build_index();
    assert.equal(lookup("the"), null);
    assert.equal(core.lookup_distance(), 0);
    assert.equal(core.candidate_count(), 0);
  });
  test("substitution, insertion, deletion and transposition find exact one-edit candidates", () => {
    for (const [target, query] of [["hello", "hallo"], ["hello", "helo"], ["hello", "helllo"], ["the", "teh"], ["letter", "leter"]]) {
      core.reset(); add(target, 100); core.build_index();
      assert.equal(lookup(query), target, query);
      assert.equal(core.lookup_distance(), 1);
      assert.equal(core.candidate_count(), 1);
    }
  });
  test("prefix-boundary and suffix edits are not lost by the seven-character index", () => {
    const target = "abcdefghij";
    for (const query of ["abcdefhgij", "abcdefxghij", "abcdefhij", "abcdefghix", "abcdefghijkl"]) {
      core.reset(); add(target, 100); core.build_index();
      assert.equal(lookup(query), referenceDistance(target, query) === 1 ? target : null, query);
    }
    const longest = "abcdefghijklmnopqrstuvwxyzabcdef";
    core.reset(); add(longest, 1); core.build_index();
    assert.equal(lookup(longest.slice(0, 31)), longest);
  });
  test("repeated deletion signatures do not inflate candidate counts", () => {
    core.reset(); add("aaaaaa", 5); core.build_index();
    assert.equal(lookup("aaaaa"), "aaaaaa");
    assert.equal(core.candidate_count(), 1);
    assert.equal(core.examined_count(), 1);
  });
  test("best and runner-up frequencies reflect distinct verified candidates", () => {
    core.reset();
    for (const [text, frequency] of [["the", 1000], ["ten", 800], ["tea", 700], ["then", 600]]) add(text, frequency);
    core.build_index();
    assert.equal(lookup("teh"), "the");
    assert.equal(word(core.second_id()), "ten");
    assert.equal(core.second_frequency(), 800);
    assert.equal(core.candidate_count(), 3);
    assert.equal(lookup("zzzzzz"), null);
    assert.equal(core.lookup_distance(), -1);
    assert.equal(core.second_frequency(), 0);
  });
  test("the index agrees with independent Damerau distance for exhaustive small words", () => {
    const all = [];
    function generate(prefix) {
      if (prefix) all.push(prefix);
      if (prefix.length === 4) return;
      for (const char of "abc") generate(prefix + char);
    }
    generate("");
    const entries = all.filter((_, index) => index % 3 === 0).map((text, index) => [text, index + 1]);
    core.reset(); for (const entry of entries) add(...entry); core.build_index();
    for (const query of all) {
      const expected = entries.some(([text]) => text === query) ? null :
        entries.filter(([text]) => referenceDistance(query, text) === 1).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      assert.equal(lookup(query), expected, query);
    }
  });
  test("new words invalidate the index and reset preserves the owned input pointer", () => {
    core.reset(); add("hello", 1); core.build_index(); add("world", 2);
    assert.equal(lookup("wrold"), null);
    assert.equal(core.last_error(), -3);
    core.build_index(); assert.equal(lookup("wrold"), "world");
    core.reset(); assert.equal(core.input_ptr(), pointer); assert.equal(core.word_count(), 0);
  });
  test("distance two handles realistic errors while preserving the distance-one ABI", () => {
    for (const [target, query] of [["correction", "corecton"], ["because", "becuasee"],
      ["algorithm", "algortihmm"], ["accommodate", "accomadate"],
      ["definitely", "definitlely"], ["environment", "envromnent"], ["language", "langauge"]]) {
      const expectedDistance = referenceDistance(target, query);
      assert.ok(expectedDistance <= 2, query);
      core.reset(); add(target, 100); core.build_index();
      assert.equal(lookup(query, 2), target, query);
      assert.equal(core.lookup_distance(), expectedDistance);
      assert.equal(lookup(query), expectedDistance === 1 ? target : null, "distance-one ABI: " + query);
    }
  });
  test("distance-two signatures cover prefix boundaries and repeated characters", () => {
    const target = "abcdefghij";
    for (const query of ["bacdefhgij", "bcdefhij", "abxcdxefghij", "abcdxxghij", "abcdefgxyj", "badcfeghij"]) {
      core.reset(); add(target, 10); core.build_index();
      const distance = referenceDistance(target, query);
      assert.equal(lookup(query, 2), distance <= 2 ? target : null, query);
      assert.equal(core.lookup_distance(), distance <= 2 ? distance : -1);
    }
    core.reset(); add("committee", 20); core.build_index();
    assert.equal(lookup("comitee", 2), "committee");
    assert.equal(core.lookup_distance(), 2);
    assert.equal(core.candidate_count(), 1);
  });
  test("distance wins over frequency and runner-up/count use only that distance", () => {
    core.reset(); add("cat", 10); add("cats", 1000); add("bat", 500); core.build_index();
    assert.equal(lookup("cot", 2), "cat");
    assert.equal(core.lookup_distance(), 1);
    assert.equal(core.candidate_count(), 1);
    assert.equal(core.second_frequency(), 0);
    assert.equal(lookup("co", 2), "cat");
    assert.equal(core.lookup_distance(), 2);
    assert.equal(lookup("co"), null);
    assert.equal(core.lookup(pointer, input("cat")), -1);
    assert.equal(core.lookup_distance(), 0);
    assert.equal(core.lookup_with_limit(pointer, input("cot"), 3), -1);
    assert.equal(core.last_error(), -1);
  });
  test("distance two agrees exhaustively with independent OSA distance", () => {
    const all = [];
    function generate(prefix) {
      if (prefix) all.push(prefix);
      if (prefix.length === 5) return;
      for (const char of "abc") generate(prefix + char);
    }
    generate("");
    const entries = all.filter((_, index) => index % 5 === 0).map((text, index) => [text, index + 1]);
    core.reset(); for (const entry of entries) add(...entry); core.build_index();
    for (const query of all) {
      if (entries.some(([text]) => text === query)) {
        assert.equal(lookup(query, 2), null, query);
        assert.equal(core.lookup_distance(), 0);
        continue;
      }
      const candidates = entries.map(([text, frequency]) => ({ text, frequency, distance: referenceDistance(query, text) }))
        .filter(value => value.distance <= 2).sort((a, b) => a.distance - b.distance || b.frequency - a.frequency);
      const best = candidates[0];
      assert.equal(lookup(query, 2), best?.text || null, query);
      assert.equal(core.lookup_distance(), best?.distance ?? -1, query);
      const closest = candidates.filter(value => value.distance === best?.distance);
      assert.equal(core.candidate_count(), closest.length, query);
      assert.equal(core.second_frequency(), closest[1]?.frequency || 0, query);
    }
  });

  const corpusPath = path.join(__dirname, "../src/data/autocorrect-frequency.txt");
  if (fs.existsSync(corpusPath)) {
    const entries = fs.readFileSync(corpusPath, "utf8").trim().split(/\r?\n/).map(line => {
      const [text, frequency] = line.trim().split(/\s+/);
      return [text, Number(frequency)];
    }).filter(([text, frequency]) => /^[a-z'-]{1,32}$/.test(text) && Number.isFinite(frequency) && frequency >= 0);
    for (const size of [...new Set([Math.min(50_000, entries.length), Math.min(80_000, entries.length), entries.length])]) {
      core.reset();
      const loading = performance.now();
      for (const entry of entries.slice(0, size)) assert.ok(add(...entry) >= 0);
      const indexStart = performance.now();
      const signatures = core.build_index();
      const built = performance.now();
      assert.ok(signatures >= 0);
      const memory = core.memory.buffer.byteLength;
      const probes = ["teh", "adn", "thsi", "recieve", "seperate", "definately", "becuase", "wrold", "accomadate", "envromnent", "abcdefghqz", "hello"];
      const timings = {};
      for (const limit of [1, 2]) {
        const samples = [];
        for (let i = 0; i < 5000; i++) {
          const query = probes[i % probes.length];
          const start = performance.now(); lookup(query, limit); samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        timings[`lookup${limit}MedianMs`] = +samples[2500].toFixed(4);
        timings[`lookup${limit}P95Ms`] = +samples[4750].toFixed(4);
      }
      assert.equal(core.memory.buffer.byteLength, memory, "Lookup must not grow memory");
      assert.ok(memory <= 64 * 1024 * 1024);
      console.log(JSON.stringify({ benchmarkWords: size, signatures,
        loadMs: +(indexStart - loading).toFixed(2), buildMs: +(built - indexStart).toFixed(2),
        ...timings,
        memoryMiB: memory / 1024 / 1024 }));
    }
  } else console.log("Corpus benchmark skipped: autocorrect-frequency.txt is not present yet.");
  console.log(`${checks} Rust/Wasm correctness checks passed; binary ${binary.length} bytes.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
