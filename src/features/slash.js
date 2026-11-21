"use strict";

// Native EditorSuggest is injected by main.js so this module also works in Node.
const { commands } = require("../commands/catalog.js");

function usageCount(usage, id) {
  const value = Number(usage?.[id]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function search(query = "", usage = {}, source = commands) {
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

function triggerAt(line, column, source = commands) {
  if (!Number.isInteger(column) || column < 0 || column > line.length) return null;
  const match = /^([ \t]*)\/([a-z-]*)$/i.exec(line.slice(0, column));
  if (!match || !/^[ \t]*$/.test(line.slice(column))) return null;
  if (!search(match[2], {}, source).length) return null;
  return { column: match[1].length, query: match[2] };
}

function createSlashSuggest(app, plugin, EditorSuggest) {
  const source = () => plugin.slash?.commands || commands;
  const search = (query, usage) => module.exports.search(query, usage, source());
  const triggerAt = (line, column) => module.exports.triggerAt(line, column, source());
  return new (class NotesSlashSuggest extends EditorSuggest {
    constructor() {
      super(app);
      this.limit = commands.length;
      this.executing = false;
    }

    enabled() {
      return plugin.options?.slash !== false;
    }

    onTrigger(cursor, editor) {
      if (!this.enabled()) return null;
      const trigger = triggerAt(editor.getLine(cursor.line), cursor.ch);
      if (!trigger) return null;
      const position = editor.posToOffset(cursor);
      if (plugin.logic.protectedContext(editor.getValue(), position)) return null;
      if (editor.cm && plugin.inCode(editor.cm, position)) return null;
      this.executing = false;
      return {
        start: { line: cursor.line, ch: trigger.column },
        end: cursor,
        query: trigger.query,
      };
    }

    getSuggestions(context) {
      this.limit = source().length;
      return search(context.query, plugin.options?.slashUsage);
    }

    renderSuggestion(value, element) {
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

    activeContext(editor) {
      const context = this.context;
      if (!this.enabled() || !context || this.executing || (editor && editor !== context.editor))
        return null;
      const { start, end } = context;
      if (!start || !end || start.line !== end.line) return null;
      const trigger = this.onTrigger(end, context.editor);
      if (!trigger || trigger.start.ch !== start.ch) return null;
      return { ...context, query: trigger.query };
    }

    highlightedSuggestion(context) {
      // Obsidian's native suggestion list tracks its keyboard selection here.
      // Fall back to the best live match when no native selection is available.
      const list = this.suggestions;
      const selected =
        Array.isArray(list?.values) && Number.isInteger(list?.selectedItem)
          ? list.values[list.selectedItem]
          : null;
      const matches = this.getSuggestions(context);
      return matches.find((value) => value.id === selected?.id) || matches[0];
    }

    completeSuggestion(editor) {
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

    autocomplete(editor) {
      return this.completeSuggestion(editor);
    }

    selectSuggestion(value) {
      const context = this.activeContext();
      if (!context || !this.getSuggestions(context).some((command) => command.id === value?.id))
        return;
      if (typeof plugin.runSlashCommand !== "function") return;
      this.executing = true;
      this.close();
      plugin.recordSlash?.(value.id);
      // main.js owns command replacement, insertion, and error handling.
      plugin.runSlashCommand(value.id, context, context.editor);
    }
  })();
}

function createRegistry() {
  const local = [...commands];
  return {
    commands: local,
    search: (query, usage) => search(query, usage, local),
    triggerAt: (line, column) => triggerAt(line, column, local),
    createSlashSuggest,
    register(command) {
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
module.exports = { commands, search, triggerAt, createSlashSuggest, createRegistry };
