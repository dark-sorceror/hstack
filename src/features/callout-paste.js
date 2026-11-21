"use strict";

const { protectedContext } = require("./logic.js");

function quoteInfo(line) {
  let position = /^( {0,3})/.exec(line)[0].length;
  const indent = line.slice(0, position);
  let depth = 0;
  while (line[position] === ">") {
    depth++;
    position++;
    if (/[ \t]/.test(line[position] || "")) position++;
  }
  return depth
    ? { depth, prefix: line.slice(0, position), body: line.slice(position), indent }
    : null;
}

function header(info) {
  return info && /^\[![A-Za-z][\w-]*\][+-]?(?:[ \t]|$)/.test(info.body);
}

function linesOf(text) {
  let offset = 0;
  return text.split("\n").map((value) => {
    const line = { value, from: offset, to: offset + value.length, quote: quoteInfo(value) };
    offset += value.length + 1;
    return line;
  });
}

function lineAt(lines, position) {
  let index = 0;
  while (index + 1 < lines.length && lines[index + 1].from <= position) index++;
  return index;
}

function calloutAt(text, lines, index) {
  const current = lines[index].quote;
  if (!current) return null;
  for (let scan = index; scan >= 0; scan--) {
    const line = lines[scan];
    if (!line.quote) break;
    if (
      header(line.quote) &&
      line.quote.depth <= current.depth &&
      !protectedContext(text, line.from + line.quote.prefix.length)
    )
      return { index: scan, depth: line.quote.depth };
  }
  return null;
}

function removeQuoteLevels(line, depth) {
  let position = /^( {0,3})/.exec(line)[0].length;
  for (let count = 0; count < depth; count++) {
    if (line[position] !== ">") return line;
    position++;
    if (/[ \t]/.test(line[position] || "")) position++;
  }
  return line.slice(position);
}

// A quoted first line means the clipboard already carries the container.
// Otherwise quote characters in the payload are nested content, so keep them.
function quotedLines(payload, depth, indent, alreadyQuoted) {
  const prefix = indent + "> ".repeat(depth);
  return payload.map((line) => {
    const info = quoteInfo(line);
    if (alreadyQuoted && info) {
      if (info.depth >= depth) return line;
      return indent + "> ".repeat(depth - info.depth) + line.slice(info.indent.length);
    }
    return prefix + line;
  });
}

// Returns one replacement, not a newline/paste event. The editor adapter can
// apply it after Obsidian has converted rich clipboard content to Markdown.
function calloutPastePlan(text, from, to, pasted) {
  if (
    typeof pasted !== "string" ||
    !/[\r\n]/.test(pasted) ||
    from < 0 ||
    to < from ||
    to > text.length
  )
    return null;
  const originalTo = to;
  const payload = pasted.replace(/\r\n?/g, "\n").split("\n");
  const lines = linesOf(text),
    startIndex = lineAt(lines, from),
    endIndex = lineAt(lines, to);
  const startLine = lines[startIndex],
    endLine = lines[endIndex];
  const context = calloutAt(text, lines, startIndex);
  let insert;
  if (context) {
    const quote = startLine.quote;
    const prefixEnd = startLine.from + quote.prefix.length;
    if (from !== startLine.from && from < prefixEnd) return null;
    // A selection at the start of a quoted line owns its prefix. A collapsed
    // caret before that prefix is ambiguous, and stays with native paste.
    if (from === startLine.from && to < prefixEnd) return null;
    for (let index = startIndex; index <= endIndex; index++) {
      const line = lines[index];
      if (!line.quote || line.quote.depth < context.depth) return null;
      if (
        index > context.index &&
        header(line.quote) &&
        line.quote.depth <= context.depth &&
        !protectedContext(text, line.from + line.quote.prefix.length)
      )
        return null;
    }
    // Selecting through the next line's beginning leaves its quote prefix in
    // the document. Include that prefix in our replacement to avoid doubling.
    if (endIndex > startIndex && to === endLine.from) to += endLine.quote.prefix.length;
    else if (to > endLine.from && to < endLine.from + endLine.quote.prefix.length) return null;
    const output = quotedLines(payload, quote.depth, quote.indent, !!quoteInfo(payload[0]));
    if (from >= prefixEnd) output[0] = removeQuoteLevels(output[0], quote.depth);
    insert = output.join("\n");
  } else {
    // Outside a callout, only a full pasted callout on an otherwise empty
    // destination line is eligible. An unquoted blank ends this pasted block;
    // unrelated following paragraphs retain their original Markdown.
    if (
      startLine.quote ||
      protectedContext(text, from) ||
      text.slice(startLine.from, from).trim() ||
      text.slice(to, endLine.to).trim()
    )
      return null;
    const first = quoteInfo(payload[0]);
    if (!header(first)) return null;
    let boundary = payload.findIndex((line, index) => index > 0 && !line.trim());
    if (boundary < 0) boundary = payload.length;
    const block = quotedLines(payload.slice(0, boundary), first.depth, first.indent, true);
    insert = [...block, ...payload.slice(boundary)].join("\n");
  }
  if (insert === pasted && to === originalTo) return null;
  return { from, to, insert, cursor: from + insert.length };
}

module.exports = { calloutPastePlan };
