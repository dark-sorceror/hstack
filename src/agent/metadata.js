"use strict";
const { lexicalFor } = require("../markdown/source.js");

function headingsFor(outline, text) {
  const headings = outline.scanHeadings(text).map((h) => ({
    heading: h.text,
    level: h.level,
    line: h.line,
    start: h.from,
    end: text.length,
  }));
  const stack = [];
  for (const heading of headings) {
    while (stack.length && stack.at(-1).level >= heading.level) stack.pop().end = heading.start;
    stack.push(heading);
  }
  return headings;
}
function reference(note, from, to) {
  return {
    path: note.path,
    revision: note.revision,
    source: note.source,
    from,
    to,
    lineStart: lexicalFor(note.content).lineIndex(from),
    lineEnd: lexicalFor(note.content).lineIndex(to),
    headingPath: note.headings
      .filter((h) => h.start <= from && h.end > from)
      .slice(0, 12)
      .map((h) => h.heading.slice(0, 256)),
  };
}

function createMetadataReader(app, parseYaml, fileFor) {
  function metadata(note) {
    const analysis = note.lexical || lexicalFor(note.content);
    const content = note.content,
      links = [],
      linkRanges = [],
      tags = new Set(),
      properties = [];
    const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
    let propertiesError = null;
    if (frontmatter) {
      try {
        const data = parseYaml(frontmatter[1]);
        if (data && typeof data === "object" && !Array.isArray(data)) {
          for (const [key, value] of Object.entries(data))
            properties.push({ path: note.path, key, value_json: JSON.stringify(value) ?? "null" });
          for (const tag of Array.isArray(data.tags)
            ? data.tags
            : typeof data.tags === "string"
              ? data.tags.split(/[ ,]+/)
              : [])
            if (typeof tag === "string" && tag) tags.add("#" + tag.replace(/^#/, ""));
        }
      } catch {
        propertiesError = "Frontmatter could not be parsed.";
      }
    }
    for (const match of content.matchAll(/!?\[\[([^\]\n]+)\]\]|!?\[([^\]\n]*)\]\(([^)\n]+)\)/g)) {
      if (analysis.protectedAt(match.index)) continue;
      linkRanges.push({ from: match.index, to: match.index + match[0].length });
      const raw = match[1] ? match[1].split("|")[0] : match[3].replace(/^<|>$/g, "");
      const hash = raw.indexOf("#"),
        destination = hash < 0 ? raw : raw.slice(0, hash),
        heading = hash < 0 ? null : raw.slice(hash + 1);
      if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) continue;
      let file = null;
      try {
        file = destination
          ? app.metadataCache.getFirstLinkpathDest(decodeURIComponent(destination), note.path)
          : fileFor(note.path);
      } catch {
        /* unresolved link */
      }
      links.push({
        source: note.path,
        target: file?.path || destination,
        resolved: file ? 1 : 0,
        heading,
        line: analysis.lineIndex(match.index),
      });
    }
    for (const match of content.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_/-]+)/gu)) {
      const offset = match.index + match[0].indexOf("#");
      if (
        /[\p{L}_/-]/u.test(match[1]) &&
        !linkRanges.some((range) => offset >= range.from && offset < range.to) &&
        !analysis.protectedAt(offset)
      )
        tags.add("#" + match[1]);
    }
    return {
      links,
      tags: [...tags].map((tag) => ({ path: note.path, tag })),
      properties,
      propertiesError,
    };
  }
  return metadata;
}
module.exports = { headingsFor, reference, createMetadataReader };
