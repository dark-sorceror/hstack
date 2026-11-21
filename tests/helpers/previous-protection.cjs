"use strict";
// Characterization oracle for pre-refactor LF protection behavior.
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
      else if (
        opening[1][0] === fence.char &&
        opening[1].length >= fence.length &&
        !opening[2].trim()
      ) {
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

module.exports = protectedContext;
