"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const pathModule = require("node:path");
const { createAgentBridge, revision } = require("../src/agent/agent-bridge.js");
const outline = require("../src/features/outline.js");

function offset(text, pos) {
  return text.split("\n").slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch;
}
function position(text, at) {
  const lines = text.slice(0, at).split("\n");
  return { line: lines.length - 1, ch: lines.at(-1).length };
}
function makeEditor(textOrState, cursor = 0, selection = [cursor, cursor]) {
  const state = typeof textOrState === "string" ? { text: textOrState } : textOrState;
  const editor = {
    state, transactions: [],
    getValue: () => state.text,
    getCursor: () => position(state.text, cursor),
    listSelections: () => [{ anchor: position(state.text, selection[0]), head: position(state.text, selection[1]) }],
    posToOffset: pos => offset(state.text, pos), offsetToPos: at => position(state.text, at),
    transaction(change, origin) {
      editor.transactions.push({ change, origin });
      const edits = change.changes.map(e => ({ from: offset(state.text, e.from), to: offset(state.text, e.to), text: e.text }));
      for (const e of edits.sort((a, b) => b.from - a.from)) state.text = state.text.slice(0, e.from) + e.text + state.text.slice(e.to);
    },
    scrollIntoView(range) { editor.scrolled = range; }
  };
  return editor;
}
function fixture(contents, opened = {}, dependencies = {}) {
  const saved = new Map(Object.entries(contents)), files = new Map();
  for (const name of saved.keys()) files.set(name, { path: name, name: name.split("/").at(-1),
    basename: name.split("/").at(-1).slice(0, -3), extension: "md", stat: { mtime: 12345 } });
  const leaves = [];
  const addEditor = (name, editor) => {
    const leaf = { view: { file: files.get(name), editor, getMode: () => "source" } };
    leaves.push(leaf); return leaf;
  };
  for (const [name, editors] of Object.entries(opened)) for (const editor of [].concat(editors)) addEditor(name, editor);
  const state = { processCalls: 0, processHook: null, readHook: null, opened: [] };
  const vault = {
    adapter: {}, // Deliberately no getBasePath: supports non-filesystem adapters.
    getAbstractFileByPath: name => files.get(name),
    getMarkdownFiles: () => [...files.values()],
    async read(file) { if (state.readHook) await state.readHook(file); return saved.get(file.path); },
    async process(file, transform) {
      state.processCalls++;
      if (state.processHook) await state.processHook(file);
      const result = transform(saved.get(file.path));
      assert.equal(typeof result, "string", "Vault.process callback must be synchronous");
      saved.set(file.path, result);
    }
  };
  const app = {
    vault,
    workspace: {
      activeLeaf: leaves[0], activeEditor: leaves[0] ? { file: leaves[0].view.file, editor: leaves[0].view.editor } : null,
      getLeavesOfType: () => leaves,
      getLeaf: () => ({ view: {}, async openFile(file, options) {
        state.opened.push({ file, options }); this.view = { file, editor: makeEditor(saved.get(file.path)) };
      } })
    },
    metadataCache: {
      resolvedLinks: {},
      getFirstLinkpathDest(destination, source) {
        const value = destination.endsWith(".md") ? destination : destination + ".md";
        const folder = source.includes("/") ? source.slice(0, source.lastIndexOf("/") + 1) : "";
        return files.get(value) || files.get(folder + value) || [...files.values()].find(f => f.name === value) || null;
      }
    }
  };
  const bridge = createAgentBridge({ app, outline }, {
    nodePath: process.execPath, directory: pathModule.join(__dirname, "../src/agent"), parseYaml: JSON.parse, ...dependencies
  });
  let id = 0;
  const request = (method, params = {}) => bridge.request(JSON.parse(JSON.stringify({ apiVersion: 1, id: ++id, method, params })));
  return { bridge, app, saved, files, leaves, state, addEditor, request };
}
function ok(response) { assert.equal(response.ok, true, JSON.stringify(response)); return response.result; }
function error(response, code) { assert.equal(response.ok, false, JSON.stringify(response)); assert.equal(response.error.code, code); }

