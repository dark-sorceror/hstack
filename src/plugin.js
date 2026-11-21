"use strict";
const { Plugin, EditorSuggest, Notice, parseYaml } = require("obsidian");
const { Prec, EditorState, EditorSelection } = require("@codemirror/state");
const { EditorView, Decoration, ViewPlugin } = require("@codemirror/view");

const SlashHelpModal = require("./ui/slash-help.js");
const TypingSettings = require("./ui/settings.js");

const editorAdapter = require("./editor/adapter.js");
const { handleKey } = require("./editor/keyboard.js");
const { executeSlashCommand } = require("./commands/execute.js");
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
    editorAdapter.prioritizeSuggesters(this.app, [this.slashSuggest, this.emojiSuggest]);
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
    return executeSlashCommand(this, id, context, editor, { Notice, SlashHelpModal });
  }

  applyEditorPlan(editor, plan, userEvent) {
    return editorAdapter.applyEditorPlan(editor, plan, userEvent);
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
    return editorAdapter.applyReplacement(this, view, plan, remember);
  }

  recordEmoji(emoji) {
    this.options.emojiUsage[emoji] = (Number(this.options.emojiUsage[emoji]) || 0) + 1;
    this.saveSettings().catch((error) =>
      console.error("hstack: could not save emoji usage", error)
    );
  }

  inCode(view, position) {
    return editorAdapter.inCode(view, position);
  }

  onKey(event, view) {
    return handleKey(this, event, view);
  }
};
