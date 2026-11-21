import type {
  App,
  Editor,
  EditorPosition,
  EditorSuggest as NativeEditorSuggest,
  EditorSuggestContext,
} from "obsidian";
import type { EditorView } from "@codemirror/view";

export interface EmojiRecord {
  emoji: string;
  aliases: string[];
  description?: string;
  tags?: string[];
}
export interface EmojiEntry {
  emoji: string;
  name: string;
  aliases: string[];
  description: string;
  tags: string[];
  searchText: string;
}
export interface EmojiIndex {
  entries: EmojiEntry[];
  aliases: Map<string, EmojiEntry>;
  popular: EmojiEntry[];
}
export interface EmojiHost {
  options: { emoji?: boolean; emojiUsage?: Record<string, number> };
  logic: { protectedContext(text: string, position: number): boolean };
  inCode(view: EditorView, position: number): boolean;
  recordEmoji?(emoji: string): void;
}

import { editorView } from "../editor/adapter.js";
import records from "../data/emoji-data.json";
import { protectedContext } from "./logic.js";

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9+-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildIndex(data: EmojiRecord[] = records): EmojiIndex {
  const aliases = new Map<string, EmojiEntry>();
  const byEmoji = new Map<string, EmojiEntry>();
  const entries: EmojiEntry[] = [];
  const friendlyNames: Record<string, string> = { "👍": "thumbs-up", "👎": "thumbs-down" };
  for (const record of data) {
    if (typeof record.emoji !== "string" || !Array.isArray(record.aliases)) continue;
    const names = new Set(record.aliases.map(normalize));
    const descriptionName = normalize(record.description);
    if (descriptionName) names.add(descriptionName);
    const name = friendlyNames[record.emoji] || normalize(record.aliases[0]) || descriptionName;
    if (!name) continue;
    names.add(name);
    const entry: EmojiEntry = {
      emoji: record.emoji,
      name,
      aliases: [...names],
      description: record.description || name,
      tags: (record.tags || []).map(normalize),
      searchText: "",
    };
    entry.searchText = [entry.name, ...entry.aliases, ...entry.tags, descriptionName].join(" ");
    entries.push(entry);
    byEmoji.set(entry.emoji, entry);
    // Prefer established gemoji aliases over a later descriptive alias collision.
    for (const alias of entry.aliases) if (!aliases.has(alias)) aliases.set(alias, entry);
  }
  const popular = [
    "👍",
    "👎",
    "😀",
    "😊",
    "❤️",
    "✅",
    "🔥",
    "🚀",
    "👀",
    "🎉",
    "🤔",
    "💡",
    "⚠️",
    "🙌",
    "👏",
    "🙏",
    "💪",
    "🐛",
    "📌",
    "📝",
    "🎯",
    "⭐",
    "💯",
  ]
    .map((emoji) => byEmoji.get(emoji))
    .filter((entry): entry is EmojiEntry => Boolean(entry));
  return { entries, aliases, popular };
}

const defaultIndex = buildIndex();

function usageCount(usage: Record<string, number> | undefined, emoji: string) {
  const count = Number(usage?.[emoji]);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function search(
  query: string,
  index = defaultIndex,
  limit = 30,
  usage: Record<string, number> = {}
) {
  const normalized = normalize(query);
  if (!normalized) {
    const used = new Set<string>();
    return [...index.popular, ...index.entries]
      .filter((entry) => {
        if (used.has(entry.emoji)) return false;
        used.add(entry.emoji);
        return true;
      })
      .map((entry, order) => ({ entry, order, usage: usageCount(usage, entry.emoji) }))
      .sort((a, b) => b.usage - a.usage || a.order - b.order)
      .slice(0, limit)
      .map((result) => result.entry);
  }
  const terms = normalized.split("-").filter(Boolean);
  return index.entries
    .map((entry, order) => {
      let score = Infinity;
      if (entry.aliases.includes(normalized)) score = 0;
      else if (entry.aliases.some((alias) => alias.startsWith(normalized))) score = 1;
      else if (entry.aliases.some((alias) => alias.includes(normalized))) score = 2;
      else if (terms.every((term) => entry.searchText.includes(term))) score = 3;
      return { entry, score, order, usage: usageCount(usage, entry.emoji) };
    })
    .filter((result) => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || b.usage - a.usage || a.order - b.order)
    .slice(0, limit)
    .map((result) => result.entry);
}

function triggerAt(line: string, column: number) {
  const before = line.slice(0, column);
  const match = /:([a-z0-9_+-]*)$/i.exec(before);
  if (!match) return null;
  const start = column - match[0].length;
  const prefix = before.slice(0, start);
  if (
    /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)\S*$/i.test(before) ||
    /(?:^|\s)(?:https?|ftp|file|obsidian)$/i.test(prefix) ||
    (/\b\d{1,2}$/.test(prefix) && /^\d*$/.test(match[1]!))
  )
    return null;
  return { column: start, query: match[1]! };
}

