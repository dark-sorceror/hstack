---
title: "Permissions and limits"
description: "Understand local access before enabling tools."
---

hstack has no runtime network listener, telemetry, account, model integration,
self-updater or dependency installer. Plugin settings and usage counts stay in
Obsidian's data.json; notes are not rewritten on load.

## Agent bridge

The bridge is enabled by default and can be disabled in settings. It is an
in-process API for trusted code with plugin/CLI access, not an authentication
system or OS sandbox. The unrestricted native CLI can do more than this API.

Reads cover visible vault Markdown and live source-mode buffers. Writes target
explicit existing notes and require their revision. Hidden/escaping paths and
AGENTS.md/CLAUDE.md patches are rejected. The bridge does not create, rename or
delete notes. Filesystem checks reduce scope mistakes, not every malicious race.

Text templates never evaluate code. Registered JavaScript callbacks run with
their host plugin's privileges. Never turn note text into executable instructions.

## Outside-vault activity

SQL discovers or uses a configured external Node executable and sends a bounded
snapshot to a local child process. It reads executable metadata outside the
vault, not unrelated documents. The database exists only in memory; execution,
heap and output are bounded. See [SQL limits](/reference/sql).

The separate CLI client launches Obsidian's official CLI and uses temporary
locks outside the vault. Its locks serialize cooperating clients; unrelated
direct CLI calls do not participate.

## Consistency limits

Metadata covers common Markdown, snapshots capture notes sequentially, and
saved-cache backlinks can lag. Check truncation flags before reasoning from
missing data. After an unacknowledged write, read before retrying.

## Report a problem

Use a private maintainer contact or the repository's private security reporting
route once configured. Do not put personal notes or credentials in public
issues. Include app/installer/plugin/OS versions and a minimal synthetic example.
