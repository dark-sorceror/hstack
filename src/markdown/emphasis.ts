export interface SourceListItem {
  marker: string;
  ordered: boolean;
  depth: number;
  contentColumn: number;
  quoteDepth: number;
  task: boolean;
  body: string;
}
export interface ScannedListItem extends SourceListItem {
  line: number;
  from: number;
  to: number;
}
export interface EmphasisToken {
  from: number;
  innerFrom: number;
  innerTo: number;
  to: number;
  markup: "html" | "__" | "**";
  boldAncestor?: boolean;
  underlineAncestor?: boolean;
}
export interface SourceScan {
  mask: Uint8Array;
  blockMask: Uint8Array;
  lists: ScannedListItem[];
  htmlStrong: EmphasisToken[];
}
import { createContainmentIndex } from "./ranges.js";

export function escaped(text: string, position: number) {
  let slashes = 0;
  while (position > 0 && text[--position] === "\\") slashes++;
  return slashes % 2 === 1;
}

export function columns(indent: string) {
  let size = 0;
  for (const char of indent) size += char === "\t" ? 4 - (size % 4) : 1;
  return size;
}

// Successful list matches have mandatory indent/body captures and one marker branch.
export function sourceListItem(line: string): SourceListItem | null {
  const quote = /^(?:[ \t]*>[ \t]?)+/.exec(line)?.[0] || "";
  const match = /^([ \t]*)(?:(\d+)([.)])|([-+*]))([ \t]+)(.*)$/.exec(line.slice(quote.length));
  if (!match) return null;
  return {
    marker: match[4] || match[2]! + match[3]!,
    ordered: !!match[2],
    depth: columns(match[1]!),
    contentColumn: columns(match[1]! + (match[4] || match[2]! + match[3]!) + match[5]),
    quoteDepth: (quote.match(/>/g) || []).length,
    task: /^\[[ xX-]\](?:\s|$)/.test(match[6]!),
    body: match[6]!,
  };
}

export function scanSource(text: string): SourceScan {
  const mask = new Uint8Array(text.length);
  const lists: ScannedListItem[] = [];
  const lines = text.split("\n");
  let offset = 0,
    fence: { char: string; length: number } | null = null,
    math = false,
    yaml = lines[0]?.trim() === "---";
  let parents: { depth: number; contentColumn: number }[] = [],
    quoteDepth = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!,
      end = offset + line.length;
    const list = sourceListItem(line);
    const unquoted = line.replace(/^(?:[ \t]*>[ \t]?)+/, "");
    const body = list ? list.body : unquoted.trimStart();
    let blocked = false;
    if (yaml) {
      blocked = true;
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) yaml = false;
    } else if (fence) {
      blocked = true;
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(unquoted);
      if (closing && closing[1]![0] === fence.char && closing[1]!.length >= fence.length)
        fence = null;
    } else if (math) {
      blocked = true;
      if (/^\s*\$\$\s*$/.test(unquoted)) math = false;
    } else {
      if (list && list.quoteDepth !== quoteDepth) parents = [];
      if (list) quoteDepth = list.quoteDepth;
      const leading = /^[ \t]*/.exec(unquoted)![0]!;
      const indent = columns(leading);
      const parent = parents.filter((parent) => parent.depth < indent).at(-1);
      if (indent >= 4 && (!parent || indent >= parent.contentColumn + 4)) blocked = true;
      if (!blocked && list) {
        lists.push({ ...list, line: index, from: offset, to: end });
        parents = parents.filter((parent) => parent.depth < list.depth);
        parents.push({ depth: list.depth, contentColumn: list.contentColumn });
      } else if (line.trim() && indent === 0 && !list) parents = [];
      const opening = /^(`{3,}|~{3,})(.*)$/.exec(body);
      if (opening) {
        blocked = true;
        fence = { char: opening[1]![0]!, length: opening[1]!.length };
      }
      if (/^\s*\$\$/.test(unquoted)) {
        blocked = true;
        math = (unquoted.match(/(?<!\\)\$\$/g) || []).length % 2 === 1;
      }
    }
    if (blocked) mask.fill(1, offset, Math.min(text.length, end + 1));
    offset = end + 1;
  }
  for (const match of text.matchAll(/<!--[\s\S]*?(?:-->|$)/g))
    mask.fill(1, match.index, match.index + match[0].length);
  for (const match of text.matchAll(/<(pre|code)\b[^>]*>[\s\S]*?<\/\1\s*>/gi))
    mask.fill(1, match.index, match.index + match[0].length);
  const blockMask = mask.slice();

  let code: { from: number; size: number } | null = null;
  for (const match of text.matchAll(/`+/g)) {
    if (mask[match.index] || escaped(text, match.index)) continue;
    if (!code) code = { from: match.index, size: match[0].length };
    else if (match[0].length === code.size) {
      mask.fill(1, code.from, match.index + match[0].length);
      code = null;
    }
  }
  if (code) mask.fill(1, code.from);
  for (const match of text.matchAll(/\]\((?:\\.|[^)\n])*\)/g))
    mask.fill(1, match.index + 2, match.index + match[0].length - 1);
  for (const match of text.matchAll(/\[\[[^\]\n]*\]\]|\bhttps?:\/\/[^\s<>]+/g))
    mask.fill(1, match.index, match.index + match[0].length);
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "$" || mask[index] || escaped(text, index)) continue;
    let end = index + 1;
    while (end < text.length && text[end] !== "\n" && (text[end] !== "$" || escaped(text, end)))
      end++;
    if (text[end] === "$") end++;
    mask.fill(1, index, end);
    index = end - 1;
  }

  const htmlStrong: EmphasisToken[] = [],
    stack: { from: number; innerFrom: number }[] = [];
  for (const match of text.matchAll(/<\/?strong\b[^>]*>/gi)) {
    if (mask[match.index]) continue;
    if (!match[0].startsWith("</"))
      stack.push({ from: match.index, innerFrom: match.index + match[0].length });
    else if (stack.length) {
      const opening = stack.pop()!;
      htmlStrong.push({
        ...opening,
        innerTo: match.index,
        to: match.index + match[0].length,
        markup: "html",
      });
    }
  }
  // Do not interpret underscores or stars inside HTML attributes as emphasis.
  for (const match of text.matchAll(/<\/?[A-Za-z][^>\n]*>/g))
    mask.fill(1, match.index, match.index + match[0].length);
  return { mask, blockMask, lists, htmlStrong };
}

