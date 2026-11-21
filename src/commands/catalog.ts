import type { SlashCommand } from "../api.js";
export type CommandDefinition = Omit<SlashCommand, "run" | "icon"> & {
  aliases: string[];
  icon: string;
};

export const commands: readonly Readonly<CommandDefinition>[] = Object.freeze([
  Object.freeze({
    id: "toc",
    name: "toc",
    aliases: ["outline"],
    icon: "📑",
    description: "Insert a table of contents for this note",
  }),
  Object.freeze({
    id: "format",
    name: "format",
    aliases: ["tidy"],
    icon: "🧹",
    description: "Format this note’s Markdown spacing",
  }),
  Object.freeze({
    id: "help",
    name: "help",
    aliases: [],
    icon: "💡",
    description: "See available commands and keyboard shortcuts",
  }),
]);

export function isCommandPrefix(id: string, token: string): boolean {
  const command = commands.find((command) => command.id === id)!;
  return (
    /^\/[a-z]*$/.test(token) &&
    [command.name, ...command.aliases].some((name) => name.startsWith(token.slice(1)))
  );
}
export const reservedNames = Object.freeze(
  commands.flatMap((command) => [command.name, ...command.aliases])
);
