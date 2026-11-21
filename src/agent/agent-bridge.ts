import type {
  BridgeMethod,
  BridgeRequest,
  BridgeResponse,
  BridgeResults,
  RequestID,
} from "../api.js";
import type {
  AgentDependencies,
  AgentHost,
  BridgeFault,
  InputParameters,
  MarkdownViewPort,
  Snapshot,
} from "./types.js";
import { SCHEMA } from "./agent-sql.js";
import { LIMITS, fail, bounded, applyEdits, revision, notePath } from "./contracts.js";
import { createNoteStore } from "./note-store.js";
import { createMetadataReader, reference } from "./metadata.js";
import { runSQL, createSQLRuntime } from "./sql-process.js";

function createAgentBridge(plugin: AgentHost, dependencies: AgentDependencies = {}) {
  const app = plugin.app;
  const parseYaml = dependencies.parseYaml || (() => ({}));
  let disposed = false,
    sqlBusy = false;
  const { fileFor, readNote, activePath, patch } = createNoteStore(plugin, () => disposed);
  const metadata = createMetadataReader(app, parseYaml, fileFor);
  const runtime = createSQLRuntime(dependencies);
  async function snapshot(params: InputParameters = {}): Promise<Snapshot> {
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
          (!params.folder ||
            file.path.startsWith((params.folder as string).replace(/\/$/, "") + "/"))
      );
    const data: Snapshot = { notes: [], headings: [], links: [], tags: [], properties: [] };
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
  async function context(params: InputParameters): Promise<BridgeResults["context"]> {
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
      selections: note.selections.slice(0, 16).map((selection) => ({
        ...selection,
        text: note.content.slice(selection.from, Math.min(selection.to, selection.from + 4000)),
        truncated: selection.to - selection.from > 4000,
      })),
      headings: note.headings.slice(0, 200).map((h) => ({
        ...h,
        heading: h.heading.slice(0, 256),
        headingTruncated: h.heading.length > 256,
      })),
      headingsTruncated: note.headings.length > 200,
      links: extra.links.slice(0, 100),
      tags: extra.tags.slice(0, 100).map((t) => t.tag),
      tagsTruncated: extra.tags.length > 100,
      properties: extra.properties.slice(0, 50).map((p) => ({
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
  async function readSection(params: InputParameters): Promise<BridgeResults["readSection"]> {
    const note = await readNote(params.path),
      maximum = bounded(params.maxChars, 8000, LIMITS.resultChars, "maxChars");
    let from = 0,
      to = note.content.length;
    if (params.heading != null) {
      const matches = note.headings.filter((h) => h.heading === params.heading);
      if (!matches.length) fail("TARGET_NOT_FOUND", "Heading not found.");
      if (matches.length > 1 && params.occurrence == null)
        fail("AMBIGUOUS_TARGET", "Choose a heading occurrence.", { matches });
      const occurrence = (params.occurrence == null ? 0 : params.occurrence) as number;
      if (!Number.isSafeInteger(occurrence) || !matches[occurrence])
        fail("TARGET_NOT_FOUND", "Heading occurrence not found.");
      ({ start: from, end: to } = matches[occurrence]!);
    } else if (params.from != null || params.to != null) {
      from = (params.from ?? 0) as number;
      to = (params.to ?? note.content.length) as number;
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
  async function query(params: InputParameters): Promise<BridgeResults["query"]> {
    const limit = bounded(params.limit, 30, LIMITS.queryRows, "limit"),
      data = await snapshot(params);
    if (params.text != null && (typeof params.text !== "string" || params.text.length > 2000))
      fail("INVALID_PARAMS", "text must be at most 2000 characters.");
    for (const key of ["tag", "linksTo"] as const)
      if (params[key] != null && (typeof params[key] !== "string" || params[key].length > 2000))
        fail("INVALID_PARAMS", `${key} must be text of at most 2000 characters.`);
    if (
      params.properties != null &&
      (typeof params.properties !== "object" || Array.isArray(params.properties))
    )
      fail("INVALID_PARAMS", "properties must be an object.");
    const term = ((params.text || "") as string).toLowerCase();
    const tag = params.tag as string | undefined;
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
          (t) => t.path === row.path && t.tag === (tag!.startsWith("#") ? tag : "#" + tag)
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
  async function reveal(params: InputParameters): Promise<BridgeResults["reveal"]> {
    const section = await readSection({ ...params, maxChars: 1 }),
      file = fileFor(section.path);
    const previous = app.workspace.activeLeaf;
    const leaf =
      app.workspace
        .getLeavesOfType("markdown")
        .find((l) => (l.view as MarkdownViewPort).file?.path === file.path) ||
      app.workspace.getLeaf("tab");
    await leaf.openFile(file, { active: params.focus === true, state: { mode: "source" } });
    if (params.focus === true) app.workspace.setActiveLeaf(leaf, { focus: true });
    else if (previous && app.workspace.activeLeaf !== previous)
      app.workspace.setActiveLeaf(previous, { focus: false });
    const editor = (leaf.view as MarkdownViewPort).editor;
    if (editor)
      editor.scrollIntoView(
        { from: editor.offsetToPos(section.from), to: editor.offsetToPos(section.from) },
        true
      );
    return { path: file.path, from: section.from, focused: params.focus === true };
  }
  const methods: { [M in BridgeMethod]: (params: InputParameters) => Promise<BridgeResults[M]> } = {
    capabilities: async () => ({
      apiVersion: 1,
      enabled: plugin.options?.agentBridge !== false,
      methods: ["capabilities", "context", "query", "readSection", "sql", "patch", "reveal"],
      offsets: "UTF-16; lines are zero-based",
      sql: { ...(await runtime.capabilities()), readOnly: true, schema: SCHEMA },
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
        const nodePath = await runtime.requireNode();
        return {
          ...(await runSQL(await snapshot(params), params, {
            nodePath,
            directory: dependencies.directory || __dirname,
            timeout: dependencies.sqlTimeout || LIMITS.sqlMs,
          })),
          capturedAt: new Date().toISOString(),
        };
      } finally {
        sqlBusy = false;
      }
    },
  };
  async function request<R extends BridgeRequest>(
    request: R
  ): Promise<BridgeResponse<BridgeResults[R["method"]]>>;
  async function request(request: unknown): Promise<BridgeResponse<BridgeResults[BridgeMethod]>>;
  async function request(value: unknown): Promise<BridgeResponse<BridgeResults[BridgeMethod]>> {
    // The transport accepts arbitrary JSON; structural validation follows below.
    const request = value as
      { id?: unknown; apiVersion?: unknown; method?: unknown; params?: unknown } | null | undefined;
    const requestedId = request?.id;
    const id: RequestID | null =
      (typeof requestedId === "string" && requestedId.length <= 100) ||
      (typeof requestedId === "number" && Number.isSafeInteger(requestedId))
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
      if (!Object.hasOwn(methods, request.method as PropertyKey))
        fail("UNKNOWN_METHOD", "Unknown notes bridge method.");
      const params = request.params ?? {};
      if (!params || typeof params !== "object" || Array.isArray(params))
        fail("INVALID_PARAMS", "params must be an object.");
      if (plugin.options?.agentBridge === false && request.method !== "capabilities")
        fail("BRIDGE_DISABLED", "Enable Agent bridge in hstack settings first.");
      // hasOwn establishes the finite dispatcher key; methods validate their fields.
      const method = request.method as BridgeMethod;
      const result = await methods[method](params as InputParameters);
      if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.responseBytes)
        fail("RESULT_TOO_LARGE", "Result exceeds 512 KiB; request a smaller range or fewer rows.");
      return { apiVersion: 1, id, ok: true, result };
    } catch (caught) {
      const error = caught as BridgeFault;
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
  }
  return {
    request,
    dispose() {
      disposed = true;
    },
  };
}

export type AgentBridge = ReturnType<typeof createAgentBridge>;
export { createAgentBridge, applyEdits, revision, notePath, runSQL, LIMITS };