test("JSON envelope, capabilities, validation, and unload lifecycle", async () => {
  const f = fixture({ "One.md": "hello" });
  const response = await f.bridge.request({ apiVersion: 1, id: "request-7", method: "capabilities" });
  assert.equal(response.id, "request-7"); assert.equal(response.apiVersion, 1);
  assert.equal(ok(response).patch.dryRunDefault, true);
  error(await f.bridge.request({ apiVersion: 2, method: "context" }), "INVALID_REQUEST");
  error(await f.request("constructor"), "UNKNOWN_METHOD");
  error(await f.bridge.request({ method: "query", params: [] }), "INVALID_PARAMS");
  error(await f.request("context"), "NO_ACTIVE_NOTE");
  f.bridge.dispose(); error(await f.request("capabilities"), "BRIDGE_UNLOADED");
});

test("active context uses unsaved buffer, live headings, reverse selection, cursor and revision", async () => {
  const text = "# Working\nnew unsaved 😀 text\n## Details\nmore";
  const start = text.indexOf("unsaved"), end = start + "unsaved 😀".length;
  const editor = makeEditor(text, end, [end, start]);
  const f = fixture({ "Git/Notes.md": "# Saved\nstale" }, { "Git/Notes.md": editor });
  f.app.metadataCache.resolvedLinks = { "Index.md": { "Git/Notes.md": 1 } };
  const value = ok(await f.request("context"));
  assert.equal(value.source, "editor"); assert.equal(value.dirty, true);
  assert.equal(value.revision, revision(text)); assert.equal(value.text, text);
  assert.equal(value.selections[0].text, "unsaved 😀");
  assert.equal(value.selections[0].from, start); assert.equal(value.selections[0].to, end);
  assert.deepEqual(value.cursor, editor.getCursor());
  assert.deepEqual(value.headings.map(h => h.heading), ["Working", "Details"]);
  assert.deepEqual(value.backlinks, ["Index.md"]);
  assert.equal(value.backlinksSource, "saved-metadata-cache");
});

test("closed reads preserve heading bounds and require occurrence for duplicates", async () => {
  const text = "# Root\nintro\n## Same\nfirst\n### Child\nchild\n## Same\nsecond\n# End\nlast";
  const f = fixture({ "DSA/Tree.md": text });
  error(await f.request("readSection", { path: "DSA/Tree.md", heading: "Same" }), "AMBIGUOUS_TARGET");
  const first = ok(await f.request("readSection", { path: "DSA/Tree.md", heading: "Same", occurrence: 0 }));
  assert.equal(first.source, "vault"); assert.equal(first.text, "## Same\nfirst\n### Child\nchild\n");
  assert.deepEqual(first.headingPath, ["Root", "Same"]);
  const second = ok(await f.request("readSection", { path: "DSA/Tree.md", heading: "Same", occurrence: 1, maxChars: 8 }));
  assert.equal(second.text, "## Same\n"); assert.equal(second.truncated, true);
  assert.equal(second.sectionTo, text.indexOf("# End"));
  error(await f.request("readSection", { path: "DSA/Tree.md", from: -1 }), "INVALID_RANGE");
});

test("query uses live links, tags and JSON-compatible YAML properties, excluding protected text", async () => {
  const text = '---\n{"tags":["learning"],"status":"draft","rank":2}\n---\n# Compilers\n[[Target#API|target]] #cpp\n`[[Ghost]] #code`\n```text\n[[Other]] #hidden\n```\n';
  const f = fixture({ "CS/Compilers.md": "old", "Target.md": "# API\nTarget", ".private/Hidden.md": "secret" }, { "CS/Compilers.md": makeEditor(text) });
  const result = ok(await f.request("query", { text: "compilers", tag: "learning", linksTo: "Target.md", properties: { status: "draft", rank: 2 } }));
  assert.equal(result.matches.length, 1); assert.equal(result.matches[0].source, "editor");
  assert.equal(result.snapshotNotes, 2);
  const context = ok(await f.request("context"));
  assert.deepEqual(context.tags.sort(), ["#cpp", "#learning"]);
  assert.equal(context.links.length, 1); assert.equal(context.links[0].target, "Target.md");
  assert.equal(context.links[0].heading, "API");
  assert.equal(ok(await f.request("query", { tag: "code" })).matches.length, 0);
});

