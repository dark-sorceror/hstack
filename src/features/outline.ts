import type { EditorPlan, EditChange } from "./types.js";
export interface SourceHeading {
  level: number;
  text: string;
  from: number;
  line: number;
}

import { isCommandPrefix } from "../commands/catalog.js";
import { protectedContext } from "./logic.js";
import { sourceLines } from "../markdown/source.js";

export const START = "<!-- notes-toc:start -->";
export const END = "<!-- notes-toc:end -->";

function managedBlock(text: string) {
  const starts = [...text.matchAll(/^<!-- notes-toc:start -->[ \t]*(?=\r?$)/gm)].filter(
    (match) => !protectedContext(text, match.index)
  );
  const ends = [...text.matchAll(/^<!-- notes-toc:end -->[ \t]*(?=\r?$)/gm)].filter(
    (match) => !protectedContext(text, match.index)
  );
  if (!starts.length && !ends.length) return undefined;
  // Do not overwrite an ambiguous or incomplete user-edited marker block.
  if (starts.length !== 1 || ends.length !== 1 || ends[0]!.index < starts[0]!.index) return null;
  return { from: starts[0]!.index, to: ends[0]!.index + ends[0]![0].length };
}

export function headingText(source: string) {
  const escapes: string[] = [];
  let text = source.trim().replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, (_: string, char: string) => {
    escapes.push(char);
    return "\uE000" + (escapes.length - 1) + "\uE001";
  });
  text = text.replace(/!?\[\[([^\]\n]+)\]\]/g, (_: string, body: string) =>
    body.split("|").at(-1)!
  );
  text = text.replace(/!?\[([^\]\n]+)\]\((?:\\.|[^)\n])*\)/g, "$1");
  text = text.replace(/(`+)([\s\S]*?)\1/g, "$2");
  for (let repeat = 0; repeat < 3; repeat++) {
    text = text.replace(/(\*{1,3}|_{1,3}|~~)(?=\S)(.+?\S|\S)\1/g, "$2");
  }
  text = text.replace(/<\/?[A-Za-z][^>]*>/g, "");
  text = text.replace(
    /&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos);/gi,
    (entity: string, name: string) => {
      if (name[0] === "#") {
        const value =
          name[1]!.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : entity;
      }
      const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      // The non-numeric branch of the entity regex admits exactly these names.
      return entities[name.toLowerCase() as keyof typeof entities];
    }
  );
  return text
    .replace(/\uE000(\d+)\uE001/g, (_: string, index: string) => escapes[Number(index)]!)
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function scanHeadings(text: string) {
  const managed = managedBlock(text);
  const result: SourceHeading[] = [],
    lines = sourceLines(text);
  let fence: { char: string; length: number } | null = null,
    math = false,
    comment = false,
    yaml = /^\uFEFF?---[ \t]*$/.test(lines[0]?.value || "");
  let previous: { text: string; from: number; line: number } | null = null,
    listParents: { indent: number; content: number }[] = [];
  for (let index = 0; index < lines.length; index++) {
    // Classify without the CR while retaining the original source offsets.
    const { value: raw, from } = lines[index]!;
    if (managed && from >= managed.from && from < managed.to) {
      previous = null;
      continue;
    }
    if (yaml) {
      if (index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(raw)) yaml = false;
      previous = null;
      continue;
    }
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})[ \t]*$/.exec(raw);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null;
      previous = null;
      continue;
    }
    if (math) {
      if (/^\s*\$\$\s*$/.test(raw)) math = false;
      previous = null;
      continue;
    }
    let line = "",
      position = 0;
    while (position < raw.length) {
      if (comment) {
        const close = raw.indexOf("-->", position);
        if (close < 0) break;
        comment = false;
        position = close + 3;
      } else {
        const open = raw.indexOf("<!--", position);
        if (open < 0) {
          line += raw.slice(position);
          break;
        }
        line += raw.slice(position, open);
        comment = true;
        position = open + 4;
      }
    }
    if (/^ {0,3}>/.test(line)) {
      previous = null;
      continue;
    }
    const opening = /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening) {
      fence = { char: opening[1]![0]!, length: opening[1]!.length };
      previous = null;
      continue;
    }
    const item = /^([ \t]*)(?:[-+*]|\d+[.)])([ \t]+)/.exec(line);
    const indent = /^[ \t]*/.exec(line)![0]!.replace(/\t/g, "    ").length;
    if (item) {
      listParents = listParents.filter((parent) => parent.indent < indent);
      listParents.push({ indent, content: item[0].replace(/\t/g, "    ").length });
      previous = null;
      continue;
    }
    if (indent >= 4 || listParents.some((parent) => indent >= parent.content)) {
      previous = null;
      continue;
    }
    if (line.trim()) listParents = [];
    if (/^\s*\$\$/.test(line)) {
      math = (line.match(/(?<!\\)\$\$/g) || []).length % 2 === 1;
      previous = null;
      continue;
    }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(line);
    if (atx) {
      const title = headingText((atx[2] || "").replace(/[ \t]+#+[ \t]*$/, ""));
      if (title) result.push({ level: atx[1]!.length, text: title, from, line: index });
      previous = null;
      continue;
    }
    const underline = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
    if (underline && previous && previous.line === index - 1) {
      const title = headingText(previous.text);
      if (title)
        result.push({
          level: underline[1]![0] === "=" ? 1 : 2,
          text: title,
          from: previous.from,
          line: previous.line,
        });
      previous = null;
      continue;
    }
    previous =
      line.trim() && !/^\s*(?:<|[-+*][ \t]|\d+[.)][ \t])/.test(line)
        ? { text: line.trim(), from, line: index }
        : null;
  }
  return result;
}

export function headingLink(title: string) {
  // Wiki delimiters cannot safely hold every literal heading. A normal
  // same-page Markdown link handles these rare names without broken syntax.
  if (/[|[\]\\]/.test(title)) {
    const label = title.replace(/[\\[\]*_`|]/g, "\\$&");
    const fragment = encodeURIComponent(title).replace(
      /[!'()*]/g,
      (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase()
    );
    return `[${label}](#${fragment})`;
  }
  return `[[#${title}|${title}]]`;
}

