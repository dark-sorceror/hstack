"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { normalizeSettings, createSettingsSaver } = require("../src/settings.js");
test("settings normalization preserves valid preferences and isolates mutable defaults", () => {
  const first = normalizeSettings({
    autocorrect: false,
    templates: [{ name: "daily", template: "x" }],
    slashUsage: { toc: 4 },
  });
  assert.equal(first.autocorrect, false);
  assert.equal(first.templates[0].name, "daily");
  first.emojiUsage["👍"] = 1;
  assert.deepEqual(normalizeSettings({}).emojiUsage, {});
  assert.deepEqual(
    normalizeSettings({ slashUsage: [], autocorrectWords: [1, "sql"] }).autocorrectWords,
    ["sql"]
  );
});
test("settings writes are serialized snapshots and recover after a failed write", async () => {
  const snapshots = [],
    resolvers = [];
  const plugin = {
    options: normalizeSettings({}),
    saveData: (data) =>
      new Promise((resolve) => {
        snapshots.push(data);
        resolvers.push(resolve);
      }),
  };
  const save = createSettingsSaver(plugin);
  plugin.options.slashUsage.toc = 1;
  const first = save();
  plugin.options.slashUsage.toc = 2;
  const second = save();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].slashUsage.toc, 1);
  resolvers.shift()();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots[1].slashUsage.toc, 2);
  resolvers.shift()();
  await second;
  let calls = 0;
  const recovery = createSettingsSaver({
    options: plugin.options,
    saveData: async () => {
      if (!calls++) throw Error("disk");
    },
  });
  await assert.rejects(recovery(), /disk/);
  await recovery();
  assert.equal(calls, 2);
});
