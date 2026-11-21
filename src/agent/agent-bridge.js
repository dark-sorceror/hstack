"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { protectedContext } = require("../features/logic.js");
const { SCHEMA } = require("./agent-sql.js");

const LIMITS = Object.freeze({
  snapshotBytes: 32 * 1024 * 1024,
  resultChars: 16000,
  queryRows: 200,
  edits: 128,
  editChars: 2 * 1024 * 1024,
  sqlMs: 1000,
  sqlOutputBytes: 512 * 1024,
  responseBytes: 512 * 1024,
});
function fail(code, message, details) {
  const error = new Error(message);
  Object.assign(error, { code, details });
  throw error;
}
function revision(text) {
  return "sha256:" + crypto.createHash("sha256").update(text).digest("hex");
}
function notePath(value) {
  if (
    typeof value !== "string" ||
    !value.endsWith(".md") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((part) => !part || part === ".." || part.startsWith("."))
  )
    fail(
      "INVALID_PATH",
      "Use an explicit vault-relative Markdown path without hidden or parent directories."
    );
  return value;
}
function bounded(value, fallback, maximum, name) {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    fail("INVALID_PARAMS", `${name} must be between 1 and ${maximum}.`);
  return value;
}
function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length - 1;
}
function positionAt(text, offset) {
  const lines = text.slice(0, offset).split("\n");
  return { line: lines.length - 1, ch: lines.at(-1).length };
}
function headingsFor(outline, text) {
  const headings = outline
    .scanHeadings(text)
    .map((h) => ({
      heading: h.text,
      level: h.level,
      line: h.line,
      start: h.from,
      end: text.length,
    }));
  for (let index = 0; index < headings.length; index++) {
    const following = headings.slice(index + 1).find((h) => h.level <= headings[index].level);
    if (following) headings[index].end = following.start;
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
    lineStart: lineAt(note.content, from),
    lineEnd: lineAt(note.content, to),
    headingPath: note.headings
      .filter((h) => h.start <= from && h.end > from)
      .slice(0, 12)
      .map((h) => h.heading.slice(0, 256)),
  };
}
function applyEdits(text, edits) {
  if (!Array.isArray(edits) || !edits.length || edits.length > LIMITS.edits)
    fail("INVALID_EDITS", "Provide 1–128 edits.");
  let inserted = 0;
  const ordered = edits
    .map((edit) => {
      if (
        !edit ||
        !Number.isSafeInteger(edit.from) ||
        !Number.isSafeInteger(edit.to) ||
        edit.from < 0 ||
        edit.to < edit.from ||
        edit.to > text.length ||
        typeof edit.text !== "string"
      )
        fail("INVALID_EDITS", "Each edit needs valid UTF-16 from/to offsets and text.");
      for (const offset of [edit.from, edit.to])
        if (
          offset &&
          offset < text.length &&
          /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
          /[\uDC00-\uDFFF]/.test(text[offset])
        )
          fail("INVALID_EDITS", "An edit cannot split a Unicode surrogate pair.");
      inserted += edit.text.length;
      return { from: edit.from, to: edit.to, text: edit.text };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to);
  if (inserted > LIMITS.editChars) fail("INVALID_EDITS", "Inserted text exceeds 2 MiB.");
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1],
      current = ordered[index];
    if (current.from < previous.to || current.from === previous.from)
      fail("INVALID_EDITS", "Edits must not overlap or insert twice at one offset.");
  }
  let result = text;
  for (const edit of [...ordered].reverse())
    result = result.slice(0, edit.from) + edit.text + result.slice(edit.to);
  return { text: result, edits: ordered };
}