export function contentsBlock(headings: readonly SourceHeading[]) {
  const levels: number[] = [],
    entries: string[] = [];
  for (const heading of headings) {
    while (levels.length && levels.at(-1)! >= heading.level) levels.pop();
    entries.push("  ".repeat(levels.length) + "* " + headingLink(heading.text));
    levels.push(heading.level);
  }
  return `${START}\n**Contents**\n\n${entries.join("\n")}\n${END}`;
}

export function planTOC(
  text: string,
  from: number,
  to: number
): (EditorPlan & { headingCount: number; updated: boolean }) | null {
  if (from < 0 || to < from || to > text.length) return null;
  const token = text.slice(from, to).trim().toLowerCase();
  if (!isCommandPrefix("toc", token)) return null;
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const nextLine = text.indexOf("\n", to);
  const lineEnd = nextLine < 0 ? text.length : nextLine - (text[nextLine - 1] === "\r" ? 1 : 0);
  if (
    text.slice(lineStart, from).trim() ||
    text.slice(to, lineEnd).trim() ||
    /^[ \t]{4}|^\t/.test(text.slice(lineStart, from)) ||
    protectedContext(text, from)
  )
    return null;
  const existing = managedBlock(text);
  if (existing === null) return null;
  const headings = scanHeadings(text);
  if (!headings.length) return null;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const block = contentsBlock(headings).replaceAll("\n", eol),
    changes: EditChange[] = [];
  let blockFrom;
  if (existing) {
    changes.push({ from: existing.from, to: existing.to, insert: block });
    if (lineStart < existing.from || lineEnd > existing.to) {
      if (lineStart < existing.to && lineEnd > existing.from) return null;
      changes.push({ from: lineStart, to: nextLine < 0 ? lineEnd : nextLine + 1, insert: "" });
    }
    blockFrom = existing.from;
  } else {
    const after = text.slice(lineEnd);
    const padding = after.startsWith(eol + eol) ? "" : after.startsWith(eol) ? eol : eol + eol;
    changes.push({ from: lineStart, to: lineEnd, insert: block + padding });
    blockFrom = lineStart;
  }
  changes.sort((a, b) => a.from - b.from);
  const shift = changes
    .filter((change) => change.from < blockFrom)
    .reduce((total, change) => total + change.insert.length - (change.to - change.from), 0);
  return {
    changes,
    cursor: blockFrom + shift + block.length,
    headingCount: headings.length,
    updated: !!existing,
  };
}
