---
title: "Install hstack"
description: "Build the candidate and install three files in a test vault."
---

Install the candidate in a separate vault before using it with your notes.
There is no published Community Plugins installation yet.

## Build from a source checkout

You need Obsidian 1.14.4+ and Node 22.16+ on Node 22.x, or Node 24+.
Rust is not needed for a normal build.

```sh
npm ci --ignore-scripts
npm run check
npm run package
```

The package is in `dist/1.0.0/`.

## Install the three plugin files

1. Open your test vault's configuration directory. It is usually `.obsidian`;
   use the actual directory if you changed it.
2. Create `plugins/hstack/` inside that directory.
3. Copy **main.js**, **manifest.json** and **styles.css** into that folder.
4. Enable **hstack** in Obsidian's Community plugins settings.

`SHA256SUMS` verifies the package; it is not an install file. Do not install
node_modules, source files, notes or a copied data.json.

If the legacy `notes-typing-helpers` installation is enabled, disable it before
enabling hstack. Both handle the same input. Back up settings before moving
between installation IDs.

## Check the installation

In a new note, type `/help` on its own line and press Enter. You should see the
command help. Then follow [your first note](/start/quickstart).

## Extra requirements for tools

| Feature                                        | Additional setup                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Writing, emoji, autocorrect and slash commands | None after installation                                           |
| Repository CLI client                          | Node and Obsidian's official CLI; the desktop app must be running |
| SQL snapshots                                  | An external Node executable with the required SQLite APIs         |

The repository's CLI client is separate from the plugin package.
[Connect a tool](/guides/agent-setup) or [troubleshoot setup](/start/troubleshooting).
