"use strict";

const { protectedContext } = require("./logic.js");

function quotedBody(line) {
  const prefix = /^(?: {0,3}>[ \t]?)+/.exec(line)?.[0] || "";
  return { prefix, body: line.slice(prefix.length) };
}

function protectedLines(lines) {
  const protectedSet = new Set();
  let yaml = /^\uFEFF?---[ \t]*$/.test(lines[0] || "");
  let fence = null,
    math = null,
    comment = false,
    html = null,
    managed = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
      { prefix, body } = quotedBody(line);
    if (yaml) {
      protectedSet.add(index);
      if (index > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line)) yaml = false;
      continue;
    }
    if (fence) {
      protectedSet.add(index);
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(body);
      if (
        close &&
        close[1][0] === fence.char &&
        close[1].length >= fence.size &&
        (prefix.match(/>/g) || []).length === fence.quoteDepth
      )
        fence = null;
      continue;
    }
    if (math) {
      protectedSet.add(index);
      if (math === "dollar" ? /(?<!\\)\$\$/.test(body) : /\\\]/.test(body)) math = null;
      continue;
    }
    if (comment) {
      protectedSet.add(index);
      if (line.includes("-->")) comment = false;
      continue;
    }
    if (html) {
      protectedSet.add(index);
      if (new RegExp(`</${html}\\s*>`, "i").test(line)) html = null;
      continue;
    }
    if (managed || /^<!-- notes-toc:start -->[ \t]*$/.test(line)) {
      protectedSet.add(index);
      managed = !/^<!-- notes-toc:end -->[ \t]*$/.test(line);
      continue;
    }
    if (line.includes("<!--")) {
      protectedSet.add(index);
      comment = line.lastIndexOf("<!--") > line.lastIndexOf("-->");
      continue;
    }
    const htmlOpen = /<(pre|code|script|style|table|div|section|details)\b/i.exec(line);
    if (htmlOpen) {
      protectedSet.add(index);
      if (!new RegExp(`</${htmlOpen[1]}\\s*>`, "i").test(line)) html = htmlOpen[1];
      continue;
    }
    // Four-space indentation can be code or an aligned nested structure.
    // Leave it intact instead of guessing which spacing is disposable.
    if (/^(?: {4}|\t)/.test(body)) {
      protectedSet.add(index);
      continue;
    }
    const opening = /^ {0,3}(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(body);
    if (opening) {
      protectedSet.add(index);
      fence = {
        char: opening[1][0],
        size: opening[1].length,
        quoteDepth: (prefix.match(/>/g) || []).length,
      };
      continue;
    }
    const dollars = body.match(/(?<!\\)\$\$/g) || [];
    if (dollars.length || /\\\[/.test(body)) {
      protectedSet.add(index);
      if (dollars.length % 2) math = "dollar";
      else if (/\\\[/.test(body) && !/\\\]/.test(body)) math = "bracket";
      continue;
    }
    // Inline code/math, tables, horizontal rules and diagram-like alignment
    // keep their entire source line, including significant trailing spaces.
    if (
      /(?<!\\)[`$|]/.test(body) ||
      /^ {0,3}(?:[-*_][ \t]*){3,}$/.test(body) ||
      /[→←↔⟶⟵⟷↑↓│┃─━┌┐└┘├┤┬┴┼]/.test(body) ||
      /-->|<--|[-=]{3,}/.test(body) ||
      (!/^ {0,3}#{1,6}[ \t]/.test(body) && /\S[ \t]{2,}\S.*?[ \t]{2,}\S/.test(body))
    )
      protectedSet.add(index);
  }
  // Setext heading underlines belong to the preceding line as one unit.
  for (let index = 1; index < lines.length; index++) {
    if (
      /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index]) &&
      lines[index - 1].trim() &&
      !/^\s*(?:>|#{1,6}(?:\s|$)|[-+*][ \t]|\d+[.)][ \t])/.test(lines[index - 1])
    ) {
      protectedSet.add(index - 1);
      protectedSet.add(index);
    }
  }
  return protectedSet;
}

function trimProse(line) {
  if (!line.trim()) return "";
  return / {2,}$/.test(line) ? line.replace(/[ \t]+$/, "  ") : line.replace(/[ \t]+$/, "");
}

function formatMarkdown(text) {
  if (!text) return text;
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/),
    guarded = protectedLines(lines),
    headings = new Set();
  const normalized = lines.map((line, index) => {
    if (guarded.has(index)) return line;
    const { prefix, body } = quotedBody(line);
    const heading = /^( {0,3})(#{1,6})[ \t]+(.*)$/.exec(body);
    if (heading) {
      const content = heading[3].replace(/[ \t]+$/, "").replace(/[ \t]+(#+)$/, " $1");
      if (!prefix) headings.add(index);
      return prefix + heading[1] + heading[2] + (content ? " " + content : "");
    }
    const item = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(body);
    if (item) {
      // Marker spacing controls continuation indentation. Only normalize a
      // leaf item's gap when no following indented continuation relies on it.
      let next = index + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      const following = quotedBody(lines[next] || "");
      const indent = item[1].replace(/\t/g, "    ").length;
      const followingIndent = /^[ \t]*/.exec(following.body)[0].replace(/\t/g, "    ").length;
      const continuation =
        next < lines.length && following.prefix === prefix && followingIndent > indent;
      const gap = continuation ? item[3] : " ";
      const content = item[4].replace(/^(\[[ xX-]\])[ \t]+(?=\S)/, "$1 ");
      if (!content.trim()) return prefix + item[1] + item[2] + " ";
      return trimProse(prefix + item[1] + item[2] + gap + content);
    }
    return trimProse(line);
  });
  const output = [];
  for (let index = 0; index < normalized.length; index++) {
    if (headings.has(index) && output.length && output.at(-1).trim()) output.push("");
    output.push(normalized[index]);
    if (headings.has(index) && index + 1 < normalized.length && normalized[index + 1].trim())
      output.push("");
  }
  return output.join(eol);
}

function minimalChange(before, after) {
  if (before === after) return null;
  let from = 0,
    to = before.length,
    end = after.length;
  while (from < to && from < end && before[from] === after[from]) from++;
  while (to > from && end > from && before[to - 1] === after[end - 1]) {
    to--;
    end--;
  }
  return { from, to, insert: after.slice(from, end) };
}

function planFormat(text, from, to) {
  if (from < 0 || to < from || to > text.length) return null;
  const token = text.slice(from, to).trim().toLowerCase();
  if (
    !/^\/[a-z]*$/.test(token) ||
    !["format", "tidy"].some((name) => name.startsWith(token.slice(1)))
  )
    return null;
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const newline = text.indexOf("\n", to),
    end = newline < 0 ? text.length : newline;
  if (
    text.slice(start, from).trim() ||
    text.slice(to, end).trim() ||
    /^(?: {4}|\t)/.test(text.slice(start, from)) ||
    protectedContext(text, from)
  )
    return null;
  const withoutCommand = text.slice(0, start) + text.slice(newline < 0 ? end : end + 1);
  const formatted = formatMarkdown(withoutCommand),
    change = minimalChange(text, formatted);
  if (!change) return null;
  return {
    changes: [change],
    cursor: Math.min(start, formatted.length),
    changed: formatted !== withoutCommand,
  };
}

module.exports = { formatMarkdown, planFormat, minimalChange };
