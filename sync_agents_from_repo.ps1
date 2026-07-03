# sync_agents_from_repo.ps1 - Thin shim delegating to Node.js cross-platform script
# Deprecated: use `node tools/sync-agents.js` directly instead.
# This shim remains for backwards compatibility on Windows.

node tools/sync-agents.js
