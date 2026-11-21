import type { App, Editor } from "obsidian";

export type BridgeMethod = keyof BridgeParameters;
export type RequestID = string | number;
export type SQLValue = string | number | boolean | null;
export interface Edit {
  from: number;
  to: number;
  text: string;
}
export interface SectionTarget {
  path: string;
  heading?: string;
  occurrence?: number;
  from?: number;
  to?: number;
}
export interface BridgeParameters {
  capabilities: Record<string, never>;
  context: { path?: string; radius?: number };
  query: {
    text?: string;
    folder?: string;
    tag?: string;
    properties?: Record<string, unknown>;
    linksTo?: string;
    limit?: number;
  };
  readSection: SectionTarget & { maxChars?: number };
  sql: {
    sql: string;
    params?: SQLValue[] | Record<string, SQLValue>;
    folder?: string;
    limit?: number;
  };
  patch: { path: string; expectedRevision: string; edits: Edit[]; dryRun?: boolean };
  reveal: SectionTarget & { focus?: boolean };
}
type RequiredParameters = "readSection" | "sql" | "patch" | "reveal";
export type BridgeRequest<M extends BridgeMethod = BridgeMethod> = M extends BridgeMethod
  ? { apiVersion?: 1; id?: RequestID; method: M } & (M extends RequiredParameters
      ? { params: BridgeParameters[M] }
      : { params?: BridgeParameters[M] })
  : never;
export interface SourcePointer {
  path: string;
  revision: string;
  source: "editor" | "vault";
  from: number;
  to: number;
  lineStart: number;
  lineEnd: number;
  headingPath: string[];
}
export interface Heading {
  heading: string;
  level: number;
  line: number;
  start: number;
  end: number;
  headingTruncated?: boolean;
}
export interface NoteLink {
  source: string;
  target: string;
  resolved: 0 | 1;
  heading: string | null;
  line: number;
}
export interface NoteProperty {
  path: string;
  key: string;
  value_json: string;
  truncated?: boolean;
}
export interface ContextResult extends SourcePointer {
  cursor: { line: number; ch: number } | null;
  dirty: boolean;
  text: string;
  truncated: boolean;
  selections: {
    anchor: { line: number; ch: number };
    head: { line: number; ch: number };
    from: number;
    to: number;
    text: string;
    truncated: boolean;
  }[];
  headings: Heading[];
  headingsTruncated: boolean;
  links: NoteLink[];
  tags: string[];
  tagsTruncated: boolean;
  properties: NoteProperty[];
  propertiesTruncated: boolean;
  propertiesError: string | null;
  backlinks: string[];
  backlinksSource: "saved-metadata-cache";
}
export interface BridgeResults {
  capabilities: {
    apiVersion: 1;
    enabled: boolean;
    methods: BridgeMethod[];
    offsets: string;
    sql: {
      available: boolean;
      readOnly: true;
      schema: Record<string, Record<string, string>>;
      version?: string;
      nodePath?: string;
      reason?: string;
    };
    limits: Record<string, number>;
    patch: { expectedRevisionRequired: true; dryRunDefault: true; markdownOnly: true };
  };
  context: ContextResult;
  query: {
    matches: (SourcePointer & { title: string; empty: boolean; text: string })[];
    truncated: boolean;
    limit: number;
    snapshotNotes: number;
  };
  readSection: SourcePointer & { text: string; sectionTo: number; truncated: boolean };
  sql: {
    columns: string[];
    rows: (string | number | null)[][];
    rowCount: number;
    truncated: boolean;
    cellTruncations: { row: number; column: number; originalChars: number }[];
    limit: number;
    snapshot: Record<string, number>;
    durationMs: number;
    readOnly: true;
    capturedAt: string;
  };
  patch: {
    path: string;
    previousRevision: string;
    revision: string;
    dryRun: boolean;
    changed: boolean;
    source: "editor" | "vault";
    edits: { from: number; to: number; insertedChars: number }[];
    preview: { before: string; after: string };
    transformedByEditor?: boolean;
  };
  reveal: { path: string; from: number; focused: boolean };
}
export type BridgeResponse<T = unknown> =
  | { apiVersion: 1; id: RequestID | null; ok: true; result: T }
  | {
      apiVersion: 1;
      id: RequestID | null;
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };
export interface SlashCommandContext {
  editor: Editor;
  from: number;
  to: number;
  title: string;
  app: App;
}
export interface SlashCommand {
  id: string;
  name: string;
  aliases?: string[];
  icon?: string;
  description: string;
  run(context: SlashCommandContext): void | Promise<void>;
}
export interface HstackAPI {
  readonly version: 1;
  request<R extends BridgeRequest>(request: R): Promise<BridgeResponse<BridgeResults[R["method"]]>>;
  formatMarkdown(markdown: string): string;
  /** Dispose on unload; callbacks are trusted code, never executable note text. */
  registerSlashCommand(command: SlashCommand): () => void;
}
