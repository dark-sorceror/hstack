"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function loadCore(saved) {
  const filename = path.resolve(__dirname, "../src/plugin.js");
  const localRequire = createRequire(filename);
  const hooks = [],
    notices = [];
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
    registerEditorExtension() {}
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
    plugin: new module.exports(),
    unload: () => hooks.reverse().forEach((callback) => callback()),
    notices,
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
