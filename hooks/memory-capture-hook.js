'use strict';
// SessionEnd hook — detached, non-blocking extraction of durable facts from the session
// transcript. Shells memory-capture.js in the background and exits 0 immediately.
// Never blocks the session end, never crashes the harness.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const TOOLS = process.env.AGENT_TOOLS_ROOT ||
  path.resolve(__dirname, '..', 'tools');

if (require.main === module) {
  let transcriptPath = null;

  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = JSON.parse(raw);
    transcriptPath = payload.transcript_path || null;
  } catch {
    // Malformed or missing payload — exit cleanly, don't block session end.
    process.stdout.write('OK');
    process.exit(0);
  }

  if (!transcriptPath) {
    process.stdout.write('OK');
    process.exit(0);
  }

  try {
    const child = spawn(process.execPath, [path.join(TOOLS, 'memory-capture.js'), transcriptPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // spawn failure is non-fatal — never block session end.
  }

  process.stdout.write('OK');
}
