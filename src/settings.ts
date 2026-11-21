import type { FeatureFlag, HstackSettings } from "./settings-types.js";

// Persisted template entries stay untrusted until restoreTemplates validates them.
export type StoredSettings = Omit<HstackSettings, "templates"> & { templates: unknown[] };

const FLAGS: readonly FeatureFlag[] = Object.freeze([
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

function usageMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, count]) => typeof count === "number" && Number.isFinite(count) && count >= 0
    )
  );
}

/** Normalize persisted settings without changing valid preferences. */
export function normalizeSettings(saved: unknown): StoredSettings {
  const data = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const fields = data as Record<string, unknown>;
  const options: StoredSettings = {
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

/** A single write queue prevents settings/usage updates overtaking each other. */
export function createSettingsSaver(plugin: {
  options: StoredSettings;
  saveData(data: StoredSettings): Promise<void>;
}): () => Promise<void> {
  let pending = Promise.resolve();
  return () => {
    const snapshot: StoredSettings = JSON.parse(JSON.stringify(plugin.options));
    const next = pending.catch(() => {}).then(() => plugin.saveData(snapshot));
    pending = next;
    return next;
  };
}
