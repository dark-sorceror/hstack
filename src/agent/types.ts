import type { App, Editor, EditorPosition, TFile } from "obsidian";
import type { Heading, NoteLink, NoteProperty } from "../api.js";
import type { lexicalFor } from "../markdown/source.js";
import type * as outline from "../features/outline.js";

/** Untrusted transport fields stay unknown until the method validates them. */
export type InputParameters = Record<string, unknown>;
export interface AgentHost {
  app: App;
  options?: { agentBridge?: boolean };
  outline: Pick<typeof outline, "scanHeadings">;
}
export interface NoteRow {
  path: string;
  title: string;
  folder: string;
  revision: string;
  source: "editor" | "vault";
  content: string;
  modified: number;
}
export interface SourceNote extends NoteRow {
  headings: Heading[];
}
export interface Note extends SourceNote {
  lexical: ReturnType<typeof lexicalFor>;
  dirty: boolean;
  selections: { anchor: EditorPosition; head: EditorPosition; from: number; to: number }[];
  cursor: EditorPosition | null;
  cursorOffset: number;
}
export interface Snapshot {
  notes: NoteRow[];
  headings: (Heading & { path: string })[];
  links: NoteLink[];
  tags: { path: string; tag: string }[];
  properties: NoteProperty[];
}
export interface MarkdownViewPort {
  file?: TFile | null;
  editor?: Editor;
  getMode?: () => string;
}
export interface AgentDependencies {
  parseYaml?: (source: string) => unknown;
  getNodePath?: () => string;
  nodePath?: string;
  directory?: string;
  sqlTimeout?: number;
}
export interface BridgeFault extends Error {
  code?: string;
  details?: unknown;
}
