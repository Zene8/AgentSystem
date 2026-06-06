'use strict';
// SessionStart hook — injects the compiled routines rules into agent context.
// Reads .agents/rules/routines.generated.md (compiled by `node tools/routines.js compile`).
// Also checks routine-overrides.json and notes any active bypasses.
// Non-blocking: if the file is missing, emits nothing (compile not yet run is fine).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Path to the compiled rules file (repo-relative from AGENT_TOOLS_ROOT/../)
const TOOLS = process.env.AGENT_TOOLS_ROOT ||
  path.resolve(__dirname, '..', 'tools');
const REPO_ROOT = path.resolve(TOOLS, '..');
const GENERATED_MD = path.join(REPO_ROOT, '.agents', 'rules', 'routines.generated.md');
const OVERRIDES_PATH = path.join(os.homedir(), 'agent-memory', 'nexus', 'routine-overrides.json');

if (require.main === module) {
  let out = '';

  try {
    const md = fs.readFileSync(GENERATED_MD, 'utf8');
    if (md && md.trim()) {
      out += `=== ENFORCED ROUTINES ===\n${md.trim()}`;
    }
  } catch {
    // Missing generated file — compile not run yet, or no agent-rule routines. Silent.
  }

  try {
    const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
    const bypassed = Object.keys(overrides).filter(id => overrides[id] && overrides[id].bypassed);
    if (bypassed.length > 0) {
      out += `\n\n[ROUTINES] Active bypasses: ${bypassed.join(', ')}. These routines are NOT enforced this session.`;
    }
  } catch {
    // No overrides file — nothing bypassed.
  }

  process.stdout.write(out || 'OK');
}