test("real SQL child receives unsaved snapshot and relational metadata with bound parameters", async () => {
  const content = '---\n{"tags":["study"],"status":"draft"}\n---\n# Live\nunsaved [[Target]]';
  const f = fixture({ "Notes.md": "saved", "Target.md": "# Target" }, { "Notes.md": makeEditor(content) });
  const result = ok(await f.request("sql", {
    sql: "SELECT n.path,n.source,n.content,t.tag,p.value_json,l.target FROM notes n JOIN tags t ON t.path=n.path JOIN properties p ON p.path=n.path AND p.key='status' JOIN links l ON l.source=n.path WHERE n.path=?",
    params: ["Notes.md"]
  }));
  assert.deepEqual(result.rows, [["Notes.md", "editor", content, "#study", '"draft"', "Target.md"]]);
  assert.equal(result.snapshot.notes, 2); assert.equal(result.readOnly, true);
  assert.match(result.capturedAt, /^\d{4}-\d\d-/);
  error(await f.request("sql", { sql: "DELETE FROM notes" }), "READ_ONLY_SQL");
  assert.equal(f.saved.get("Notes.md"), "saved");
});

test("SQL nonterminating recursive aggregate is killed within host budget", async () => {
  const f = fixture({ "One.md": "one" }, {}, { sqlTimeout: 100 });
  const started = Date.now();
  error(await f.request("sql", { sql: "WITH RECURSIVE forever(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM forever) SELECT sum(x) FROM forever" }), "SQL_TIMEOUT");
  assert.ok(Date.now() - started < 2000, "hard timeout must terminate the child");
});

test("patch previews by default and applies minimal transaction to current editor with revision guard", async () => {
  const text = "# Title\nhello world\ntrailing";
  const editor = makeEditor(text), f = fixture({ "One.md": "saved old" }, { "One.md": editor });
  const from = text.indexOf("world"), params = { path: "One.md", expectedRevision: revision(text), edits: [{ from, to: from + 5, text: "reader" }] };
  const preview = ok(await f.request("patch", params));
  assert.equal(preview.dryRun, true); assert.equal(preview.source, "editor");
  assert.equal(editor.getValue(), text); assert.equal(editor.transactions.length, 0);
  const applied = ok(await f.request("patch", { ...params, dryRun: false }));
  assert.equal(applied.revision, revision(text.replace("world", "reader")));
  assert.equal(editor.getValue(), text.replace("world", "reader"));
  assert.equal(editor.transactions.length, 1);
  assert.deepEqual(editor.transactions[0].change.changes, [{ from: { line: 1, ch: 6 }, to: { line: 1, ch: 11 }, text: "reader" }]);
  assert.equal(f.saved.get("One.md"), "saved old");
  error(await f.request("patch", { ...params, dryRun: false }), "REVISION_CONFLICT");
});

test("same-file editor views share a revision; divergent buffers reject all edits", async () => {
  const shared = { text: "one" }, first = makeEditor(shared), second = makeEditor(shared);
  const f = fixture({ "One.md": "one" }, { "One.md": [first, second] });
  const params = { path: "One.md", expectedRevision: revision("one"), dryRun: false, edits: [{ from: 0, to: 3, text: "two" }] };
  ok(await f.request("patch", params));
  assert.equal(first.getValue(), "two"); assert.equal(second.getValue(), "two");
  assert.equal(first.transactions.length, 1); assert.equal(second.transactions.length, 0);
  const divergent = makeEditor("different"); f.addEditor("One.md", divergent);
  error(await f.request("patch", { ...params, expectedRevision: revision("two") }), "DIVERGENT_EDITORS");
  assert.equal(first.getValue(), "two"); assert.equal(divergent.getValue(), "different");
});

test("closed-file process checks revision atomically and cannot lose a concurrent write", async () => {
  const f = fixture({ "One.md": "one" });
  const params = { path: "One.md", expectedRevision: revision("one"), dryRun: false, edits: [{ from: 0, to: 3, text: "two" }] };
  f.state.processHook = () => f.saved.set("One.md", "external edit");
  error(await f.request("patch", params), "REVISION_CONFLICT");
  assert.equal(f.saved.get("One.md"), "external edit");
  f.state.processHook = null;
  ok(await f.request("patch", { ...params, expectedRevision: revision("external edit"), edits: [{ from: 0, to: 8, text: "new" }] }));
  assert.equal(f.saved.get("One.md"), "new edit"); assert.equal(f.state.processCalls, 2);
});

