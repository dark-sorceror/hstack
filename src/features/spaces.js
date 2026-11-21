"use strict";

// Match the four-space groups produced by Obsidian's native leading-indent
// decorator. A quote marker consumes its optional following space; tabs remain
// separate and are deliberately never included in these ranges.
function leadingSpaceGroups(text) {
  const prefix = /^[\s>]+/.exec(text)?.[0];
  if (!prefix) return [];
  const ranges = [];
  let index = 0;
  while (index < prefix.length) {
    const start = index;
    const char = prefix[index];
    if (char === ">") {
      index++;
      if (prefix[index] === " ") index++;
      continue;
    }
    if (char === "\t") {
      index++;
      continue;
    }
    let fullGroup = true;
    const end = index + 4;
    for (let next = index; next < end; next++) {
      if (prefix[next] !== " ") {
        index = next;
        fullGroup = false;
        break;
      }
    }
    if (fullGroup) {
      ranges.push({ from: start, to: end });
      index = end;
    } else index++;
  }
  return ranges;
}

function createLiteralSpaceExtension(plugin, { Decoration, ViewPlugin }) {
  const mark = Decoration.mark({ class: "notes-literal-space-indent" });
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.enabled = plugin.options.literalSpaces !== false;
        this.decorations = this.build(view);
      }

      update(update) {
        const enabled = plugin.options.literalSpaces !== false;
        if (enabled !== this.enabled || update.docChanged || update.viewportChanged) {
          this.enabled = enabled;
          this.decorations = this.build(update.view);
        }
      }

      build(view) {
        if (!this.enabled) return Decoration.none;
        const ranges = [];
        const seen = new Set();
        for (const visible of view.visibleRanges) {
          const first = view.state.doc.lineAt(visible.from).number;
          const last = view.state.doc.lineAt(visible.to).number;
          for (let number = first; number <= last; number++) {
            if (seen.has(number)) continue;
            seen.add(number);
            const line = view.state.doc.line(number);
            for (const group of leadingSpaceGroups(line.text))
              ranges.push(mark.range(line.from + group.from, line.from + group.to));
          }
        }
        return Decoration.set(ranges, true);
      }
    },
    { decorations: (value) => value.decorations }
  );
}

module.exports = { leadingSpaceGroups, createLiteralSpaceExtension };
