"use strict";
const emphasis = require("./emphasis.js");
const pairs = require("../features/pairs.js");

function analyzeSource(text) {
  const scanned = emphasis.scanSource(text);
  const marks = emphasis.getEmphasis(text, scanned);
  return {
    lists: scanned.lists,
    emphasis: marks,
    nestedAsterisks: pairs.getNestedAsteriskEmphasis(text, marks, scanned.mask),
  };
}

module.exports = { analyzeSource };
