"use strict";

function width(indent, size) {
  let result = 0;
  for (const char of indent) result += char === "\t" ? size - result % size : 1;
  return result;
}

function indentation(columns, size, tabs) {
  return tabs
    ? "\t".repeat(Math.floor(columns / size)) + " ".repeat(columns % size)
    : " ".repeat(columns);
}

function item(text, size) {
  const match = /^([ \t]*)(?:(\d{1,9})([.)])|([-+*]))([ \t]+)(.*)$/.exec(text);
  if (!match) return null;
  return {
    indent: match[1], depth: width(match[1], size),
    number: match[2] ? Number(match[2]) : null,
    delimiter: match[3], bullet: match[4], body: match[6],
    prefixLength: text.length - match[6].length,
    task: /^\[[ xX-]\](?:\s|$)/.test(match[6])
  };
}

// Recognize fenced code, YAML, math, inline code, and HTML comments before
// applying prose-only shortcuts. The editor adapter adds a syntax/DOM guard.
function protectedContext(text, position) {
  const before = text.slice(0, position);
  const lines = before.split("\n");
  if (lines[0] === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end < 0 || end === lines.length - 1) return true;
  }
  let fence = null;
  let math = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const opening = /^\s*(?:>\s*)*(?:(?:[-+*]|\d+[.)])\s+)?(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening) {
      if (!fence) fence = { char: opening[1][0], length: opening[1].length };
      else if (opening[1][0] === fence.char && opening[1].length >= fence.length && !opening[2].trim()) {
        if (index === lines.length - 1) return true;
        fence = null;
      }
    }
    if (!fence && /^\s*\$\$/.test(line)) {
      const delimiters = line.match(/(?<!\\)\$\$/g) || [];
      if (delimiters.length % 2) math = !math;
      if (index === lines.length - 1) return true;
    }
  }
  if (fence || math || before.lastIndexOf("<!--") > before.lastIndexOf("-->")) return true;
  const current = lines[lines.length - 1];
  let delimiter = null;
  for (const match of current.matchAll(/(?<!\\)(`+)/g)) {
    if (!delimiter) delimiter = match[1];
    else if (delimiter === match[1]) delimiter = null;
  }
  if (delimiter) return true;
  const dollars = current.match(/(?<!\\)\$(?!\$)/g);
  return !!dollars && dollars.length % 2 === 1;
}

function previousAtDepth(lines, index, depth, size, lowerBound = 0) {
  let blanks = 0;
  for (let n = index - 1; n >= lowerBound; n--) {
    const line = lines[n];
    if (!line.trim()) { if (++blanks > 1) break; continue; }
    blanks = 0;
    const candidate = item(line, size);
    if (candidate) {
      if (candidate.depth === depth) return { ...candidate, line: n };
      if (candidate.depth < depth) break;
    } else if (width(/^\s*/.exec(line)[0], size) <= depth) break;
  }
  return null;
}

function parentOf(lines, index, depth, size) {
  let blanks = 0;
  for (let n = index - 1; n >= 0; n--) {
    const line = lines[n];
    if (!line.trim()) { if (++blanks > 1) break; continue; }
    blanks = 0;
    const candidate = item(line, size);
    if (candidate && candidate.depth < depth) return { ...candidate, line: n };
    if (!candidate && width(/^\s*/.exec(line)[0], size) < depth) break;
  }
  return null;
}

function nextMarker(previous) {
  return previous.number === null ? previous.bullet : `${previous.number + 1}${previous.delimiter}`;
}

function listPlan(text, lineIndex, column, action, options = {}) {
  const size = options.tabSize || 4;
  const tabs = options.useTabs !== false;
  const lines = text.split("\n");
  const current = item(lines[lineIndex] || "", size);
  if (!current) return null;
  const emptyTask = current.task && /^\[[ xX-]\]\s*$/.test(current.body);
  if (current.task && (!emptyTask || action === "indent")) return null;
  if (emptyTask) current.prefixLength = lines[lineIndex].length;
  if (column < current.prefixLength) return null;
  const offsets = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }
  if (protectedContext(text, offsets[lineIndex] + column)) return null;
  if (action === "exit" && !emptyTask && current.body.trim()) return null;

  let depth, marker;
  if (action === "indent") {
    const parent = previousAtDepth(lines, lineIndex, current.depth, size);
    if (!parent) return null;
    depth = current.depth + size;
    const sibling = previousAtDepth(lines, lineIndex, depth, size, parent.line + 1);
    marker = sibling ? nextMarker(sibling) : (parent.bullet || "*");
  } else {
    const parent = parentOf(lines, lineIndex, current.depth, size);
    if (!parent) return null;
    depth = parent.depth;
    marker = nextMarker(parent);
  }

  const prefix = indentation(depth, size, tabs) + marker + " ";
  const changes = [{ from: offsets[lineIndex], to: offsets[lineIndex] + current.prefixLength, insert: prefix }];
  const delta = depth - current.depth;
  // Move an existing item's descendants with it, preserving their relative
  // indentation. Do not touch following siblings or unrelated paragraphs.
  for (let n = lineIndex + 1; n < lines.length; n++) {
    if (!lines[n].trim()) {
      let next = n + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      if (next - n > 1) break;
      if (next >= lines.length || width(/^[ \t]*/.exec(lines[next])[0], size) <= current.depth) break;
      continue;
    }
    const leading = /^[ \t]*/.exec(lines[n])[0];
    const oldDepth = width(leading, size);
    if (oldDepth <= current.depth) break;
    changes.push({ from: offsets[n], to: offsets[n] + leading.length,
      insert: indentation(Math.max(0, oldDepth + delta), size, tabs) });
  }
  return {
    changes,
    cursor: offsets[lineIndex] + prefix.length + Math.max(0, column - current.prefixLength)
  };
}

function typographyPlan(text, from, to, typed) {
  if (from !== to || (typed !== "-" && typed !== ">") || protectedContext(text, from)) return null;
  const before = text.slice(0, from);
  const rules = typed === ">" ? [
    ["⟵", "⟷", "<-->"], ["<–", "⟷", "<-->"], ["<--", "⟷", "<-->"],
    ["–", "⟶", "-->"], ["--", "⟶", "-->"]
  ] : [
    ["<-", "⟵", "<--"], ["–", "—", "---"], ["--", "—", "---"], ["-", "–", "--"]
  ];
  for (const [suffix, insert, raw] of rules) {
    if (!before.endsWith(suffix)) continue;
    const start = from - suffix.length;
    if (before[start - 1] === "-" || before[start - 1] === "\\" ||
        before.slice(0, start).endsWith("<!") || protectedContext(text, start)) return null;
    return { from: start, to, insert, raw };
  }
  return null;
}

function prefixPlan(text, from, to, typed) {
  if (from !== to || (typed !== "-" && typed !== "]") || protectedContext(text, from)) return null;
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const before = text.slice(start, from);
  const match = /^([ \t]*)(?:(?:[-+*]|\d+[.)])[ \t]+)?([.\[])$/.exec(before);
  if (!match || (typed === "-" ? match[2] !== "." : match[2] !== "[")) return null;
  // Native bracket pairing may already have placed the closing ] ahead.
  const end = typed === "]" && text[from] === "]" ? from + 1 : to;
  return { from: start, to: end, insert: match[1] + (typed === "-" ? "* " : "- [ ] "), raw: before + typed };
}

function revertPlan(text, position, replacement) {
  if (!replacement || position !== replacement.to || text.slice(replacement.from, replacement.to) !== replacement.text)
    return null;
  return { from: replacement.from, to: replacement.to, insert: replacement.raw };
}

module.exports = { width, item, listPlan, typographyPlan, prefixPlan, revertPlan, protectedContext };