export function getEmphasis(text: string, scanned: SourceScan = scanSource(text)) {
  const result = [...scanned.htmlStrong];
  const word = (char: string | undefined) => !!char && /[\p{L}\p{N}_]/u.test(char);
  function parse(from: number, to: number): void {
    for (let position = from; position < to - 1; position++) {
      const marker = text.slice(position, position + 2);
      if ((marker !== "__" && marker !== "**") || scanned.mask[position] || escaped(text, position))
        continue;
      if (
        !text[position + 2] ||
        /\s/.test(text[position + 2]!) ||
        (marker === "__" && word(text[position - 1]))
      )
        continue;
      let close = text.indexOf(marker, position + 2);
      while (close >= 0 && close < to) {
        if (
          !scanned.mask[close] &&
          !escaped(text, close) &&
          !/\s/.test(text[close - 1]!) &&
          (marker !== "__" || !word(text[close + 2]))
        )
          break;
        close = text.indexOf(marker, close + 1);
      }
      if (close < 0 || close >= to) continue;
      if (/\n[ \t]*\n/.test(text.slice(position + 2, close))) continue;
      result.push({
        from: position,
        innerFrom: position + 2,
        innerTo: close,
        to: close + 2,
        markup: marker as "__" | "**",
      });
      parse(position + 2, close);
      position = close + 1;
    }
  }
  parse(0, text.length);
  result.sort((a, b) => a.from - b.from || b.to - a.to);
  // A token's own inner range starts after its opening delimiter, so it
  // cannot contain itself. Index both roles instead of comparing every pair.
  const boldContains = createContainmentIndex(result.filter((mark) => mark.markup !== "__"));
  const underlineContains = createContainmentIndex(result.filter((mark) => mark.markup === "__"));
  for (const token of result) {
    token.boldAncestor = boldContains(token.from, token.to);
    token.underlineAncestor = underlineContains(token.from, token.to);
  }
  return result;
}

export function getUnderlineDelimiters(
  text: string,
  carets: readonly number[] = [],
  emphasis: readonly EmphasisToken[] = getEmphasis(text)
) {
  const ranges = [];
  for (const mark of emphasis) {
    if (
      mark.markup !== "__" ||
      !text.slice(mark.innerFrom, mark.innerTo).replace(/[*_]/g, "").trim()
    )
      continue;
    const editingDelimiter = carets.some(
      (position) =>
        (position > mark.from && position < mark.innerFrom) ||
        (position > mark.innerTo && position < mark.to)
    );
    if (!editingDelimiter) {
      ranges.push({ from: mark.from, to: mark.innerFrom });
      ranges.push({ from: mark.innerTo, to: mark.to });
    }
  }
  return ranges;
}
