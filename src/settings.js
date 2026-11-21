// @ts-check
"use strict";

/** @typedef {import("./settings-types").HstackSettings} Settings */
/** @type {readonly import("./settings-types").FeatureFlag[]} */
const FLAGS = Object.freeze([
  "mixedLists",
  "literalSpaces",
  "typography",
  "listShortcuts",
  "listStyles",
  "underline",
  "emoji",
  "formatPairs",
  "autocorrect",
  "calloutPaste",
  "slash",
  "agentBridge",
]);

/** @param {unknown} value @returns {Record<string, number>} */
function usageMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, count]) => typeof count === "number" && Number.isFinite(count) && count >= 0
    )
  );
}

/** Normalize only persisted settings; valid user preferences retain their meaning.
 * @param {unknown} saved @returns {Settings}
 */
function normalizeSettings(saved) {
  const data = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  /** @type {Record<string, unknown>} */
  const fields = /** @type {Record<string, unknown>} */ (data);
  /** @type {Settings} */
  const options = {
    mixedLists: true,
    literalSpaces: true,
    typography: true,
    listShortcuts: true,
    listStyles: true,
    underline: true,
    emoji: true,
    formatPairs: true,
    autocorrect: true,
    calloutPaste: true,
    slash: true,
    agentBridge: true,
    autocorrectWords: [],
    slashUsage: {},
    emojiUsage: {},
    templates: [],
    sqlNodePath: "",
  };
  for (const flag of FLAGS) if (typeof fields[flag] === "boolean") options[flag] = fields[flag];
  options.autocorrectWords = Array.isArray(fields.autocorrectWords)
    ? fields.autocorrectWords.filter((word) => typeof word === "string")
    : [];
  options.slashUsage = usageMap(fields.slashUsage);
  options.emojiUsage = usageMap(fields.emojiUsage);
  // Template validation/restoration reports invalid entries without mutating disk.
  options.templates = Array.isArray(fields.templates) ? fields.templates : [];
  options.sqlNodePath = typeof fields.sqlNodePath === "string" ? fields.sqlNodePath : "";
  return options;
}

/** A single write queue prevents settings/usage updates overtaking each other.
 * @param {{options: Settings, saveData:(data:Settings)=>Promise<void>}} plugin
 */
function createSettingsSaver(plugin) {
  let pending = Promise.resolve();
  return () => {
    /** @type {Settings} */
    const snapshot = JSON.parse(JSON.stringify(plugin.options));
    const next = pending.catch(() => {}).then(() => plugin.saveData(snapshot));
    pending = next;
    return next;
  };
}

module.exports = { normalizeSettings, createSettingsSaver };
