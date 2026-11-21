"use strict";
const emphasis = require("../markdown/emphasis.js");
const pairs = require("./pairs.js");
const rendering = require("../editor/markup-rendering.js");

const { analyzeSource } = require("../markdown/analysis.js");

module.exports = {
  sourceListItem: emphasis.sourceListItem,
  analyzeSource,
  getEmphasis: emphasis.getEmphasis,
  getUnderlineDelimiters: emphasis.getUnderlineDelimiters,
  ...pairs,
  ...rendering,
};
