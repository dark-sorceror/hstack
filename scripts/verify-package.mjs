import assert from "node:assert/strict";
import { readFile, mkdtemp, cp, rm, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));
assert.equal(manifest.version, pkg.version);
assert.match(manifest.id, /^[a-z][a-z0-9-]*$/);
assert.ok(!manifest.id.includes("obsidian"));
assert.ok(manifest.description.length <= 250 && manifest.description.endsWith("."));
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(manifest.isDesktopOnly, true);
const directory = await mkdtemp(path.join(tmpdir(), "hstack-install-"));
let plugin;
const hooks = [];
try {
  for (const name of ["main.js", "manifest.json", "styles.css"])
    await cp(name, path.join(directory, name));
  assert.deepEqual((await readdir(directory)).sort(), ["main.js", "manifest.json", "styles.css"]);
  class Plugin {
    constructor(app, manifest) {
      this.app = app;
      this.manifest = manifest;
    }
    async loadData() {
      return { templates: [{ name: "study", template: "## Questions\n- [ ] " }] };
    }
    async saveData() {}
    register(fn) {
      hooks.push(fn);
    }
    registerEditorSuggest() {}
    registerEditorExtension() {}
    registerMarkdownPostProcessor() {}
    addSettingTab() {}
    addCommand() {}
  }
  const obsidian = {
    Plugin,
    PluginSettingTab: class {},
    Setting: class {},
    EditorSuggest: class {
      constructor(app) {
        this.app = app;
      }
    },
    Notice: class {},
    Modal: class {},
    parseYaml: JSON.parse,
  };
  const bundle = { exports: {} };
  const source = await readFile(path.join(directory, "main.js"), "utf8");
  // An empty install directory: only host packages and Node builtins may resolve.
  vm.runInNewContext(
    source,
    {
      module: bundle,
      exports: bundle.exports,
      __dirname: directory,
      require: (name) => {
        assert.ok(
          !name.startsWith(".") && !path.isAbsolute(name),
          "Unbundled runtime dependency: " + name
        );
        return name === "obsidian" ? obsidian : require(name);
      },
      Buffer,
      process,
      TextDecoder,
      TextEncoder,
      WebAssembly,
      performance,
      setTimeout,
      clearTimeout,
      console,
    },
    { filename: path.join(directory, "main.js") }
  );
  const app = {
    vault: { adapter: {}, getMarkdownFiles: () => [] },
    workspace: { editorSuggest: { suggests: [] }, getLeavesOfType: () => [] },
    metadataCache: {},
  };
  plugin = new bundle.exports.default(app, manifest);
  await plugin.onload();
  assert.equal(plugin.api.version, 1);
  assert.equal(plugin.slash.search("study")[0].id, "study");
  const corrector = await plugin.autocorrectReady;
  assert.equal(corrector.stats.words, 82769);
  assert.equal(corrector.correctWord("teh"), "the");
  assert.ok(plugin.emoji.search("thumbs-up").some((e) => e.emoji === "👍"));
  const sql = await plugin.api.request({
    method: "sql",
    params: { sql: "SELECT count(*) AS notes FROM notes" },
  });
  assert.equal(sql.ok, true, JSON.stringify(sql));
  assert.deepEqual(JSON.parse(JSON.stringify(sql.result.rows)), [[0]]);
  const dispose = plugin.api.registerSlashCommand({
    id: "daily",
    name: "daily",
    description: "Test custom command",
    run() {},
  });
  assert.equal(plugin.slash.search("daily")[0].id, "daily");
  dispose();
  assert.equal(plugin.slash.search("daily").length, 0);
  console.log(
    "Three-file install verified: bundled JS, emoji, Rust/Wasm dictionary, isolated SQLite, and public API."
  );
} finally {
  for (const hook of hooks.reverse()) hook();
  await rm(directory, { recursive: true, force: true });
}
