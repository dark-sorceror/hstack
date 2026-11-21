import type { App, TFile } from "obsidian";
import type { Heading, NoteLink, NoteProperty, SourcePointer } from "../api.js";
import type { AgentHost, Note, SourceNote } from "./types.js";
import { lexicalFor } from "../markdown/source.js";
import { scanSource } from "../markdown/emphasis.js";

function headingsFor(outline: AgentHost["outline"], text: string): Heading[] {
  const headings = outline.scanHeadings(text).map((h) => ({
    heading: h.text,
    level: h.level,
    line: h.line,
    start: h.from,
    end: text.length,
  }));
  const stack: Heading[] = [];
  for (const heading of headings) {
    while (stack.length && stack.at(-1)!.level >= heading.level) stack.pop()!.end = heading.start;
    stack.push(heading);
  }
  return headings;
}
function reference(note: SourceNote, from: number, to: number): SourcePointer {
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

function createMetadataReader(
  app: App,
  parseYaml: (source: string) => unknown,
  fileFor: (path: unknown) => TFile
) {
  function metadata(note: Note) {
    const analysis = note.lexical || lexicalFor(note.content);
    const content = note.content,
      links: NoteLink[] = [],
      linkRanges: { from: number; to: number }[] = [],
      tags = new Set<string>(),
      properties: NoteProperty[] = [];
    // Reuse rendering's list-aware code/HTML block classification. Inline
    // protection remains lexical so actual wiki links are still discoverable.
    const { blockMask } = scanSource(content);
    const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
    let propertiesError: string | null = null;
    if (frontmatter) {
      try {
        const parsed = parseYaml(frontmatter[1]!);
        const data = parsed as Record<string, unknown> | null;
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
      if (blockMask[match.index] || analysis.protectedAt(match.index)) continue;
      linkRanges.push({ from: match.index, to: match.index + match[0].length });
      const raw = match[1] ? match[1].split("|")[0]! : match[3]!.replace(/^<|>$/g, "");
      const hash = raw.indexOf("#"),
        destination = hash < 0 ? raw : raw.slice(0, hash),
        heading = hash < 0 ? null : raw.slice(hash + 1);
      if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) continue;
      let file: TFile | null = null;
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
        /[\p{L}_/-]/u.test(match[1]!) &&
        !blockMask[offset] &&
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
export { headingsFor, reference, createMetadataReader };
