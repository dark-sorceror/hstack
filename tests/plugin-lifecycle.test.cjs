"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { EditorState, EditorSelection } = require("@codemirror/state");
const { EditorView } = require("@codemirror/view");

function loadCore(saved) {
  const filename = path.resolve(__dirname, "../src/plugin.js");
  const localRequire = createRequire(filename);
  const hooks = [],
    notices = [],
    extensions = [];
  class Plugin {
    constructor() {
      this.app = { workspace: { editorSuggest: { suggests: [] } }, vault: { adapter: {} } };
    }
    async loadData() {
      return saved;
    }
    register(callback) {
      hooks.push(callback);
    }
    registerEditorSuggest() {}
    registerEditorExtension(extension) {
      extensions.push(extension);
    }
    registerMarkdownPostProcessor() {}
    addSettingTab() {}
    addCommand() {}
  }
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    console,
    require(name) {
      if (name === "obsidian")
        return {
          Plugin,
          EditorSuggest: class {},
          Notice: class {
            constructor(message) {
              notices.push(message);
            }
          },
          parseYaml: JSON.parse,
        };
      if (name.startsWith("./ui/")) return class {};
      if (name === "./bundled-assets.js") return {};
      if (name === "./autocorrect/autocorrect.js") return { loadCorrector: async () => ({}) };
      return localRequire(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return {
    plugin: new module.exports.default(),
    unload: () => hooks.reverse().forEach((callback) => callback()),
    notices,
    extensions,
  };
}

test("saved templates are restored on startup, persist through reload, and unregister on unload", async () => {
  const saved = { templates: [{ name: "study", template: "## Questions\n- [ ] " }] };
  const first = loadCore(saved);
  await first.plugin.onload();
  assert.equal(first.plugin.slash.search("study")[0].id, "study");
  first.unload();
  assert.equal(first.plugin.slash.search("study").length, 0);
  const second = loadCore(saved);
  await second.plugin.onload();
  assert.equal(second.plugin.slash.search("study").length, 1);
  second.unload();
});

test("invalid saved templates do not prevent loading typing helpers or overwrite saved data", async () => {
  const saved = { templates: [{ name: "toc", template: "conflict" }] };
  const { plugin, notices, unload } = loadCore(saved);
  await plugin.onload();
  assert.equal(plugin.slash.search("toc")[0].id, "toc");
  assert.equal(notices.length, 1);
  assert.equal(saved.templates[0].name, "toc");
  unload();
});

test("input shortcuts defer to native editing with multiple cursors", async () => {
  const { plugin, extensions, unload } = loadCore({});
  await plugin.onload();
  try {
    plugin.inCode = () => false;
    for (const [token, typed] of [
      ["-", "-"],
      [".", "-"],
      [":smile", ":"],
    ]) {
      const text = token + "\n" + token;
      const view = {
        state: EditorState.create({
          doc: text,
          selection: EditorSelection.create([
            EditorSelection.cursor(token.length),
            EditorSelection.cursor(text.length),
          ]),
          extensions: [extensions, EditorState.allowMultipleSelections.of(true)],
        }),
        dispatch(spec) {
          this.state = this.state.update(spec).state;
        },
      };
      for (const handler of view.state.facet(EditorView.inputHandler))
        assert.equal(handler(view, token.length, token.length, typed), false, token);
      assert.equal(view.state.doc.toString(), text);
      view.dispatch(view.state.replaceSelection(typed));
      assert.equal(view.state.doc.toString(), token + typed + "\n" + token + typed);
      assert.equal(view.state.selection.ranges.length, 2);
    }
  } finally {
    unload();
  }
});
