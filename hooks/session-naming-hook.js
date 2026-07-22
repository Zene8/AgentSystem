'use strict';
// SessionStart hook — auto-register and print session title using session-namer.js.
// Called once when a session starts; outputs a JSON title object for Claude Code
// to use in the session picker.

const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// session-namer.js can be in multiple places; check them all.
const TOOLS = [
  process.env.AGENT_TOOLS_ROOT,
  path.resolve(__dirname, '..', 'tools'),
  path.join(os.homedir(), 'dev', 'AgentSystem', 'tools'),
].find((p) => { try { return p && fs.existsSync(path.join(p, 'session-namer.js')); } catch { return false; } });

if (require.main === module) {
  let sessionId = null;
  let cwd = null;

  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = JSON.parse(raw);
    sessionId = payload.session_id || null;
    cwd = payload.cwd || null;
  } catch {
    // Malformed payload — exit cleanly, don't block session start.
    process.stdout.write('OK');
    process.exit(0);
  }

  if (!sessionId || !TOOLS) {
    process.stdout.write('OK');
    process.exit(0);
  }

  try {
    // Register the session in the registry.
    execFileSync(
      process.execPath,
      [path.join(TOOLS, 'session-namer.js'), '--register', `--session=${sessionId}`, ...(cwd ? [`--cwd=${cwd}`] : [])],
      { stdio: 'ignore', timeout: 5000 }
    );

    // Get the display title for Claude Code to use.
    const titleOutput = execFileSync(
      process.execPath,
      [path.join(TOOLS, 'session-namer.js'), '--print-title', `--session=${sessionId}`, ...(cwd ? [`--cwd=${cwd}`] : [])],
      { encoding: 'utf8', timeout: 5000 }
    );

    const displayTitle = titleOutput.trim();
    if (displayTitle) {
      // Emit a title object that Claude Code's SessionStart event can consume.
      const titleObj = { title: displayTitle };
      process.stdout.write(JSON.stringify(titleObj));
    } else {
      process.stdout.write('OK');
    }
  } catch {
    // Errors in session-namer are non-critical — never block session start.
    process.stdout.write('OK');
  }

  process.exit(0);
}
