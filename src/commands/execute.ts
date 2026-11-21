import type { Editor, EditorSuggestContext, Notice as ObsidianNotice, App, Modal } from "obsidian";
import type HstackCore from "../plugin.js";

export function executeSlashCommand(
  plugin: HstackCore,
  id: string,
  context: EditorSuggestContext,
  editor: Editor,
  {
    Notice,
    SlashHelpModal,
  }: {
    Notice: typeof ObsidianNotice;
    SlashHelpModal: new (app: App, plugin: HstackCore) => Modal;
  }
): void {
  const trigger = plugin.slash.triggerAt(editor.getLine(context.end.line), context.end.ch);
  if (!trigger || trigger.column !== context.start.ch) return;
  const from = editor.posToOffset(context.start),
    to = editor.posToOffset(context.end);
  const text = editor.getValue();
  if (id === "toc") {
    const plan = plugin.outline.planTOC(text, from, to);
    if (!plan) {
      new Notice(
        plugin.outline.scanHeadings(text).length
          ? "Couldn't update the contents safely. Check the existing contents block."
          : "Add a heading with # first, then run /toc."
      );
      return;
    }
    plugin.applyEditorPlan(editor, plan, "input.notes-toc");
    new Notice(
      `${plan.updated ? "Updated" : "Inserted"} contents · ${plan.headingCount} headings`,
      2200
    );
  } else if (id === "format") {
    const plan = plugin.format.planFormat(text, from, to);
    if (!plan) {
      new Notice("Use /format on its own line outside a code block.");
      return;
    }
    plugin.applyEditorPlan(editor, plan, "input.notes-format");
    new Notice(
      plan.changed ? "Markdown formatted" : "Markdown formatting is already consistent",
      2200
    );
  } else if (id === "help") {
    plugin.applyEditorPlan(
      editor,
      { changes: [{ from, to, insert: "" }], cursor: from },
      "input.notes-command"
    );
    new SlashHelpModal(plugin.app, plugin).open();
  } else {
    const command = plugin.slash.commands.find((c) => c.id === id);
    if (command?.run) {
      try {
        Promise.resolve(
          command.run({
            editor,
            from,
            to,
            title: plugin.app.workspace.getActiveFile()?.basename || "",
            app: plugin.app,
          })
        ).catch((error) => {
          console.error("hstack command failed", error);
          new Notice("Command failed: " + (error as Error).message);
        });
      } catch (error) {
        console.error("hstack command failed", error);
        new Notice("Command failed: " + (error as Error).message);
      }
    }
  }
}
