"use strict";
const { escaped, scanSource, getEmphasis } = require("../markdown/emphasis.js");

// Match complete one-, two-, or three-character emphasis runs. This is used
// only to move over an existing closer, never to reinterpret ordinary text.
function delimiterPairs(text, key, mask) {
  const result = [],
    stack = [];
  const word = (char) => !!char && /[\p{L}\p{N}_]/u.test(char);
  const pattern = key === "*" ? /\*+/g : /_+/g;
  for (const match of text.matchAll(pattern)) {
    const from = match.index,
      to = from + match[0].length,
      length = match[0].length;
    if (length > 3 || mask[from] || escaped(text, from)) continue;
    const canOpen = !!text[to] && !/\s/.test(text[to]) && (key !== "_" || !word(text[from - 1]));
    const canClose = from > 0 && !/\s/.test(text[from - 1]) && (key !== "_" || !word(text[to]));
    const opening = stack[stack.length - 1];
    if (
      canClose &&
      opening &&
      opening.length === length &&
      !/\n[ \t]*\n/.test(text.slice(opening.to, from))
    ) {
      stack.pop();
      result.push({ from: opening.from, innerFrom: opening.to, innerTo: from, to });
    } else if (canOpen) stack.push({ from, to, length });
  }
  return result;
}

// Obsidian's live editor can leave * characters literal inside native __
// strong markup. Recognize only complete asterisk pairs inside our underline
// spans, retaining the native syntax everywhere outside those spans.
function getNestedAsteriskEmphasis(
  text,
  emphasis = getEmphasis(text),
  mask = scanSource(text).mask
) {
  const underlines = emphasis.filter((mark) => mark.markup === "__");
  return delimiterPairs(text, "*", mask)
    .filter(
      (pair) =>
        text.slice(pair.innerFrom, pair.innerTo).replace(/[*_]/g, "").trim() &&
        underlines.some((mark) => mark.innerFrom <= pair.from && pair.to <= mark.innerTo)
    )
    .map((pair) => {
      const length = pair.innerFrom - pair.from;
      return { ...pair, bold: length >= 2, italic: length % 2 === 1 };
    });
}

function getNestedAsteriskDelimiters(text, carets = [], pairs = getNestedAsteriskEmphasis(text)) {
  const ranges = [];
  for (const pair of pairs) {
    const editingDelimiter = carets.some(
      (position) =>
        (position > pair.from && position < pair.innerFrom) ||
        (position > pair.innerTo && position < pair.to)
    );
    if (!editingDelimiter) {
      ranges.push({ from: pair.from, to: pair.innerFrom });
      ranges.push({ from: pair.innerTo, to: pair.to });
    }
  }
  return ranges;
}

// The first marker remains Obsidian's native single-marker pairing. A second
// key upgrades that empty/native selected pair rather than closing it early.
// Contract: {changes:[{from,to,insert}], cursor, selection?:{anchor,head}}.
function pairPlan(text, from, to, key) {
  if ((key !== "*" && key !== "_") || from < 0 || to < from || to > text.length) return null;
  const scanned = scanSource(text);
  if (scanned.mask[from] || (from < to && scanned.mask.subarray(from, to).some(Boolean)))
    return null;
  const pairs = delimiterPairs(text, key, scanned.mask);
  if (from === to && text[from] === key && !escaped(text, from)) {
    const closing = pairs.find((pair) => from >= pair.innerTo && from < pair.to);
    if (closing) return { changes: [], cursor: from + 1 };
    // An opening run of a nonempty pair is not an empty auto-pair placeholder.
    if (pairs.some((pair) => from > pair.from && from < pair.innerFrom)) return null;
  }
  let left = 0,
    right = 0;
  while (from - left > 0 && text[from - left - 1] === key) left++;
  while (to + right < text.length && text[to + right] === key) right++;
  const start = from - left,
    end = to + right;
  const word = (char) => !!char && /[\p{L}\p{N}_]/u.test(char);
  const body = text.slice(from, to);
  const safeBoundary =
    key === "_"
      ? !word(text[start - 1]) && !word(text[end])
      : !(word(text[start - 1]) && word(text[end]));
  if (
    left === right &&
    left > 0 &&
    left < 3 &&
    safeBoundary &&
    !escaped(text, start) &&
    (!body || (body.trim() === body && !body.includes("\n") && !body.includes(key)))
  ) {
    const marker = key.repeat(left + 1);
    const anchor = start + marker.length,
      head = anchor + body.length;
    const plan = {
      changes: [{ from: start, to: end, insert: marker + body + marker }],
      cursor: head,
    };
    if (from !== to) plan.selection = { anchor, head };
    return plan;
  }
  return null;
}

