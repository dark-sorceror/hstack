import {
  Plugin,
  EditorSuggest,
  Notice,
  parseYaml,
  type Editor,
  type EditorSuggestContext,
} from "obsidian";
import {
  Prec,
  EditorState,
  EditorSelection,
  type Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, Decoration, ViewPlugin } from "@codemirror/view";

import SlashHelpModal from "./ui/slash-help.js";
import TypingSettings from "./ui/settings.js";

import * as editorAdapter from "./editor/adapter.js";
import { handleKey } from "./editor/keyboard.js";
import { executeSlashCommand } from "./commands/execute.js";
import { restoreTemplates } from "./public-api.js";

import { normalizeSettings, createSettingsSaver } from "./settings.js";

import * as logic from "./features/logic.js";
import * as emoji from "./features/emoji.js";
import * as markup from "./features/markup.js";
import * as spaces from "./features/spaces.js";
import * as calloutPaste from "./features/callout-paste.js";
import * as outline from "./features/outline.js";
import * as format from "./features/format.js";
import * as autocorrectModule from "./autocorrect/autocorrect.js";
import { createRegistry, type SlashRegistry, type SlashSuggester } from "./features/slash.js";
import { createAgentBridge } from "./agent/agent-bridge.js";
import * as bundledAssets from "./bundled-assets.js";
import type { Corrector } from "./autocorrect/autocorrect.js";
import type { Replacement } from "./editor/adapter.js";
import type { EditorPlan, ReplacementPlan } from "./features/types.js";
import type { StoredSettings } from "./settings.js";

export default class HstackCore extends Plugin {
  // These fields are established by onload before editor hooks are registered.
  declare options: StoredSettings;
  declare saveSettings: () => Promise<void>;
  declare replacements: WeakMap<EditorView, Replacement>;
  declare typedWords: WeakMap<EditorView, number>;
  declare logic: typeof logic;
  declare emoji: typeof emoji;
  declare markup: typeof markup;
  declare spaces: typeof spaces;
  declare calloutPaste: typeof calloutPaste;
  declare outline: typeof outline;
  declare format: typeof format;
  declare autocorrectModule: typeof autocorrectModule;
  declare slash: SlashRegistry;
  declare agent: ReturnType<typeof createAgentBridge>;
  declare autocorrect: Corrector | null | undefined;
  declare autocorrectReady: Promise<Corrector | null>;
  declare _autocorrectDisposed: boolean;
  declare emojiSuggest: ReturnType<typeof emoji.createEmojiSuggest>;
  declare slashSuggest: SlashSuggester;
  declare templateDisposers: (() => void)[] | undefined;

  async onload() {
    this.options = normalizeSettings(await this.loadData());
    this.saveSettings = createSettingsSaver(this);
    this.replacements = new WeakMap();
    this.typedWords = new WeakMap();
    this.logic = logic;
    this.emoji = emoji;
    this.markup = markup;
    this.spaces = spaces;
    this.calloutPaste = calloutPaste;
    this.slash = createRegistry();
    restoreTemplates(this, (message) => new Notice(message));
    this.outline = outline;
    this.format = format;
    this.agent = createAgentBridge(this, {
      parseYaml,
      getNodePath: () => this.options.sqlNodePath,
    });
    this.register(() => this.agent.dispose());
    this.autocorrectModule = autocorrectModule;
    this._autocorrectDisposed = false;
    this.register(() => {
      this._autocorrectDisposed = true;
      this.autocorrect = null;
    });
    this.autocorrectReady = this.autocorrectModule
      .loadCorrector(bundledAssets, this.options.autocorrectWords)
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
          // These plans replace one range. Native input owns multiple selections.
          if (
            view.state.readOnly ||
            view.composing ||
            view.state.selection.ranges.length !== 1 ||
            this.inCode(view, from)
          )
            return false;
          const doc = view.state.doc.toString();
          let plan: ReplacementPlan | null = this.options.listShortcuts
            ? this.logic.prefixPlan(doc, from, to, text)
            : null;
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
            const previous = this.typedWords.get(update.view)!; // Guarded by has above.
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

  runSlashCommand(id: string, context: EditorSuggestContext, editor: Editor): void {
    return executeSlashCommand(this, id, context, editor, { Notice, SlashHelpModal });
  }

  applyEditorPlan(editor: Editor, plan: EditorPlan, userEvent: string): void {
    return editorAdapter.applyEditorPlan(editor, plan, userEvent);
  }

  recordSlash(id: string): void {
    this.options.slashUsage[id] = (Number(this.options.slashUsage[id]) || 0) + 1;
    this.saveSettings().catch((error) =>
      console.error("hstack: could not save command usage", error)
    );
  }

  onPasteTransaction(
    transaction: Transaction
  ): Transaction | readonly [Transaction, TransactionSpec] {
    if (
      !this.options.calloutPaste ||
      !transaction.isUserEvent("input.paste") ||
      transaction.startState.selection.ranges.length !== 1
    )
      return transaction;
    let change!: { from: number; to: number; text: string };
    let count = 0;
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

  applyReplacement(view: EditorView, plan: ReplacementPlan, remember = true): void {
    return editorAdapter.applyReplacement(this, view, plan, remember);
  }

  recordEmoji(emoji: string): void {
    this.options.emojiUsage[emoji] = (Number(this.options.emojiUsage[emoji]) || 0) + 1;
    this.saveSettings().catch((error) =>
      console.error("hstack: could not save emoji usage", error)
    );
  }

  inCode(view: EditorView, position: number): boolean {
    return editorAdapter.inCode(view, position);
  }

  onKey(event: KeyboardEvent, view: EditorView): boolean {
    return handleKey(this, event, view);
  }
}
