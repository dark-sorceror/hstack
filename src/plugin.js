"use strict";
const { Plugin, EditorSuggest, Notice, parseYaml } = require("obsidian");
const { Prec, EditorState, EditorSelection } = require("@codemirror/state");
const { EditorView, Decoration, ViewPlugin } = require("@codemirror/view");

const SlashHelpModal = require("./ui/slash-help.js");
const TypingSettings = require("./ui/settings.js");

const { restoreTemplates } = require("./public-api.js");
const { normalizeSettings, createSettingsSaver } = require("./settings.js");

module.exports = class HstackCore extends Plugin {
  async onload() {
    this.options = normalizeSettings(await this.loadData());
    this.saveSettings = createSettingsSaver(this);
    this.replacements = new WeakMap();
    this.typedWords = new WeakMap();
    this.logic = require("./features/logic.js");
    this.emoji = require("./features/emoji.js");
    this.markup = require("./features/markup.js");
    this.spaces = require("./features/spaces.js");
    this.calloutPaste = require("./features/callout-paste.js");
    this.slash = require("./features/slash.js").createRegistry();
    restoreTemplates(this, (message) => new Notice(message));
    this.outline = require("./features/outline.js");
    this.format = require("./features/format.js");
    this.agent = require("./agent/agent-bridge.js").createAgentBridge(this, {
      parseYaml,
      getNodePath: () => this.options.sqlNodePath,
    });
    this.register(() => this.agent.dispose());
    this.autocorrectModule = require("./autocorrect/autocorrect.js");
    this._autocorrectDisposed = false;
    this.register(() => {
      this._autocorrectDisposed = true;
      this.autocorrect = null;
    });
    this.autocorrectReady = this.autocorrectModule
      .loadCorrector(require("./bundled-assets.js"), this.options.autocorrectWords)
      .then((corrector) => {
        if (this._autocorrectDisposed) return null;
        this.autocorrect = corrector;
        return corrector;
      })
      .catch((error) => {
        console.error("hstack: autocorrect could not start", error);
        if (!this._autocorrectDisposed)
          new Notice("Autocorrect could not start. Other typing helpers are still available.");
        return null;
      });
    this.emojiSuggest = this.emoji.createEmojiSuggest(this.app, this, EditorSuggest);
    this.registerEditorSuggest(this.emojiSuggest);
    this.slashSuggest = this.slash.createSlashSuggest(this.app, this, EditorSuggest);
    this.registerEditorSuggest(this.slashSuggest);
    // Iconize also registers a colon suggester with Lucide entries. Give our
    // colored-emoji picker first refusal, without disabling file/folder icons.
    const suggesters = this.app.workspace.editorSuggest.suggests;
    if (Array.isArray(suggesters)) {
      for (const suggester of [this.slashSuggest, this.emojiSuggest]) {
        const index = suggesters.indexOf(suggester);
        if (index > 0) suggesters.unshift(...suggesters.splice(index, 1));
      }
    }
    this.registerMarkdownPostProcessor((element, context) =>
      this.markup.postprocessMarkup(element, context, this)
    );
    this.registerEditorExtension(
      this.markup.createMarkupExtension(this, { Decoration, ViewPlugin })
    );
    this.registerEditorExtension(
      this.spaces.createLiteralSpaceExtension(this, { Decoration, ViewPlugin })
    );
    this.registerEditorExtension(
      Prec.highest([
        EditorState.transactionFilter.of((transaction) => this.onPasteTransaction(transaction)),
        EditorView.domEventHandlers({ keydown: (event, view) => this.onKey(event, view) }),
        EditorView.inputHandler.of((view, from, to, text) => {
          if (view.state.readOnly || view.composing || this.inCode(view, from)) return false;
          const doc = view.state.doc.toString();
          let plan = this.options.listShortcuts ? this.logic.prefixPlan(doc, from, to, text) : null;
          let emoji = false;
          let remember = false;
          if (!plan && this.options.emoji) {
            plan = this.emoji.directCompletion(doc, from, to, text);
            emoji = !!plan;
          }
          if (!plan && this.options.typography) {
            plan = this.logic.typographyPlan(doc, from, to, text);
            remember = !!plan;
          }
          if (!plan) return false;
          this.applyReplacement(view, plan, remember);
          if (emoji) {
            this.recordEmoji(plan.insert);
            this.emojiSuggest.close();
          }
          return true;
        }),
        EditorView.updateListener.of((update) => {
          const caret = update.state.selection.main;
          if (update.docChanged) {
            const typed = update.transactions.some((transaction) =>
              transaction.isUserEvent("input.type")
            );
            const pasted = update.transactions.some(
              (transaction) =>
                transaction.isUserEvent("input.paste") || transaction.isUserEvent("input.drop")
            );
            if (
              typed &&
              !pasted &&
              caret.empty &&
              /\S/.test(update.state.doc.sliceString(Math.max(0, caret.head - 1), caret.head))
            )
              this.typedWords.set(update.view, caret.head);
            else this.typedWords.delete(update.view);
          } else if (update.selectionSet && this.typedWords.has(update.view)) {
            const previous = this.typedWords.get(update.view);
            if (
              caret.empty &&
              caret.head > previous &&
              /^[*_~)\]}"'’”]+$/.test(update.state.doc.sliceString(previous, caret.head))
            )
              this.typedWords.set(update.view, caret.head);
            else if (!caret.empty || caret.head !== previous) this.typedWords.delete(update.view);
          }
          const replacement = this.replacements.get(update.view);
          if (!replacement || (!update.docChanged && !update.selectionSet)) return;
          const selection = update.state.selection;
          if (
            selection.ranges.length !== 1 ||
            !selection.main.empty ||
            !this.logic.revertPlan(update.state.doc.toString(), selection.main.head, replacement)
          )
            this.replacements.delete(update.view);
        }),
      ])
    );
    this.addSettingTab(new TypingSettings(this.app, this));
    this.addCommand({
      id: "slash-help",
      name: "Show slash command help",
      callback: () => new SlashHelpModal(this.app, this).open(),
    });
  }

  runSlashCommand(id, context, editor) {
    const trigger = this.slash.triggerAt(editor.getLine(context.end.line), context.end.ch);
    if (!trigger || trigger.column !== context.start.ch) return;
    const from = editor.posToOffset(context.start),
      to = editor.posToOffset(context.end);
    const text = editor.getValue();
    if (id === "toc") {
      const plan = this.outline.planTOC(text, from, to);
      if (!plan) {
        new Notice(
          this.outline.scanHeadings(text).length
            ? "Couldn't update the contents safely. Check the existing contents block."
            : "Add a heading with # first, then run /toc."
        );
        return;
      }
      this.applyEditorPlan(editor, plan, "input.notes-toc");
      new Notice(
        `${plan.updated ? "Updated" : "Inserted"} contents · ${plan.headingCount} headings`,
        2200
      );
    } else if (id === "format") {
      const plan = this.format.planFormat(text, from, to);
      if (!plan) {
        new Notice("Use /format on its own line outside a code block.");
        return;
      }
      this.applyEditorPlan(editor, plan, "input.notes-format");
      new Notice(
        plan.changed ? "Markdown formatted" : "Markdown formatting is already consistent",
        2200
      );
    } else if (id === "help") {
      this.applyEditorPlan(
        editor,
        { changes: [{ from, to, insert: "" }], cursor: from },
        "input.notes-command"
      );
      new SlashHelpModal(this.app, this).open();
    } else {
      const command = this.slash.commands.find((c) => c.id === id);
      if (command?.run) {
        try {
          Promise.resolve(
            command.run({
              editor,
              from,
              to,
              title: this.app.workspace.getActiveFile()?.basename || "",
              app: this.app,
            })
          ).catch((error) => {
            console.error("hstack command failed", error);
            new Notice("Command failed: " + error.message);
          });
        } catch (error) {
          console.error("hstack command failed", error);
          new Notice("Command failed: " + error.message);
        }
      }
    }
  }

  applyEditorPlan(editor, plan, userEvent) {
    if (editor.cm) {
      editor.cm.dispatch({
        changes: plan.changes,
        selection: EditorSelection.cursor(plan.cursor),
        userEvent,
        filter: false,
        scrollIntoView: true,
      });
      return;
    }
    let result = editor.getValue();
    for (const change of [...plan.changes].sort((a, b) => b.from - a.from))
      result = result.slice(0, change.from) + change.insert + result.slice(change.to);
    const before = result.slice(0, plan.cursor).split("\n");
    editor.transaction(
      {
        changes: plan.changes.map((change) => ({
          from: editor.offsetToPos(change.from),
          to: editor.offsetToPos(change.to),
          text: change.insert,
        })),
        selection: { from: { line: before.length - 1, ch: before.at(-1).length } },
      },
      userEvent
    );
  }

  recordSlash(id) {
    this.options.slashUsage[id] = (Number(this.options.slashUsage[id]) || 0) + 1;
    this.saveSettings().catch((error) =>
      console.error("hstack: could not save command usage", error)
    );
  }

  onPasteTransaction(transaction) {
    if (
      !this.options.calloutPaste ||
      !transaction.isUserEvent("input.paste") ||
      transaction.startState.selection.ranges.length !== 1
    )
      return transaction;
    let change,
      count = 0;
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      count++;
      change = { from, to, text: inserted.toString() };
    });
    if (count !== 1 || !change.text) return transaction;
    const plan = this.calloutPaste.calloutPastePlan(
      transaction.startState.doc.toString(),
      change.from,
      change.to,
      change.text
    );
    if (!plan) return transaction;
    // Normalize after Obsidian's rich-text conversion. A sequential edit keeps
    // the original paste annotations/effects and remains a single undo step.
    return [
      transaction,
      {
        changes: {
          from: transaction.changes.mapPos(plan.from, -1),
          to: transaction.changes.mapPos(plan.to, 1),
          insert: plan.insert,
        },
        selection: EditorSelection.cursor(plan.cursor),
        sequential: true,
      },
    ];
  }

  applyReplacement(view, plan, remember = true) {
    const { raw, ...change } = plan;
    const end = change.from + change.insert.length;
    this.replacements.delete(view);
    view.dispatch({
      changes: change,
      selection: EditorSelection.cursor(end),
      userEvent: "input.type",
      filter: false,
      scrollIntoView: true,
    });
    if (raw && remember)
      this.replacements.set(view, { from: change.from, to: end, text: change.insert, raw });
  }

  recordEmoji(emoji) {
    this.options.emojiUsage[emoji] = (Number(this.options.emojiUsage[emoji]) || 0) + 1;
    this.saveSettings().catch((error) =>
      console.error("hstack: could not save emoji usage", error)
    );
  }

  inCode(view, position) {
    const node = view.domAtPos(position).node;
    const element = node.nodeType === 1 ? node : node.parentElement;
    return !!element?.closest(
      ".HyperMD-codeblock, .cm-inline-code, .HyperMD-frontmatter, .cm-math, .HyperMD-math, .cm-url, .cm-hmd-internal-link"
    );
  }

  onKey(event, view) {
    if (
      view.state.readOnly ||
      event.isComposing ||
      view.composing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return false;
    let selection = view.state.selection.main;
    const singleCaret = view.state.selection.ranges.length === 1 && selection.empty;
    if (
      this.slashSuggest.context &&
      ["Enter", "Tab", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)
    ) {
      if (event.key === "Tab" && !event.shiftKey) {
        const editor = this.slashSuggest.context.editor;
        if (editor?.cm === view && this.slashSuggest.completeSuggestion(editor)) {
          event.preventDefault();
          event.stopPropagation();
          return true;
        }
      } else return false;
    }
    if (
      this.emojiSuggest.context &&
      ["Enter", "Tab", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)
    )
      return false;
    if (event.key === "Enter" && !event.shiftKey && singleCaret && this.options.formatPairs) {
      const plan = this.markup.enterPairPlan?.(
        view.state.doc.toString(),
        selection.from,
        selection.to
      );
      if (plan) {
        this.replacements.delete(view);
        view.dispatch({
          changes: plan.changes,
          selection: EditorSelection.cursor(plan.cursor),
          userEvent: "input.type",
          filter: false,
          scrollIntoView: true,
        });
        // Let the usual Enter command handle newlines and indentation using the
        // cleaned-up text; empty child lists still pass through our list rules.
        selection = view.state.selection.main;
      }
    }
    if (event.key === "Backspace" && singleCaret) {
      const replacement = this.replacements.get(view);
      const change = this.logic.revertPlan(view.state.doc.toString(), selection.head, replacement);
      if (change) {
        if (replacement.kind === "autocorrect") this.autocorrect?.reject(replacement.word);
        this.replacements.delete(view);
        view.dispatch({
          changes: change,
          selection: EditorSelection.cursor(change.from + change.insert.length),
          userEvent: "input.notes-revert",
          filter: false,
          scrollIntoView: true,
        });
        event.preventDefault();
        return true;
      }
    }
    if (event.key === " ") {
      this.replacements.delete(view);
      if (
        this.options.autocorrect &&
        singleCaret &&
        this.typedWords.get(view) === selection.head &&
        !this.inCode(view, selection.head)
      ) {
        const plan = this.autocorrectModule.boundaryPlan(
          view.state.doc.toString(),
          selection.head,
          this.autocorrect
        );
        if (plan) {
          const { original, ...replacement } = plan;
          this.applyReplacement(view, replacement);
          Object.assign(this.replacements.get(view), { kind: "autocorrect", word: original });
          event.preventDefault();
          return true;
        }
      }
      if (!this.options.literalSpaces) return false;
      // Bypass automatic transaction formatters for a literal Space key.
      view.dispatch({
        ...view.state.replaceSelection(" "),
        userEvent: "input.type",
        filter: false,
        scrollIntoView: true,
      });
      event.preventDefault();
      return true;
    }
    if (
      this.options.formatPairs &&
      ["*", "_"].includes(event.key) &&
      !this.inCode(view, selection.from)
    ) {
      const plan = this.markup.pairPlan(
        view.state.doc.toString(),
        selection.from,
        selection.to,
        event.key
      );
      if (plan) {
        this.replacements.delete(view);
        view.dispatch({
          changes: plan.changes,
          selection: plan.selection
            ? EditorSelection.range(plan.selection.anchor, plan.selection.head)
            : EditorSelection.cursor(plan.cursor),
          userEvent: "input.notes-pair",
          filter: false,
          scrollIntoView: true,
        });
        event.preventDefault();
        return true;
      }
    }
    // Closing a native auto-paired [] can be a key command rather than input.
    if (
      event.key === "]" &&
      this.options.listShortcuts &&
      singleCaret &&
      !this.inCode(view, selection.head)
    ) {
      const plan = this.logic.prefixPlan(
        view.state.doc.toString(),
        selection.from,
        selection.to,
        "]"
      );
      if (plan) {
        this.applyReplacement(view, plan, false);
        event.preventDefault();
        return true;
      }
    }
    if (!["-", ">", "Shift"].includes(event.key)) this.replacements.delete(view);
    if (!this.options.mixedLists || view.state.selection.ranges.length !== 1) return false;
    if (!selection.empty || this.inCode(view, selection.head)) return false;
    let action;
    if (event.key === "Tab") action = event.shiftKey ? "outdent" : "indent";
    else if (!event.shiftKey && (event.key === "Enter" || event.key === "Backspace"))
      action = "exit";
    else return false;
    const line = view.state.doc.lineAt(selection.head);
    const plan = this.logic.listPlan(
      view.state.doc.toString(),
      line.number - 1,
      selection.head - line.from,
      action,
      {
        tabSize: this.app.vault.getConfig("tabSize") || 4,
        useTabs: this.app.vault.getConfig("useTab") !== false,
      }
    );
    if (!plan) return false;
    view.dispatch({
      changes: plan.changes,
      selection: EditorSelection.cursor(plan.cursor),
      userEvent: "input.notes-list",
      scrollIntoView: true,
    });
    event.preventDefault();
    return true;
  }
};
