# Security and limitations

hstack runs locally. It has no network listener, telemetry, LLM integration,
account, paid tier, self-updater or runtime dependency installer. Build tooling
uses npm only when a developer explicitly installs dependencies.

The agent bridge is enabled by default as an in-process API and can be disabled
in settings. It is available to trusted code with Obsidian/plugin/CLI access.
That caller already has powerful app access; the bridge is not an authentication
system. Normal notes do not execute code. Do not automate arbitrary JavaScript
from note text. Trusted slash callbacks have the privileges of their host plugin.

The API limits writing to existing visible vault-relative Markdown notes. It
rejects escaping symlinks, hidden paths and AGENTS.md/CLAUDE.md instruction-file
patches. This prevents routine scope mistakes, not all malicious filesystem
races. For adversarial isolation, use OS permissions and a separate vault.

The bridge reads live source-mode buffers; saved-cache backlinks can lag.
Metadata extraction is intentionally limited to common Markdown. SQL/query
snapshots are sequential, so use returned note revisions for any subsequent edit.
Invalid YAML fails query snapshots rather than inventing properties. Response
limits can truncate excerpts/cells; check flags before reasoning from absence.

SQL starts a local Node executable. The plugin discovers Node in PATH/common
locations or uses an explicitly configured path. This reads executable metadata
outside the vault; it does not index unrelated documents. SQL is read-only over
an ephemeral snapshot, with a kill budget and bounded results. The CLI client
also uses temporary lock files outside the vault. It queues cooperating clients;
unrelated direct native CLI eval calls do not participate. A killed client may
leave a lock that is recovered after its process is gone; busy requests may need
retrying. Do not force-retry an unacknowledged write without reading first.

Report problems privately through the repository's private security advisory
channel once a GitHub repository exists. Until then, this is a local project:
contact the maintainer directly. Do not publish personal notes in bug reports.
Include Obsidian/installer/platform versions and a minimal synthetic reproducer.