test("closed-file patch rejects a newly opened source buffer before writing", async () => {
  const f = fixture({ "One.md": "one" });
  f.state.processHook = () => f.addEditor("One.md", makeEditor("unsaved"));
  error(await f.request("patch", { path: "One.md", expectedRevision: revision("one"), dryRun: false, edits: [{ from: 0, to: 3, text: "two" }] }), "SOURCE_CHANGED");
  assert.equal(f.saved.get("One.md"), "one");
});

test("invalid hidden, absolute, parent and instruction paths cannot be patched", async () => {
  const f = fixture({ "One.md": "one", "AGENTS.md": "rules" });
  for (const path of ["../One.md", "/One.md", ".obsidian/file.md", "Folder/.private.md", "Folder/../One.md", "Folder\\One.md", "One.md\0.md"])
    error(await f.request("readSection", { path }), "INVALID_PATH");
  error(await f.request("patch", { path: "AGENTS.md", expectedRevision: revision("rules"), edits: [{ from: 0, to: 0, text: "x" }] }), "INVALID_PATH");
  error(await f.request("patch", { path: "One.md", edits: [{ from: 0, to: 0, text: "x" }] }), "REVISION_REQUIRED");
  assert.equal(f.saved.get("AGENTS.md"), "rules");
});

test("filesystem adapter containment resolves symbolic links before accessing note content", async () => {
  const temporary = fs.mkdtempSync(pathModule.join(os.tmpdir(), "notes-agent-bridge-test-"));
  try {
    const base = pathModule.join(temporary, "vault"), outside = pathModule.join(temporary, "outside.md");
    fs.mkdirSync(base); fs.writeFileSync(pathModule.join(base, "One.md"), "one");
    fs.writeFileSync(outside, "outside"); fs.symlinkSync(outside, pathModule.join(base, "Escape.md"));
    const f = fixture({ "One.md": "one", "Escape.md": "must never read" });
    f.app.vault.adapter.getBasePath = () => base;
    const bridge = createAgentBridge({ app: f.app, outline }, { nodePath: process.execPath, directory: pathModule.join(__dirname, "../src/agent") });
    const read = value => bridge.request({ id: value, method: "readSection", params: { path: value } });
    assert.equal(ok(await read("One.md")).text, "one");
    error(await read("Escape.md"), "INVALID_PATH");
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("invalid frontmatter is explicit in context and rejects misleading query snapshots", async () => {
  const editor = makeEditor("---\nnot valid JSON\n---\n# Title\ntext");
  const f = fixture({ "One.md": "saved" }, { "One.md": editor });
  assert.equal(ok(await f.request("context")).propertiesError, "Frontmatter could not be parsed.");
  error(await f.request("query", { text: "text" }), "INVALID_FRONTMATTER");
});

test("Unicode UTF-16 edits preserve surrogate pairs and reject overlap", async () => {
  const f = fixture({ "Unicode.md": "a👍b" });
  const params = { path: "Unicode.md", expectedRevision: revision("a👍b"), dryRun: false };
  error(await f.request("patch", { ...params, edits: [{ from: 2, to: 2, text: "x" }] }), "INVALID_EDITS");
  error(await f.request("patch", { ...params, edits: [{ from: 0, to: 3, text: "x" }, { from: 1, to: 3, text: "y" }] }), "INVALID_EDITS");
  error(await f.request("patch", { ...params, edits: [{ from: 1, to: 1, text: "x" }, { from: 1, to: 1, text: "y" }] }), "INVALID_EDITS");
  ok(await f.request("patch", { ...params, edits: [{ from: 1, to: 3, text: "🙂" }] }));
  assert.equal(f.saved.get("Unicode.md"), "a🙂b");
});


test("agent bridge setting can disable reads/writes while leaving capability discovery", async () => {
  const f = fixture({"One.md":"hello"});
  const plugin = {app:f.app,outline,options:{agentBridge:false}};
  const bridge=createAgentBridge(plugin);
  const caps=await bridge.request({method:"capabilities"});
  assert.equal(caps.result.enabled,false);
  error(await bridge.request({method:"readSection",params:{path:"One.md"}}),"BRIDGE_DISABLED");
  plugin.options.agentBridge=true;
  assert.equal(ok(await bridge.request({method:"readSection",params:{path:"One.md"}})).text,"hello");
  bridge.dispose();
});
