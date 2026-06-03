'use strict';
// SessionStart hook — inject 3-layer memory context (user + project + recent), then kick off
// the memory "sleep cycle" maintenance in the background (run-on-use, only if stale).
// Non-blocking: context print is fast; maintenance is detached and unref'd.

const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

// Derive tools path relative to this hook file so the repo is relocatable.
// In the repo: hooks/ sits one level above tools/.
// After sync to ~/.claude/hooks/ the deployed copy still points at the repo's tools/.
// AGENT_TOOLS_ROOT overrides for custom installs.
const TOOLS = process.env.AGENT_TOOLS_ROOT ||
  path.resolve(__dirname, '..', 'tools');

if (require.main === module) {
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(TOOLS, 'memory-context.js'), `--cwd=${process.cwd()}`], {
      timeout: 8000, encoding: 'utf8',
    });
  } catch { /* non-fatal — never block session start */ }

  try {
    const child = spawn(process.execPath, [path.join(TOOLS, 'memory-maintenance.js'), '--if-stale=3', '--quiet'], {
      detached: true, stdio: 'ignore',
    });
    child.unref();
  } catch { /* non-fatal */ }

  process.stdout.write(out && out.trim() ? `=== MEMORY CONTEXT ===\n${out.trim()}` : 'OK');
}
