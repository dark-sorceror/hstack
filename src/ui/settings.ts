import { PluginSettingTab, Setting, type App } from "obsidian";
import { validateTemplates, installTemplates } from "../public-api.js";
import type HstackCore from "../plugin.js";
import logo from "../../docs/images/hstack-logo-centered.png";
import type { FeatureFlag, SlashTemplate } from "../settings-types.js";

export default class TypingSettings extends PluginSettingTab {
  plugin: HstackCore;
  constructor(app: App, plugin: HstackCore) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    this.containerEl.empty();
    const heading = this.containerEl.createDiv({ cls: "hstack-settings-heading" });
    heading.createEl("img", {
      attr: {
        src: logo,
        alt: "",
        width: "32",
        height: "32",
      },
    });
    heading.createEl("h2", { text: "hstack" });
    const controls: [FeatureFlag, string, string][] = [
      [
        "mixedLists",
        "Mixed lists",
        "Tab creates bullet children by default. Shift+Tab, or Enter/Backspace on an empty child, resumes its parent's list type.",
      ],
      [
        "literalSpaces",
        "Literal spaces",
        "Space inserts an ordinary space, including repeated spaces. Use Tab for deliberate indentation.",
      ],
      [
        "autocorrect",
        "English autocorrect",
        "Correct clear typos after Space. Immediate Backspace restores the spelling and skips correcting it again this session.",
      ],
      [
        "calloutPaste",
        "Keep pasted text in callouts",
        "Multiline pastes keep the callout's quote prefixes, blank lines, and code indentation.",
      ],
      [
        "agentBridge",
        "Agent bridge",
        "Allow local scripts to query context and apply revision-checked note edits. No network listener is started.",
      ],
      [
        "slash",
        "Slash commands",
        "Type / on an empty line. Tab completes; Enter runs. /toc updates contents, /format cleans up Markdown, /help shows commands.",
      ],
      [
        "typography",
        "Arrow and dash shortcuts",
        "Automatically convert --, ---, -->, <-- and <-->. Immediate Backspace restores the raw shortcut.",
      ],
      [
        "listShortcuts",
        "List-prefix shortcuts",
        ".- starts a dot bullet; [] starts a checkbox item.",
      ],
      [
        "listStyles",
        "Dashed lists",
        "Show ordinary - list markers as dashes; * and + retain dot bullets.",
      ],
      [
        "underline",
        "Underscore underlining",
        "Render __text__ as underlined text. **text** remains bold.",
      ],
      [
        "formatPairs",
        "Close emphasis pairs",
        "Extend native * and _ pairs to automatically close **, __ and nested emphasis.",
      ],
      [
        "emoji",
        "Emoji picker",
        "Type : to search, then Enter to insert. :thumbs-up: and other complete names expand directly.",
      ],
    ];
    for (const [key, name, description] of controls) {
      new Setting(this.containerEl)
        .setName(name)
        .setDesc(description)
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.options[key]).onChange(async (value) => {
            this.plugin.options[key] = value;
            await this.plugin.saveSettings();
          })
        );
    }
    const validation = this.containerEl.createDiv({ cls: "hstack-template-validation" });
    new Setting(this.containerEl)
      .setName("Custom slash templates")
      .setDesc(
        "JSON array of {name, description, template}. Placeholders: {{date}}, {{time}}, {{title}}, {{selection}}. Valid changes save immediately."
      )
      .addTextArea((input) => {
        input.inputEl.rows = 7;
        input
          .setValue(JSON.stringify(this.plugin.options.templates || [], null, 2))
          .onChange(async (value) => {
            try {
              const templates = validateTemplates(JSON.parse(value));
              // Check conflicts with programmatically registered commands before replacing anything.
              const oldNames = new Set(
                (this.plugin.options.templates || []).map((t) => (t as SlashTemplate).name)
              );
              if (
                templates.some((t) =>
                  this.plugin.slash.commands.some(
                    (c) => !oldNames.has(c.name) && [c.name, ...c.aliases].includes(t.name)
                  )
                )
              )
                throw Error("Command name is already registered.");
              installTemplates(this.plugin, templates);
              this.plugin.options.templates = templates;
              await this.plugin.saveSettings();
              validation.setText("");
            } catch (error) {
              validation.setText("Not saved: " + (error as Error).message);
            }
          });
      });
    new Setting(this.containerEl)
      .setName("SQL Node executable")
      .setDesc(
        "Optional absolute path to Node.js 22.16+ on Node 22.x with node:sqlite. Empty uses automatic discovery. SQL only; typing features need no Node installation."
      )
      .addText((input) =>
        input.setValue(this.plugin.options.sqlNodePath || "").onChange(async (value) => {
          this.plugin.options.sqlNodePath = value.trim();
          await this.plugin.saveSettings();
        })
      );
    new Setting(this.containerEl)
      .setName("Words to keep")
      .setDesc("One word per line. These terms are never autocorrected.")
      .addTextArea((input) =>
        input.setValue(this.plugin.options.autocorrectWords.join("\n")).onChange(async (value) => {
          this.plugin.options.autocorrectWords = [
            ...new Set(
              value
                .split(/\s+/)
                .map((word) => word.trim().toLowerCase())
                .filter(Boolean)
            ),
          ];
          this.plugin.autocorrect?.setPersonalWords(this.plugin.options.autocorrectWords);
          await this.plugin.saveSettings();
        })
      );
  }
}