// Apply this cleanup first, then let native Enter insert its newline. Keeping
// newline/list indentation native avoids bypassing Obsidian's list handling.
// Contract: {kind:'empty'|'finish', changes:[{from,to,insert}], cursor}.
function enterPairPlan(text, from, to = from) {
  if (from !== to || from < 0 || from > text.length) return null;
  const scanned = scanSource(text);
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const nextLine = text.indexOf("\n", from);
  const lineEnd = nextLine < 0 ? text.length : nextLine;
  if (scanned.blockMask[from] || (from > lineStart && scanned.blockMask[from - 1])) return null;
  const word = (char) => !!char && /[\p{L}\p{N}_]/u.test(char);
  const ordinary = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "“": "”", "‘": "’" };
  const pairs = [
    ...delimiterPairs(text, "*", scanned.mask),
    ...delimiterPairs(text, "_", scanned.mask),
  ].filter((pair) => pair.from >= lineStart && pair.to <= lineEnd);
  const insideCompletedMarker = pairs.some(
    (pair) => (from > pair.from && from < pair.innerFrom) || (from > pair.innerTo && from < pair.to)
  );
  let start = from,
    end = from;
  // An unused native pair has no content between its markers. Remove nested
  // empty pairs too, e.g. (**|**), rather than leave another unused closer.
  while (!insideCompletedMarker && start > lineStart && end < lineEnd) {
    const left = text[start - 1],
      right = text[end];
    let size = 0;
    if ((left === "*" || left === "_" || left === "`") && right === left) {
      let before = 0,
        after = 0;
      while (start - before > lineStart && text[start - before - 1] === left) before++;
      while (end + after < lineEnd && text[end + after] === left) after++;
      if (
        before === after &&
        before <= (left === "`" ? 2 : 3) &&
        (left !== "_" || (!word(text[start - before - 1]) && !word(text[end + after]))) &&
        (left !== "*" || !(word(text[start - before - 1]) && word(text[end + after])))
      )
        size = before;
    } else if (
      ordinary[left] === right &&
      (!['"', "'", "‘"].includes(left) || (!word(text[start - 2]) && !word(text[end + 1])))
    )
      size = 1;
    if (!size || escaped(text, start - size) || escaped(text, end)) break;
    // Inline code/math/links stay native, except the backtick pair itself.
    if (left !== "`" && (scanned.mask[start - size] || scanned.mask[end])) break;
    start -= size;
    end += size;
  }
  if (start !== from)
    return { kind: "empty", changes: [{ from: start, to: end, insert: "" }], cursor: start };

  const stack = [];
  let quote = null,
    code = null;
  for (let index = lineStart; index < lineEnd; index++) {
    if (scanned.blockMask[index] || escaped(text, index)) continue;
    const char = text[index];
    if (char === "`") {
      const run = /^`+/.exec(text.slice(index))[0].length;
      if (!code && run <= 2) code = { from: index, innerFrom: index + run, size: run };
      else if (code && run === code.size) {
        pairs.push({ from: code.from, innerFrom: code.innerFrom, innerTo: index, to: index + run });
        code = null;
      }
      index += run - 1;
      continue;
    }
    if (code || scanned.mask[index]) continue;
    if (quote) {
      if (char === quote.close && !/\s/.test(text[index - 1]) && !word(text[index + 1])) {
        pairs.push({ from: quote.from, innerFrom: quote.from + 1, innerTo: index, to: index + 1 });
        quote = null;
      }
      continue;
    }
    if (['"', "'", "“", "‘"].includes(char)) {
      if (!word(text[index - 1]) && text[index + 1] && !/\s/.test(text[index + 1]))
        quote = { from: index, close: ordinary[char] };
    } else if (["(", "[", "{"].includes(char)) stack.push({ from: index, close: ordinary[char] });
    else if ([")", "]", "}"].includes(char)) {
      const opening = stack.at(-1);
      if (opening?.close === char) {
        stack.pop();
        pairs.push({
          from: opening.from,
          innerFrom: opening.from + 1,
          innerTo: index,
          to: index + 1,
        });
      } else stack.length = 0;
    }
  }
  let cursor = from;
  while (true) {
    const pair = pairs.find(
      (pair) => pair.innerFrom < pair.innerTo && cursor >= pair.innerTo && cursor < pair.to
    );
    if (!pair) break;
    cursor = pair.to;
  }
  if (cursor === from || text.slice(cursor, lineEnd).trim()) return null;
  return { kind: "finish", changes: [], cursor: lineEnd };
}

module.exports = {
  getNestedAsteriskEmphasis,
  getNestedAsteriskDelimiters,
  pairPlan,
  enterPairPlan,
};
