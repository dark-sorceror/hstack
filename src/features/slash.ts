import type {
  App,
  Editor,
  EditorPosition,
  EditorSuggest as NativeEditorSuggest,
  EditorSuggestContext,
} from "obsidian";
import type { EditorView } from "@codemirror/view";
import type { SlashCommand } from "../api.js";

export interface RegistryCommand {
  id: string;
  name: string;
  aliases: readonly string[];
  icon: string;
  description: string;
  run?: SlashCommand["run"];
}
export interface SlashHost {
  options: { slash?: boolean; slashUsage?: Record<string, number> };
  logic: { protectedContext(text: string, position: number): boolean };
  slash?: { commands: readonly RegistryCommand[] };
  inCode(view: EditorView, position: number): boolean;
  recordSlash?(id: string): void;
  runSlashCommand?(id: string, context: EditorSuggestContext, editor: Editor): void | Promise<void>;
}

// The plugin injects native EditorSuggest so this module also works in Node.
import { editorView, highlightedSuggestion } from "../editor/adapter.js";
import { commands } from "../commands/catalog.js";

function usageCount(usage: Record<string, number> | undefined, id: string) {
  const value = Number(usage?.[id]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function search(
  query = "",
  usage: Record<string, number> = {},
  source: readonly RegistryCommand[] = commands
) {
  const normalized = String(query).toLowerCase().replace(/^\//, "");
  if (!/^[a-z-]*$/.test(normalized)) return [];
  return source
    .map((command, order) => {
      const names = [command.name, ...command.aliases];
      const score =
        !normalized || names.includes(normalized)
          ? 0
          : names.some((name) => name.startsWith(normalized))
            ? 1
            : Infinity;
      return { command, order, score, count: usageCount(usage, command.id) };
    })
    .filter((result) => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || b.count - a.count || a.order - b.order)
    .map((result) => result.command);
}

function triggerAt(line: string, column: number, source: readonly RegistryCommand[] = commands) {
  if (!Number.isInteger(column) || column < 0 || column > line.length) return null;
  const match = /^([ \t]*)\/([a-z-]*)$/i.exec(line.slice(0, column));
  if (!match || !/^[ \t]*$/.test(line.slice(column))) return null;
  if (!search(match[2], {}, source).length) return null;
  return { column: match[1]!.length, query: match[2]! };
}

function createSlashSuggest(
  app: App,
  plugin: SlashHost,
  EditorSuggest: typeof NativeEditorSuggest<RegistryCommand>
) {
  const source = () => plugin.slash?.commands || commands;
  const searchSource = (query: string, usage?: Record<string, number>) =>
    search(query, usage, source());
  const sourceTrigger = (line: string, column: number) => triggerAt(line, column, source());
  return new (class NotesSlashSuggest extends EditorSuggest {
    executing: boolean;
    constructor() {
      super(app);
      this.limit = commands.length;
      this.executing = false;
    }

    enabled() {
      return plugin.options?.slash !== false;
    }

    onTrigger(cursor: EditorPosition, editor: Editor) {
      if (!this.enabled() || editor.listSelections?.().length > 1) return null;
      const trigger = sourceTrigger(editor.getLine(cursor.line), cursor.ch);
      if (!trigger) return null;
      const position = editor.posToOffset(cursor);
      if (plugin.logic.protectedContext(editor.getValue(), position)) return null;
      if (editorView(editor) && plugin.inCode(editorView(editor)!, position)) return null;
      this.executing = false;
      return {
        start: { line: cursor.line, ch: trigger.column },
        end: cursor,
        query: trigger.query,
      };
    }

    getSuggestions(context: EditorSuggestContext) {
      this.limit = source().length;
      return searchSource(context.query, plugin.options?.slashUsage);
    }

    renderSuggestion(value: RegistryCommand, element: HTMLElement) {
      element.classList.add("notes-emoji-suggestion", "notes-slash-suggestion");
      const document = element.ownerDocument;
      const glyph = document.createElement("span");
      glyph.className = "notes-emoji-glyph notes-slash-glyph";
      glyph.textContent = value.icon;
      glyph.setAttribute("aria-hidden", "true");
      const details = document.createElement("span");
      details.className = "notes-emoji-details";
      const name = document.createElement("span");
      name.className = "notes-emoji-name";
      name.textContent = `/${value.name}`;
      const description = document.createElement("span");
      description.className = "notes-emoji-description";
      description.textContent = value.description;
      details.append(name, description);
      element.append(glyph, details);
    }

    activeContext(editor?: Editor) {
      const context = this.context;
      if (!this.enabled() || !context || this.executing || (editor && editor !== context.editor))
        return null;
      const { start, end } = context;
      if (!start || !end || start.line !== end.line) return null;
      const trigger = this.onTrigger(end, context.editor);
      if (!trigger || trigger.start.ch !== start.ch) return null;
      return { ...context, query: trigger.query };
    }

    highlightedSuggestion(context: EditorSuggestContext) {
      // Obsidian's native suggestion list tracks its keyboard selection here.
      // Fall back to the best live match when no native selection is available.
      const selected = highlightedSuggestion(this);
      const matches = this.getSuggestions(context);
      return matches.find((value) => value.id === selected?.id) || matches[0];
    }

    completeSuggestion(editor: Editor) {
      const context = this.activeContext(editor);
      if (!context) return false;
      const value = this.highlightedSuggestion(context);
      if (!value) return false;
      const replacement = `/${value.name}`;
      const end = { line: context.start.line, ch: context.start.ch + replacement.length };
      // Keep the native picker open. Enter still selects and executes afterward.
      this.context = { ...context, end, query: value.name };
      context.editor.replaceRange(replacement, context.start, context.end);
      context.editor.setCursor(end);
      return true;
    }

    autocomplete(editor: Editor) {
      return this.completeSuggestion(editor);
    }

    selectSuggestion(value: RegistryCommand) {
      const context = this.activeContext();
      if (!context || !this.getSuggestions(context).some((command) => command.id === value?.id))
        return;
      if (typeof plugin.runSlashCommand !== "function") return;
      this.executing = true;
      this.close();
      plugin.recordSlash?.(value.id);
      // The plugin command executor owns replacement, insertion, and error handling.
      plugin.runSlashCommand(value.id, context, context.editor);
    }
  })();
}

function createRegistry() {
  const local: RegistryCommand[] = [...commands];
  return {
    commands: local,
    search: (query: string, usage?: Record<string, number>) => search(query, usage, local),
    triggerAt: (line: string, column: number) => triggerAt(line, column, local),
    createSlashSuggest,
    register(command: SlashCommand) {
      if (
        !command ||
        !/^[a-z][a-z-]{0,39}$/.test(command.name || "") ||
        command.id !== command.name ||
        typeof command.description !== "string" ||
        command.description.length > 200 ||
        typeof command.run !== "function"
      )
        throw Error(
          "A slash command needs matching lowercase id/name, description and run callback."
        );
      const aliases = command.aliases || [];
      if (
        !Array.isArray(aliases) ||
        aliases.some((alias) => typeof alias !== "string" || !/^[a-z][a-z-]{0,39}$/.test(alias))
      )
        throw Error("Invalid command aliases.");
      const names = [command.name, ...aliases];
      if (
        new Set(names).size !== names.length ||
        local.some((c) => [c.name, ...c.aliases].some((name) => names.includes(name)))
      )
        throw Error("Slash command name or alias already registered.");
      const entry = Object.freeze({
        ...command,
        aliases: [...aliases],
        icon: typeof command.icon === "string" ? command.icon.slice(0, 16) : "🧩",
      });
      local.push(entry);
      return () => {
        const index = local.indexOf(entry);
        if (index >= 0) local.splice(index, 1);
      };
    },
  };
}
export { commands, search, triggerAt, createSlashSuggest, createRegistry };

export type SlashRegistry = ReturnType<typeof createRegistry>;
export type SlashSuggester = ReturnType<typeof createSlashSuggest>;
