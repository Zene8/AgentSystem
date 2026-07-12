'use strict';
// SessionStart hook — inject 3-layer memory context (user + project + recent), then kick off
// the memory "sleep cycle" maintenance in the background (run-on-use, only if stale).
// Non-blocking: context print is fast; maintenance is detached and unref'd.

const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

// Deployed copies live in ~/.claude/hooks where "../tools" does not exist — every
// candidate is existence-checked so the hook works from both the repo and the
// deployed location (root cause of the silent SessionStart injection outage, 2026-07-12).
const fs = require('node:fs');
const TOOLS = [
  process.env.AGENT_TOOLS_ROOT,
  path.resolve(__dirname, '..', 'tools'),
  path.join(require('node:os').homedir(), 'dev', 'AgentSystem', 'tools'),
].find((p) => { try { return p && fs.existsSync(path.join(p, 'memory-context.js')); } catch { return false; } });

if (require.main === module) {
  let out = '';
  try {
    // #121: static SessionStart core trimmed 7 -> 3 (identity/role/hard-pref only). Task-relevant
    // facts are now injected on-demand by memory-router.js's UserPromptSubmit-stage BM25 retrieval.
    out = execFileSync(process.execPath, [path.join(TOOLS, 'memory-context.js'), `--cwd=${process.cwd()}`, '--core=3'], {
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
