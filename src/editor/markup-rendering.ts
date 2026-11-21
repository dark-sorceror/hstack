import type {
  EditorView,
  ViewUpdate,
  DecorationSet,
  Decoration as DecorationType,
} from "@codemirror/view";
import type { Range } from "@codemirror/state";
import type { MarkdownPostProcessorContext } from "obsidian";
import type { HstackSettings } from "../settings-types.js";
import { analyzeSource } from "../markdown/analysis.js";
import { getUnderlineDelimiters } from "../markdown/emphasis.js";
import { getNestedAsteriskDelimiters } from "../features/pairs.js";

export interface MarkupHost {
  options: Pick<HstackSettings, "listStyles" | "underline">;
  _notesMarkupAnalysis?: { text: string; analysis: ReturnType<typeof analyzeSource> };
}
export interface MarkupDependencies {
  Decoration: typeof import("@codemirror/view").Decoration;
  ViewPlugin: typeof import("@codemirror/view").ViewPlugin;
}
function analysisFor(plugin: MarkupHost, text: string) {
  const cached = plugin._notesMarkupAnalysis;
  if (cached?.text === text) return cached.analysis;
  const analysis = analyzeSource(text);
  plugin._notesMarkupAnalysis = { text, analysis };
  return analysis;
}

function createMarkupExtension(plugin: MarkupHost, { Decoration, ViewPlugin }: MarkupDependencies) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      listStyles?: boolean;
      underline?: boolean;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          this.listStyles !== plugin.options.listStyles ||
          this.underline !== plugin.options.underline
        )
          this.decorations = this.build(update.view);
      }
      build(view: EditorView) {
        this.listStyles = plugin.options.listStyles;
        this.underline = plugin.options.underline;
        if (this.listStyles === false && this.underline === false) return Decoration.none;
        const text = view.state.doc.toString();
        const analysis = analysisFor(plugin, text);
        const visible = (from: number, to: number) =>
          view.visibleRanges.some((range) => from <= range.to && to >= range.from);
        const decorations: Range<DecorationType>[] = [];
        if (plugin.options.listStyles !== false) {
          for (const list of analysis.lists) {
            if (list.marker === "-" && !list.task && visible(list.from, list.to))
              decorations.push(
                Decoration.line({ attributes: { "data-notes-list-style": "dash" } }).range(
                  list.from
                )
              );
          }
        }
        if (plugin.options.underline !== false) {
          for (const mark of analysis.emphasis) {
            if (mark.innerFrom >= mark.innerTo || !visible(mark.innerFrom, mark.innerTo)) continue;
            if (mark.markup === "__") {
              decorations.push(
                Decoration.mark({
                  class: "notes-underline" + (mark.boldAncestor ? " notes-underline-bold" : ""),
                }).range(mark.innerFrom, mark.innerTo)
              );
            } else if (mark.underlineAncestor && mark.markup !== "**") {
              decorations.push(
                Decoration.mark({ class: "notes-underline-bold" }).range(
                  mark.innerFrom,
                  mark.innerTo
                )
              );
            }
          }
          for (const mark of analysis.nestedAsterisks) {
            if (!visible(mark.innerFrom, mark.innerTo)) continue;
            const classes = [
              mark.bold ? "notes-underline-bold" : "",
              mark.italic ? "notes-underline-italic" : "",
            ]
              .filter(Boolean)
              .join(" ");
            decorations.push(
              Decoration.mark({ class: classes }).range(mark.innerFrom, mark.innerTo)
            );
          }
          if (
            view.dom.classList.contains("is-live-preview") ||
            view.dom.closest(".markdown-source-view.is-live-preview")
          ) {
            const carets = view.state.selection.ranges.flatMap((range) => [
              range.anchor,
              range.head,
            ]);
            const delimiters = getUnderlineDelimiters(text, carets, analysis.emphasis).concat(
              getNestedAsteriskDelimiters(text, carets, analysis.nestedAsterisks)
            );
            for (const range of delimiters) {
              if (visible(range.from, range.to))
                decorations.push(
                  Decoration.mark({ class: "notes-underline-delimiter" }).range(
                    range.from,
                    range.to
                  )
                );
            }
          }
        }
        return Decoration.set(decorations, true);
      }
    },
    { decorations: (value) => value.decorations }
  );
}

function descendantsIncludingRoot(el: Element, selector: string) {
  return (el.matches?.(selector) ? [el] : []).concat(Array.from(el.querySelectorAll(selector)));
}

function postprocessMarkup(
  el: HTMLElement,
  context: Pick<MarkdownPostProcessorContext, "getSectionInfo">,
  plugin: MarkupHost
) {
  const section = context.getSectionInfo(el);
  if (!section || typeof section.text !== "string") return;
  const text = section.text;
  const lines = text.split("\n");
  const startLine = Math.max(0, section.lineStart || 0);
  const endLine = Math.min(lines.length - 1, section.lineEnd ?? lines.length - 1);
  let start = 0;
  for (let n = 0; n < startLine; n++) start += lines[n]!.length + 1;
  let end = start;
  for (let n = startLine; n <= endLine; n++) end += lines[n]!.length + 1;
  const analysis = analysisFor(plugin, text);
  if (plugin.options.listStyles !== false) {
    const source = analysis.lists.filter((list) => list.line >= startLine && list.line <= endLine);
    const rendered = descendantsIncludingRoot(el, "li").filter(
      (node) => !node.closest("pre, code")
    );
    // If embedded HTML introduces extra list nodes, leave it to the renderer.
    if (source.length === rendered.length) {
      for (let index = 0; index < source.length; index++) {
        if (source[index]!.marker === "-" && !source[index]!.task)
          rendered[index]!.setAttribute("data-notes-list-style", "dash");
      }
    }
  }
  if (plugin.options.underline !== false) {
    const source = analysis.emphasis.filter((mark) => mark.from >= start && mark.to <= end);
    const rendered = descendantsIncludingRoot(el, "strong").filter(
      (node) => !node.closest("pre, code")
    );
    // Pair source tokens with DOM nodes in preorder. Refuse ambiguous mappings.
    if (source.length !== rendered.length) return;
    for (let index = 0; index < source.length; index++) {
      if (source[index]!.markup !== "__") continue;
      const strong = rendered[index]!;
      const underline = strong.ownerDocument.createElement("u");
      for (const attribute of Array.from(strong.attributes))
        underline.setAttribute(attribute.name, attribute.value);
      underline.classList.add("notes-underline");
      if (source[index]!.boldAncestor) underline.classList.add("notes-underline-bold");
      while (strong.firstChild) underline.appendChild(strong.firstChild);
      strong.replaceWith(underline);
    }
  }
}

export { createMarkupExtension, postprocessMarkup };
