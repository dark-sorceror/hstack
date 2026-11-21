export type FeatureFlag =
  | "mixedLists"
  | "literalSpaces"
  | "typography"
  | "listShortcuts"
  | "listStyles"
  | "underline"
  | "emoji"
  | "formatPairs"
  | "autocorrect"
  | "calloutPaste"
  | "slash"
  | "agentBridge";
export interface SlashTemplate {
  name: string;
  description?: string;
  template: string;
}
export type HstackSettings = Record<FeatureFlag, boolean> & {
  autocorrectWords: string[];
  slashUsage: Record<string, number>;
  emojiUsage: Record<string, number>;
  templates: SlashTemplate[];
  sqlNodePath: string;
};