function runSQL(snapshot, request, { nodePath, directory, timeout = LIMITS.sqlMs } = {}) {
  if (!nodePath)
    fail("SQL_UNAVAILABLE", "A local Node.js 22+ executable is needed for SQL queries.");
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete env.NODE_OPTIONS;
    const workerCode = typeof HSTACK_SQL_WORKER === "string" ? HSTACK_SQL_WORKER : null;
    const args = workerCode ? ["-e", workerCode] : [path.join(directory, "agent-sql-runner.cjs")];
    const child = spawn(nodePath, args, { shell: false, env, stdio: ["pipe", "pipe", "pipe"] });
    let output = [],
      bytes = 0,
      settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolve(result);
    };
    const timer = setTimeout(() => {
      const error = new Error("SQL query exceeded the execution budget.");
      error.code = "SQL_TIMEOUT";
      finish(error);
    }, timeout);
    child.on("error", (error) => {
      error.code = "SQL_UNAVAILABLE";
      finish(error);
    });
    child.stdin.on("error", (error) => {
      if (!settled) {
        error.code = "SQL_PROCESS_ERROR";
        finish(error);
      }
    });
    child.stderr.resume();
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > LIMITS.sqlOutputBytes) {
        const error = new Error("SQL output exceeds 512 KiB; select fewer or shorter columns.");
        error.code = "RESULT_TOO_LARGE";
        finish(error);
      } else output.push(chunk);
    });
    child.on("close", (code) => {
      if (settled) return;
      try {
        if (code !== 0) fail("SQL_PROCESS_ERROR", "SQL subprocess did not complete successfully.");
        const value = JSON.parse(Buffer.concat(output).toString("utf8"));
        if (!value.ok)
          fail(value.error?.code || "SQL_ERROR", value.error?.message || "SQL failed.");
        finish(null, value.result);
      } catch (error) {
        finish(error);
      }
    });
    child.stdin.end(JSON.stringify({ snapshot, request }));
  });
}

