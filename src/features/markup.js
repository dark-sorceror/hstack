"use strict";

function escaped(text, position) {
  let slashes = 0;
  while (position > 0 && text[--position] === "\\") slashes++;
  return slashes % 2 === 1;
}

function columns(indent) {
  let size = 0;
  for (const char of indent) size += char === "\t" ? 4 - (size % 4) : 1;
  return size;
}

function sourceListItem(line) {
  const quote = /^(?:[ \t]*>[ \t]?)+/.exec(line)?.[0] || "";
  const match = /^([ \t]*)(?:(\d+)([.)])|([-+*]))([ \t]+)(.*)$/.exec(line.slice(quote.length));
  if (!match) return null;
  return {
    marker: match[4] || match[2] + match[3],
    ordered: !!match[2],
    depth: columns(match[1]),
    contentColumn: columns(match[1] + (match[4] || match[2] + match[3]) + match[5]),
    quoteDepth: (quote.match(/>/g) || []).length,
    task: /^\[[ xX-]\](?:\s|$)/.test(match[6]),
    body: match[6],
  };
}

function scanSource(text) {
  const mask = new Uint8Array(text.length);
  const lists = [];
  const lines = text.split("\n");
  let offset = 0,
    fence = null,
    math = false,
    yaml = lines[0]?.trim() === "---";
  let parents = [],
    quoteDepth = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index],
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
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length)
        fence = null;
    } else if (math) {
      blocked = true;
      if (/^\s*\$\$\s*$/.test(unquoted)) math = false;
    } else {
      if (list && list.quoteDepth !== quoteDepth) parents = [];
      if (list) quoteDepth = list.quoteDepth;
      const leading = /^[ \t]*/.exec(unquoted)[0];
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
        fence = { char: opening[1][0], length: opening[1].length };
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

  let code = null;
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

  const htmlStrong = [],
    stack = [];
  for (const match of text.matchAll(/<\/?strong\b[^>]*>/gi)) {
    if (mask[match.index]) continue;
    if (!match[0].startsWith("</"))
      stack.push({ from: match.index, innerFrom: match.index + match[0].length });
    else if (stack.length) {
      const opening = stack.pop();
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

function getEmphasis(text, scanned = scanSource(text)) {
  const result = [...scanned.htmlStrong];
  const word = (char) => !!char && /[\p{L}\p{N}_]/u.test(char);
  function parse(from, to) {
    for (let position = from; position < to - 1; position++) {
      const marker = text.slice(position, position + 2);
      if ((marker !== "__" && marker !== "**") || scanned.mask[position] || escaped(text, position))
        continue;
      if (
        !text[position + 2] ||
        /\s/.test(text[position + 2]) ||
        (marker === "__" && word(text[position - 1]))
      )
        continue;
      let close = text.indexOf(marker, position + 2);
      while (close >= 0 && close < to) {
        if (
          !scanned.mask[close] &&
          !escaped(text, close) &&
          !/\s/.test(text[close - 1]) &&
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
        markup: marker,
      });
      parse(position + 2, close);
      position = close + 1;
    }
  }
  parse(0, text.length);
  result.sort((a, b) => a.from - b.from || b.to - a.to);
  for (const token of result) {
    token.boldAncestor = result.some(
      (parent) =>
        parent !== token &&
        parent.markup !== "__" &&
        parent.innerFrom <= token.from &&
        parent.innerTo >= token.to
    );
    token.underlineAncestor = result.some(
      (parent) =>
        parent !== token &&
        parent.markup === "__" &&
        parent.innerFrom <= token.from &&
        parent.innerTo >= token.to
    );
  }
  return result;
}

function analyzeSource(text) {
  const scanned = scanSource(text);
  const emphasis = getEmphasis(text, scanned);
  return {
    lists: scanned.lists,
    emphasis,
    nestedAsterisks: getNestedAsteriskEmphasis(text, emphasis, scanned.mask),
  };
}

function getUnderlineDelimiters(text, carets = [], emphasis = getEmphasis(text)) {
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

function analysisFor(plugin, text) {
  const cached = plugin._notesMarkupAnalysis;
  if (cached?.text === text) return cached.analysis;
  const analysis = analyzeSource(text);
  plugin._notesMarkupAnalysis = { text, analysis };
  return analysis;
}

function createMarkupExtension(plugin, { Decoration, ViewPlugin }) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = this.build(view);
      }
      update(update) {
        if (update.docChanged || update.viewportChanged || update.selectionSet)
          this.decorations = this.build(update.view);
      }
      build(view) {
        const text = view.state.doc.toString();
        const analysis = analysisFor(plugin, text);
        const visible = (from, to) =>
          view.visibleRanges.some((range) => from <= range.to && to >= range.from);
        const decorations = [];
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

function descendantsIncludingRoot(el, selector) {
  return (el.matches?.(selector) ? [el] : []).concat(Array.from(el.querySelectorAll(selector)));
}

function postprocessMarkup(el, context, plugin) {
  const section = context.getSectionInfo(el);
  if (!section || typeof section.text !== "string") return;
  const text = section.text;
  const lines = text.split("\n");
  const startLine = Math.max(0, section.lineStart || 0);
  const endLine = Math.min(lines.length - 1, section.lineEnd ?? lines.length - 1);
  let start = 0;
  for (let n = 0; n < startLine; n++) start += lines[n].length + 1;
  let end = start;
  for (let n = startLine; n <= endLine; n++) end += lines[n].length + 1;
  const analysis = analysisFor(plugin, text);
  if (plugin.options.listStyles !== false) {
    const source = analysis.lists.filter((list) => list.line >= startLine && list.line <= endLine);
    const rendered = descendantsIncludingRoot(el, "li").filter(
      (node) => !node.closest("pre, code")
    );
    // If embedded HTML introduces extra list nodes, leave it to the renderer.
    if (source.length === rendered.length) {
      for (let index = 0; index < source.length; index++) {
        if (source[index].marker === "-" && !source[index].task)
          rendered[index].setAttribute("data-notes-list-style", "dash");
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
      if (source[index].markup !== "__") continue;
      const strong = rendered[index];
      const underline = strong.ownerDocument.createElement("u");
      for (const attribute of Array.from(strong.attributes))
        underline.setAttribute(attribute.name, attribute.value);
      underline.classList.add("notes-underline");
      if (source[index].boldAncestor) underline.classList.add("notes-underline-bold");
      while (strong.firstChild) underline.appendChild(strong.firstChild);
      strong.replaceWith(underline);
    }
  }
}

module.exports = {
  sourceListItem,
  analyzeSource,
  getEmphasis,
  getUnderlineDelimiters,
  getNestedAsteriskEmphasis,
  getNestedAsteriskDelimiters,
  pairPlan,
  enterPairPlan,
  createMarkupExtension,
  postprocessMarkup,
};
