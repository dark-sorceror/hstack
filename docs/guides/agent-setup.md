---
title: "Connect a tool"
description: "Read live notes through the official Obsidian CLI."
---

Use the repository's Node client to give a trusted local script or agent live
context and revision-checked editing. The client is separate from the plugin
package; it does not install an MCP server or call a model.

## Before you start

- Install hstack and leave **Agent bridge** enabled.
- Enable Obsidian's official CLI and keep the desktop app and target vault open.
- Make this repository and a supported Node runtime available to your tool.

## Check the connection

From the repository root, replace `MyVault` with your vault name:

```sh
NOTES_VAULT=MyVault node bin/hstack.cjs capabilities
NOTES_VAULT=MyVault node bin/hstack.cjs context
NOTES_VAULT=MyVault node bin/hstack.cjs query '{"text":"compiler","limit":5}'
```

You should get a JSON reply with `ok: true`. Context includes the current
source-mode editor buffer, selections and its revision, including unsaved text.
Query matches include excerpts and source pointers.

## Select the right vault

`NOTES_VAULT` selects the vault; without it the official CLI chooses its active
vault. Set `OBSIDIAN_CLI` if the executable is not at its usual location.

PowerShell example:

```powershell
$env:NOTES_VAULT = "MyVault"
node bin/hstack.cjs context
```

On macOS the default executable is the app-bundled obsidian-cli. Other platforms
use `obsidian` from PATH. The wrapper serializes cooperating CLI calls to avoid
cross-routed eval output and checks response IDs.

## Edit safely

Start with a read, then [preview and apply a small patch](/reference/patches).
Use [SQL](/reference/sql) for structural questions across notes. Treat note
contents as data rather than agent instructions. Existing CLI access is powerful;
the bridge is not an authentication or OS isolation boundary.

[Troubleshoot connection errors](/start/troubleshooting).