function createAgentBridge(plugin, dependencies = {}) {
  const app = plugin.app,
    directory = dependencies.directory || __dirname;
  const parseYaml = dependencies.parseYaml || (() => ({}));
  const discoveredNodePath =
    dependencies.nodePath ||
    [
      ...(process.env.PATH || "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((folder) => path.join(folder, process.platform === "win32" ? "node.exe" : "node")),
      "/opt/homebrew/opt/node@22/bin/node",
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
      "/usr/bin/node",
    ].find((candidate) => fs.existsSync(candidate));
  const configuredNodePath = () => dependencies.getNodePath?.() || discoveredNodePath;
  const base = app.vault.adapter?.getBasePath?.();
  const baseReal = base ? fs.realpathSync(base) : null;
  let disposed = false,
    sqlBusy = false;

  function fileFor(value) {
    const name = notePath(value),
      file = app.vault.getAbstractFileByPath(name);
    if (!file || file.extension !== "md") fail("NOTE_NOT_FOUND", "Markdown note not found.");
    if (baseReal) {
      const target = fs.realpathSync(path.join(baseReal, file.path));
      if (
        !target.startsWith(baseReal + path.sep) ||
        path
          .relative(baseReal, target)
          .split(path.sep)
          .some((part) => part.startsWith("."))
      )
        fail("INVALID_PATH", "Note resolves outside the visible vault notes.");
    }
    return file;
  }
  function editorsFor(name) {
    return app.workspace
      .getLeavesOfType("markdown")
      .filter(
        (leaf) =>
          leaf.view.file?.path === name &&
          (!leaf.view.getMode || leaf.view.getMode() === "source") &&
          leaf.view.editor
      )
      .map((leaf) => leaf.view.editor);
  }
  function primaryEditor(name) {
    const all = editorsFor(name),
      active = app.workspace.activeEditor?.editor || app.workspace.activeLeaf?.view?.editor;
    return all.includes(active) ? active : all[0];
  }
  function activePath() {
    const file = app.workspace.activeEditor?.file || app.workspace.activeLeaf?.view?.file;
    if (!file?.path?.endsWith(".md")) fail("NO_ACTIVE_NOTE", "Open a Markdown note first.");
    return file.path;
  }
  async function readNote(name) {
    const file = fileFor(name),
      saved = await app.vault.read(file),
      editor = primaryEditor(file.path);
    const content = editor ? editor.getValue() : saved;
    const selections = editor
      ? editor
          .listSelections()
          .map((selection) => ({
            anchor: selection.anchor,
            head: selection.head,
            from: Math.min(
              editor.posToOffset(selection.anchor),
              editor.posToOffset(selection.head)
            ),
            to: Math.max(editor.posToOffset(selection.anchor), editor.posToOffset(selection.head)),
          }))
      : [];
    const cursor = editor ? editor.getCursor() : null;
    return {
      path: file.path,
      title: file.basename || path.posix.basename(file.path, ".md"),
      folder: path.posix.dirname(file.path) === "." ? "" : path.posix.dirname(file.path),
      content,
      revision: revision(content),
      source: editor ? "editor" : "vault",
      dirty: content !== saved,
      modified: file.stat?.mtime || 0,
      headings: headingsFor(plugin.outline, content),
      selections,
      cursor,
      cursorOffset: cursor ? editor.posToOffset(cursor) : 0,
    };
  }
  function metadata(note) {
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
      if (protectedContext(content, match.index)) continue;
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
        line: lineAt(content, match.index),
      });
    }
    for (const match of content.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_/-]+)/gu)) {
      const offset = match.index + match[0].indexOf("#");
      if (
        /[\p{L}_/-]/u.test(match[1]) &&
        !linkRanges.some((range) => offset >= range.from && offset < range.to) &&
        !protectedContext(content, offset)
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
  async function snapshot(params = {}) {
    if (
      params.folder != null &&
      (typeof params.folder !== "string" ||
        params.folder.startsWith("/") ||
        params.folder.split("/").some((p) => p === ".." || p.startsWith(".")))
    )
      fail("INVALID_PARAMS", "folder must be a visible vault-relative folder.");
    const files = app.vault
      .getMarkdownFiles()
      .filter(
        (file) =>
          !file.path.split("/").some((part) => part.startsWith(".")) &&
          (!params.folder || file.path.startsWith(params.folder.replace(/\/$/, "") + "/"))
      );
    const data = { notes: [], headings: [], links: [], tags: [], properties: [] };
    let bytes = 0;
    for (const file of files) {
      const note = await readNote(file.path);
      bytes += Buffer.byteLength(note.content) + 256;
      if (bytes > LIMITS.snapshotBytes)
        fail("SNAPSHOT_TOO_LARGE", "Snapshot exceeds 32 MiB; narrow the folder.");
      const extra = metadata(note);
      data.notes.push({
        path: note.path,
        title: note.title,
        folder: note.folder,
        revision: note.revision,
        source: note.source,
        content: note.content,
        modified: note.modified,
      });
      data.headings.push(...note.headings.map((h) => ({ path: note.path, ...h })));
      data.links.push(...extra.links);
      data.tags.push(...extra.tags);
      data.properties.push(...extra.properties);
      if (extra.propertiesError)
        fail("INVALID_FRONTMATTER", `${file.path}: ${extra.propertiesError}`);
    }
    return data;
  }
  async function context(params) {
    const note = await readNote(params.path || activePath()),
      radius = bounded(params.radius, 1000, 8000, "radius");
    const from = Math.max(0, note.cursorOffset - radius),
      to = Math.min(note.content.length, note.cursorOffset + radius);
    const extra = metadata(note),
      backlinks = [];
    for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks || {}))
      if (targets[note.path]) backlinks.push(source);
    return {
      ...reference(note, from, to),
      cursor: note.cursor,
      dirty: note.dirty,
      text: note.content.slice(from, to),
      truncated: from > 0 || to < note.content.length,
      selections: note.selections
        .slice(0, 16)
        .map((selection) => ({
          ...selection,
          text: note.content.slice(selection.from, Math.min(selection.to, selection.from + 4000)),
          truncated: selection.to - selection.from > 4000,
        })),
      headings: note.headings
        .slice(0, 200)
        .map((h) => ({
          ...h,
          heading: h.heading.slice(0, 256),
          headingTruncated: h.heading.length > 256,
        })),
      headingsTruncated: note.headings.length > 200,
      links: extra.links.slice(0, 100),
      tags: extra.tags.slice(0, 100).map((t) => t.tag),
      tagsTruncated: extra.tags.length > 100,
      properties: extra.properties
        .slice(0, 50)
        .map((p) => ({
          ...p,
          value_json: p.value_json.slice(0, 2000),
          truncated: p.value_json.length > 2000,
        })),
      propertiesTruncated: extra.properties.length > 50,
      propertiesError: extra.propertiesError,
      backlinks: backlinks.slice(0, 100),
      backlinksSource: "saved-metadata-cache",
    };
  }
  async function readSection(params) {
    const note = await readNote(params.path),
      maximum = bounded(params.maxChars, 8000, LIMITS.resultChars, "maxChars");
    let from = 0,
      to = note.content.length;
    if (params.heading != null) {
      const matches = note.headings.filter((h) => h.heading === params.heading);
      if (!matches.length) fail("TARGET_NOT_FOUND", "Heading not found.");
      if (matches.length > 1 && params.occurrence == null)
        fail("AMBIGUOUS_TARGET", "Choose a heading occurrence.", { matches });
      const occurrence = params.occurrence == null ? 0 : params.occurrence;
      if (!Number.isSafeInteger(occurrence) || !matches[occurrence])
        fail("TARGET_NOT_FOUND", "Heading occurrence not found.");
      ({ start: from, end: to } = matches[occurrence]);
    } else if (params.from != null || params.to != null) {
      from = params.from ?? 0;
      to = params.to ?? note.content.length;
      if (
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < 0 ||
        to < from ||
        to > note.content.length
      )
        fail("INVALID_RANGE", "Invalid UTF-16 range.");
    }
    const end = Math.min(to, from + maximum);
    return {
      ...reference(note, from, end),
      text: note.content.slice(from, end),
      sectionTo: to,
      truncated: end < to,
    };
  }
  async function query(params) {
    const limit = bounded(params.limit, 30, LIMITS.queryRows, "limit"),
      data = await snapshot(params);
    if (params.text != null && (typeof params.text !== "string" || params.text.length > 2000))
      fail("INVALID_PARAMS", "text must be at most 2000 characters.");
    for (const key of ["tag", "linksTo"])
      if (params[key] != null && (typeof params[key] !== "string" || params[key].length > 2000))
        fail("INVALID_PARAMS", `${key} must be text of at most 2000 characters.`);
    if (
      params.properties != null &&
      (typeof params.properties !== "object" || Array.isArray(params.properties))
    )
      fail("INVALID_PARAMS", "properties must be an object.");
    const term = (params.text || "").toLowerCase();
    const results = [];
    for (const row of data.notes) {
      if (
        term &&
        !row.content.toLowerCase().includes(term) &&
        !row.title.toLowerCase().includes(term)
      )
        continue;
      if (
        params.tag &&
        !data.tags.some(
          (t) =>
            t.path === row.path &&
            t.tag === (params.tag.startsWith("#") ? params.tag : "#" + params.tag)
        )
      )
        continue;
      if (
        params.linksTo &&
        !data.links.some((l) => l.source === row.path && l.target === params.linksTo && l.resolved)
      )
        continue;
      if (
        params.properties &&
        !Object.entries(params.properties).every(([key, value]) =>
          data.properties.some(
            (p) => p.path === row.path && p.key === key && p.value_json === JSON.stringify(value)
          )
        )
      )
        continue;
      const at = Math.max(0, row.content.toLowerCase().indexOf(term)),
        from = Math.max(0, at - 100),
        to = Math.min(row.content.length, from + 600);
      const note = { ...row, headings: data.headings.filter((h) => h.path === row.path) };
      results.push({
        ...reference(note, from, to),
        title: row.title,
        empty: !row.content.trim(),
        text: row.content.slice(from, to),
      });
      if (results.length > limit) break;
    }
    return {
      matches: results.slice(0, limit),
      truncated: results.length > limit,
      limit,
      snapshotNotes: data.notes.length,
    };
  }
  async function patch(params) {
    const file = fileFor(params.path);
    if (["AGENTS.md", "CLAUDE.md"].includes(file.name || path.posix.basename(file.path)))
      fail("INVALID_PATH", "Agent instruction files are outside the note-editing API.");
    if (!/^sha256:[a-f0-9]{64}$/.test(params.expectedRevision || ""))
      fail("REVISION_REQUIRED", "patch requires the revision returned by a read.");
    if (params.dryRun != null && typeof params.dryRun !== "boolean")
      fail("INVALID_PARAMS", "dryRun must be a boolean.");
    const dryRun = params.dryRun !== false;
    let outcome;
    const prepare = (current) => {
      if (disposed) fail("BRIDGE_UNLOADED", "The notes bridge has been unloaded.");
      const actual = revision(current);
      if (actual !== params.expectedRevision)
        fail("REVISION_CONFLICT", "The note changed. Read its current revision before patching.", {
          path: file.path,
          currentRevision: actual,
        });
      const edit = applyEdits(current, params.edits);
      const first = edit.edits[0],
        last = edit.edits.at(-1);
      outcome = {
        path: file.path,
        previousRevision: actual,
        revision: revision(edit.text),
        dryRun,
        changed: edit.text !== current,
        edits: edit.edits.map((e) => ({ from: e.from, to: e.to, insertedChars: e.text.length })),
        preview: {
          before: current.slice(first.from, Math.min(last.to, first.from + 3000)),
          after: edit.text.slice(first.from, Math.min(edit.text.length, first.from + 3000)),
        },
      };
      return edit;
    };
    const editors = editorsFor(file.path);
    if (editors.length) {
      const editor = primaryEditor(file.path),
        current = editor.getValue();
      if (editors.some((e) => e.getValue() !== current))
        fail(
          "DIVERGENT_EDITORS",
          "Open editors have different buffers; choose a consistent revision first."
        );
      const edit = prepare(current); // No await between reading, checking, and editing.
      if (!dryRun && outcome.changed) {
        editor.transaction(
          {
            changes: edit.edits.map((e) => ({
              from: editor.offsetToPos(e.from),
              to: editor.offsetToPos(e.to),
              text: e.text,
            })),
          },
          "input.notes-agent"
        );
        const actual = editor.getValue();
        outcome.transformedByEditor = actual !== edit.text;
        outcome.revision = revision(actual);
      }
      outcome.source = "editor";
    } else if (dryRun) {
      prepare(await app.vault.read(file));
      outcome.source = "vault";
    } else {
      await app.vault.process(file, (current) => {
        if (editorsFor(file.path).length)
          fail("SOURCE_CHANGED", "The note opened in an editor. Read it again before patching.");
        return prepare(current).text;
      });
      outcome.source = "vault";
    }
    return outcome;
  }
  async function reveal(params) {
    const section = await readSection({ ...params, maxChars: 1 }),
      file = fileFor(section.path);
    const previous = app.workspace.activeLeaf;
    const leaf =
      app.workspace.getLeavesOfType("markdown").find((l) => l.view.file?.path === file.path) ||
      app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: params.focus === true, state: { mode: "source" } });
    if (params.focus === true) app.workspace.setActiveLeaf(leaf, { focus: true });
    else if (previous && app.workspace.activeLeaf !== previous)
      app.workspace.setActiveLeaf(previous, { focus: false });
    const editor = leaf.view.editor;
    if (editor)
      editor.scrollIntoView(
        { from: editor.offsetToPos(section.from), to: editor.offsetToPos(section.from) },
        true
      );
    return { path: file.path, from: section.from, focused: params.focus === true };
  }
  const methods = {
    capabilities: () => ({
      apiVersion: 1,
      enabled: plugin.options?.agentBridge !== false,
      methods: ["capabilities", "context", "query", "readSection", "sql", "patch", "reveal"],
      offsets: "UTF-16; lines are zero-based",
      sql: { available: !!configuredNodePath(), readOnly: true, schema: SCHEMA },
      limits: LIMITS,
      patch: { expectedRevisionRequired: true, dryRunDefault: true, markdownOnly: true },
    }),
    context,
    query,
    readSection,
    patch,
    reveal,
    sql: async (params) => {
      if (sqlBusy) fail("SQL_BUSY", "A SQL query is already running; retry after it finishes.");
      sqlBusy = true;
      try {
        return {
          ...(await runSQL(await snapshot(params), params, {
            nodePath: configuredNodePath(),
            directory,
            timeout: dependencies.sqlTimeout || LIMITS.sqlMs,
          })),
          capturedAt: new Date().toISOString(),
        };
      } finally {
        sqlBusy = false;
      }
    },
  };
  return {
    async request(request) {
      const requestedId = request?.id;
      const id =
        (typeof requestedId === "string" && requestedId.length <= 100) ||
        Number.isSafeInteger(requestedId)
          ? requestedId
          : null;
      try {
        if (disposed) fail("BRIDGE_UNLOADED", "The notes bridge has been unloaded.");
        if (
          !request ||
          typeof request !== "object" ||
          Array.isArray(request) ||
          (request.apiVersion != null && request.apiVersion !== 1)
        )
          fail("INVALID_REQUEST", "Use an API version 1 request object.");
        if (requestedId != null && id === null)
          fail("INVALID_REQUEST", "id must be a short string or safe integer.");
        if (!Object.hasOwn(methods, request.method))
          fail("UNKNOWN_METHOD", "Unknown notes bridge method.");
        const params = request.params ?? {};
        if (!params || typeof params !== "object" || Array.isArray(params))
          fail("INVALID_PARAMS", "params must be an object.");
        if (plugin.options?.agentBridge === false && request.method !== "capabilities")
          fail("BRIDGE_DISABLED", "Enable Agent bridge in hstack settings first.");
        const result = await methods[request.method](params);
        if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.responseBytes)
          fail(
            "RESULT_TOO_LARGE",
            "Result exceeds 512 KiB; request a smaller range or fewer rows."
          );
        return { apiVersion: 1, id, ok: true, result };
      } catch (error) {
        const details =
          error.details && Buffer.byteLength(JSON.stringify(error.details)) <= 4096
            ? error.details
            : undefined;
        return {
          apiVersion: 1,
          id,
          ok: false,
          error: {
            code: error.code || "INTERNAL_ERROR",
            message: String(error.message).slice(0, 2000),
            ...(details ? { details } : {}),
          },
        };
      }
    },
    dispose() {
      disposed = true;
    },
  };
}

module.exports = { createAgentBridge, applyEdits, revision, notePath, runSQL, LIMITS };