function directCompletion(
  text: string,
  from: number,
  to: number,
  typed: string,
  index = defaultIndex
) {
  if (from !== to || typed !== ":" || protectedContext(text, from)) return null;
  const before = text.slice(0, from);
  const match = /:([a-z0-9_+-]+)$/i.exec(before);
  if (!match) return null;
  const entry = index.aliases.get(normalize(match[1]));
  if (!entry) return null;
  const start = from - match[0].length;
  if (/(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)\S*$/i.test(before)) return null;
  return { from: start, to, insert: entry.emoji };
}

function createEmojiSuggest(
  app: App,
  plugin: EmojiHost,
  EditorSuggest: typeof NativeEditorSuggest<EmojiEntry>
) {
  return new (class NotesEmojiSuggest extends EditorSuggest {
    index: EmojiIndex;
    constructor() {
      super(app);
      this.limit = 30;
      this.index = defaultIndex;
    }

    onTrigger(cursor: EditorPosition, editor: Editor) {
      if (plugin.options.emoji === false || editor.listSelections?.().length > 1) return null;
      const trigger = triggerAt(editor.getLine(cursor.line), cursor.ch);
      if (!trigger) return null;
      const text = editor.getValue();
      const position = editor.posToOffset(cursor);
      if (plugin.logic.protectedContext(text, position)) return null;
      if (editorView(editor) && plugin.inCode(editorView(editor)!, position)) return null;
      return {
        start: { line: cursor.line, ch: trigger.column },
        end: cursor,
        query: trigger.query,
      };
    }

    getSuggestions(context: EditorSuggestContext) {
      return search(context.query, this.index, this.limit, plugin.options.emojiUsage);
    }

    renderSuggestion(value: EmojiEntry, element: HTMLElement) {
      element.classList.add("notes-emoji-suggestion");
      const document = element.ownerDocument;
      const glyph = document.createElement("span");
      glyph.className = "notes-emoji-glyph";
      glyph.textContent = value.emoji;
      glyph.setAttribute("aria-hidden", "true");
      const details = document.createElement("span");
      details.className = "notes-emoji-details";
      const name = document.createElement("span");
      name.className = "notes-emoji-name";
      name.textContent = `:${value.name}:`;
      const description = document.createElement("span");
      description.className = "notes-emoji-description";
      description.textContent = value.description;
      details.append(name, description);
      element.append(glyph, details);
    }

    selectSuggestion(value: EmojiEntry) {
      const context = this.context;
      if (!context || plugin.options.emoji === false) return;
      const { editor, start } = context;
      if (editor.listSelections?.().length > 1) return;
      const end = { ...context.end };
      const line = editor.getLine(start.line);
      const candidate = line.slice(start.ch, end.ch);
      // A direct :shortcode: replacement may already have closed this menu.
      // Never replace unrelated text using a stale suggestion context.
      if (end.line !== start.line || !/^:[a-z0-9_+-]*:?$/i.test(candidate)) return;
      if (line[end.ch] === ":") end.ch++;
      editor.replaceRange(value.emoji, start, end);
      editor.setCursor({ line: start.line, ch: start.ch + value.emoji.length });
      plugin.recordEmoji?.(value.emoji);
      this.close();
    }
  })();
}

export {
  normalize,
  buildIndex,
  search,
  triggerAt,
  directCompletion,
  createEmojiSuggest,
  defaultIndex,
};
