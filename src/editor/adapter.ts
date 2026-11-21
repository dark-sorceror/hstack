import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { App, Editor, EditorSuggest, Vault } from "obsidian";
import type { EditorPlan, ReplacementPlan, RememberedReplacement } from "../features/types.js";

export type { EditorPlan, ReplacementPlan } from "../features/types.js";
export interface Replacement extends RememberedReplacement {
  kind?: "autocorrect";
}
export interface ReplacementHost {
  replacements: WeakMap<EditorView, Replacement>;
}
export type SuggestionEditor = Editor & { cm?: EditorView };

function applyEditorPlan(editor: SuggestionEditor, plan: EditorPlan, userEvent: string) {
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
      selection: { from: { line: before.length - 1, ch: before.at(-1)!.length } },
    },
    userEvent
  );
}

function applyReplacement(
  plugin: ReplacementHost,
  view: EditorView,
  plan: ReplacementPlan,
  remember = true
) {
  const { raw, ...change } = plan;
  const end = change.from + change.insert.length;
  plugin.replacements.delete(view);
  view.dispatch({
    changes: change,
    selection: EditorSelection.cursor(end),
    userEvent: "input.type",
    filter: false,
    scrollIntoView: true,
  });
  if (raw && remember)
    plugin.replacements.set(view, { from: change.from, to: end, text: change.insert, raw });
}

function inCode(view: EditorView, position: number) {
  const node = view.domAtPos(position).node;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!element?.closest(
    ".HyperMD-codeblock, .cm-inline-code, .HyperMD-frontmatter, .cm-math, .HyperMD-math, .cm-url, .cm-hmd-internal-link"
  );
}

// Keep Obsidian's private compatibility surfaces in one adapter.
function editorView(editor: Editor | null | undefined) {
  return (editor as SuggestionEditor | null | undefined)?.cm;
}
function highlightedSuggestion<T>(suggester: EditorSuggest<T>) {
  // Obsidian owns this private suggestion list; only inspect its array/index surface.
  const list = (
    suggester as EditorSuggest<T> & {
      suggestions?: { values?: T[]; selectedItem?: number };
    }
  ).suggestions;
  return Array.isArray(list?.values) && Number.isInteger(list?.selectedItem)
    ? list.values[list.selectedItem!]
    : null;
}
function prioritizeSuggesters(app: App, suggesters: readonly unknown[]) {
  const installed = (
    app.workspace as App["workspace"] & {
      editorSuggest?: { suggests?: unknown[] };
    }
  ).editorSuggest?.suggests;
  if (!Array.isArray(installed)) return;
  for (const suggester of suggesters) {
    const index = installed.indexOf(suggester);
    if (index > 0) installed.unshift(...installed.splice(index, 1));
  }
}
interface VaultConfig {
  tabSize: number;
  useTab: boolean;
}
function vaultConfig<K extends keyof VaultConfig>(vault: Vault, name: K): VaultConfig[K] {
  // getConfig is host-owned and absent from Obsidian's public Vault declaration.
  return (
    vault as Vault & {
      getConfig<K extends keyof VaultConfig>(key: K): VaultConfig[K];
    }
  ).getConfig(name);
}
export {
  applyEditorPlan,
  applyReplacement,
  inCode,
  editorView,
  highlightedSuggestion,
  prioritizeSuggesters,
  vaultConfig,
};
