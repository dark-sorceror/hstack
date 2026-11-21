const { Modal } = require("obsidian");

module.exports = class SlashHelpModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    this.titleEl.setText("Slash commands");
    const content = this.contentEl;
    content.createEl("p", {
      text: "Type / on an empty line to see commands. Your most-used commands appear first.",
    });
    for (const command of this.plugin.slash.commands) {
      const row = content.createDiv({ cls: "notes-slash-help-row" });
      row.createEl("strong", {
        text:
          `/${command.name}` +
          (command.aliases.length ? ` · /${command.aliases.join(" · /")}` : ""),
      });
      row.createEl("p", { text: command.description });
    }
    content.createEl("p", {
      text: "↑ / ↓ choose a command · Tab completes it · Enter runs it · Escape closes the menu.",
    });
    content.createEl("p", {
      text: "Run /toc again after changing headings to refresh the existing contents.",
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
