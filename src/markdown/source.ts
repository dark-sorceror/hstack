export interface SourceLine {
  from: number;
  to: number;
  raw: string;
  value: string;
}
interface Fence {
  char: string;
  length: number;
}
interface BlockState {
  fence: Fence | null;
  math: boolean;
}
export interface IndexedSourceLine extends SourceLine {
  before: BlockState & { comment: boolean };
}
export interface LexicalAnalysis {
  text: string;
  lines: IndexedSourceLine[];
  lineIndex(position: number): number;
  protectedAt(position: number): boolean;
}

export function sourceLines(text: string): SourceLine[] {
  let from = 0;
  return text.split("\n").map((raw) => {
    const line = {
      from,
      to: from + raw.length,
      raw,
      value: raw.endsWith("\r") ? raw.slice(0, -1) : raw,
    };
    from += raw.length + 1;
    return line;
  });
}

function advance(line: string, state: BlockState) {
  let { fence, math } = state;
  let boundary = false;
  const opening = /^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?(`{3,}|~{3,})(.*)$/.exec(line);
  if (opening) {
    const marker = opening[1] || "";
    if (!fence) fence = { char: marker[0] || "", length: marker.length };
    else if (
      marker[0] === fence.char &&
      marker.length >= fence.length &&
      !(opening[2] || "").trim()
    ) {
      fence = null;
      boundary = true;
    }
  }
  if (!fence && /^\s*\$\$/.test(line)) {
    const delimiters = line.match(/(?<!\\)\$\$/g) || [];
    if (delimiters.length % 2) math = !math;
    boundary = true;
  }
  return { fence, math, boundary };
}

/**
 * Immutable, UTF-16 source index. Block state is computed once, then protection
 * queries scan only the current line prefix. No normalization changes offsets.
 */
export function analyzeLexical(text: string): LexicalAnalysis {
  const lines = sourceLines(text);
  let state: BlockState = { fence: null, math: false };
  let comment = false;
  let yamlEnd = -1;
  if (/^\uFEFF?---$/.test(lines[0]?.value || "")) {
    const closing = lines.findIndex(
      (line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line.value)
    );
    yamlEnd = closing < 0 ? text.length : (lines[closing]?.to ?? text.length);
  }
  const indexed = lines.map((line) => {
    const before = { ...state, comment };
    state = advance(line.value, state);
    const open = line.value.lastIndexOf("<!--"),
      close = line.value.lastIndexOf("-->");
    if (open >= 0 || close >= 0) comment = open > close;
    return { ...line, before };
  });

  function lineIndex(position: number) {
    let low = 0,
      high = indexed.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((indexed[middle]?.from ?? Infinity) <= position) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  function protectedAt(position: number) {
    if (yamlEnd >= 0 && position >= (text.charCodeAt(0) === 0xfeff ? 4 : 3) && position <= yamlEnd)
      return true;
    const line = indexed[lineIndex(position)];
    if (!line) return false;
    const current = text.slice(line.from, position).replace(/\r$/, "");
    const at = advance(current, line.before);
    if (at.fence || at.math || at.boundary) return true;
    const open = current.lastIndexOf("<!--"),
      close = current.lastIndexOf("-->");
    if (open >= 0 || close >= 0 ? open > close : line.before.comment) return true;
    let delimiter: string | null = null;
    for (const match of current.matchAll(/(?<!\\)(`+)/g)) {
      if (!delimiter) delimiter = match[1]!;
      else if (delimiter === match[1]) delimiter = null;
    }
    if (delimiter) return true;
    const dollars = current.match(/(?<!\\)\$(?!\$)/g);
    return !!dollars && dollars.length % 2 === 1;
  }
  return { text, lines: indexed, lineIndex, protectedAt };
}

// Bounded two-document cache for repeated typing/suggestion queries. Metadata
// keeps one explicit index for its whole scan, including documents above this cap.
const cache = new Map<string, LexicalAnalysis>();
const MAX_CACHE_CHARS = 2 * 1024 * 1024;
export function lexicalFor(text: string) {
  const existing = cache.get(text);
  if (existing) return existing;
  const analysis = analyzeLexical(text);
  if (text.length <= MAX_CACHE_CHARS) {
    if (cache.size >= 2) cache.delete(cache.keys().next().value!);
    cache.set(text, analysis);
  }
  return analysis;
}
