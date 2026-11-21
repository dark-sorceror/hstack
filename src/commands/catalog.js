"use strict";

const commands = Object.freeze([
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

function isCommandPrefix(id, token) {
  const command = commands.find((command) => command.id === id);
  return (
    /^\/[a-z]*$/.test(token) &&
    [command.name, ...command.aliases].some((name) => name.startsWith(token.slice(1)))
  );
}
const reservedNames = Object.freeze(
  commands.flatMap((command) => [command.name, ...command.aliases])
);
module.exports = { commands, reservedNames, isCommandPrefix };
