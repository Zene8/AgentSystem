#!/usr/bin/env node
// routines.js — Routines engine CLI. No npm deps; pure Node.js builtins only.
//
// Commands:
//   compile             — generate .agents/rules/routines.generated.md from routines.yml
//   list                — show all routines + enabled/bypassed state
//   enable <id>         — set enabled: true in routines.yml
//   disable <id>        — set enabled: false in routines.yml
//   bypass <id>         — write override to ~/agent-memory/nexus/routine-overrides.json
//   bypass <id> --session — same, tagged as session-only
//   unbypass <id>       — remove override from routine-overrides.json

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ROUTINES_YML = join(REPO_ROOT, 'config', 'routines.yml');
const GENERATED_MD = join(REPO_ROOT, '.agents', 'rules', 'routines.generated.md');
const OVERRIDES_PATH = join(homedir(), 'agent-memory', 'nexus', 'routine-overrides.json');

// ---------------------------------------------------------------------------
// Minimal YAML parser — handles the constrained routines.yml format only.
// Supports: list of objects with string/boolean values. No nested objects.
// ---------------------------------------------------------------------------
export function parseRoutinesYml(text) {
  const routines = [];
  let current = null;
  let inMultilineAction = false;
  let actionLines = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      if (inMultilineAction) {
        // blank line ends multiline action
        inMultilineAction = false;
        if (current) current.action = actionLines.join(' ').trim();
        actionLines = [];
      }
      continue;
    }

    // New list item
    if (trimmed.startsWith('- id:')) {
      if (current) routines.push(current);
      current = { id: trimmed.replace('- id:', '').trim() };
      inMultilineAction = false;
      actionLines = [];
      continue;
    }

    if (!current) continue;

    // key: value pairs (indented under the list item)
    const kvMatch = line.match(/^\s+(\w[\w_-]*):\s*(.*)/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const val = kvMatch[2].trim();

    if (inMultilineAction) {
      // continuation of a block scalar — but we use quoted strings, so this
      // handles the case where action: spans via a quoted value.
      inMultilineAction = false;
      if (current) current.action = actionLines.join(' ').trim();
      actionLines = [];
    }

    if (val === 'true') { current[key] = true; continue; }
    if (val === 'false') { current[key] = false; continue; }

    // Strip surrounding quotes
    const unquoted = val.replace(/^["'](.*)["']$/, '$1');
    current[key] = unquoted;
  }

  if (current) routines.push(current);
  return routines;
}

// ---------------------------------------------------------------------------
// Serialize a single routine back to YAML (for enable/disable).
// Surgical: replaces only the `enabled:` line for the given id.
// ---------------------------------------------------------------------------
function setEnabledInYml(text, id, value) {
  const lines = text.split('\n');
  let inTarget = false;
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === `- id: ${id}`) { inTarget = true; }
    else if (inTarget && trimmed.startsWith('- id:')) { inTarget = false; }

    if (inTarget && /^\s+enabled:/.test(line)) {
      result.push(line.replace(/enabled:\s*(true|false)/, `enabled: ${value}`));
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Overrides file (runtime bypass — no registry edit needed)
// ---------------------------------------------------------------------------
function readOverrides() {
  try {
    return JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeOverrides(overrides) {
  mkdirSync(join(homedir(), 'agent-memory', 'nexus'), { recursive: true });
  writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdList() {
  const text = readFileSync(ROUTINES_YML, 'utf8');
  const routines = parseRoutinesYml(text);
  const overrides = readOverrides();

  console.log('Routines:\n');
  for (const r of routines) {
    const bypass = overrides[r.id];
    const bypassed = bypass ? ` [BYPASSED${bypass.session ? ' session' : ''}]` : '';
    const enabled = r.enabled ? 'enabled' : 'disabled';
    console.log(`  ${r.id}`);
    console.log(`    mechanism: ${r.mechanism}  enforce: ${r.enforce}  ${enabled}${bypassed}`);
    console.log(`    ${r.description}`);
    console.log();
  }
}

function cmdCompile() {
  const text = readFileSync(ROUTINES_YML, 'utf8');
  const routines = parseRoutinesYml(text);
  const overrides = readOverrides();

  const agentRules = routines.filter(r =>
    r.mechanism === 'agent-rule' && r.enabled && !overrides[r.id]
  );

  const lines = [
    '<!-- AUTO-GENERATED by `node tools/routines.js compile` — DO NOT EDIT BY HAND -->',
    '<!-- Source: config/routines.yml -->',
    '',
    '# Enforced Routines',
    '',
    'The following rules are hard-enforced by default. To bypass one:',
    '  `node tools/routines.js bypass <id> [--session]`',
    '',
  ];

  for (const r of agentRules) {
    lines.push(`## ${r.id} (${r.enforce})`);
    lines.push(`*${r.description}*`);
    lines.push('');
    lines.push(r.action);
    lines.push('');
  }

  if (agentRules.length === 0) {
    lines.push('_(no active agent-rule routines)_');
    lines.push('');
  }

  mkdirSync(join(REPO_ROOT, '.agents', 'rules'), { recursive: true });
  writeFileSync(GENERATED_MD, lines.join('\n'), 'utf8');
  console.log(`[routines] compiled ${agentRules.length} agent-rules → ${GENERATED_MD}`);

  // Report other mechanisms
  const hooks = routines.filter(r => r.mechanism === 'hook' && r.enabled);
  const crons = routines.filter(r => r.mechanism === 'cron' && r.enabled);
  if (hooks.length) console.log(`[routines] ${hooks.length} hook-routines active (dispatched by routine-dispatch.js)`);
  if (crons.length) console.log(`[routines] ${crons.length} cron-routines (register via Task Scheduler manually or via setup-scheduled-tasks.ps1)`);
}

function cmdEnable(id) {
  if (!id) { console.error('Usage: routines.js enable <id>'); process.exit(1); }
  let text = readFileSync(ROUTINES_YML, 'utf8');
  const routines = parseRoutinesYml(text);
  if (!routines.find(r => r.id === id)) {
    console.error(`[routines] unknown routine: ${id}`); process.exit(1);
  }
  text = setEnabledInYml(text, id, true);
  writeFileSync(ROUTINES_YML, text, 'utf8');
  console.log(`[routines] enabled: ${id}`);
}

function cmdDisable(id) {
  if (!id) { console.error('Usage: routines.js disable <id>'); process.exit(1); }
  let text = readFileSync(ROUTINES_YML, 'utf8');
  const routines = parseRoutinesYml(text);
  if (!routines.find(r => r.id === id)) {
    console.error(`[routines] unknown routine: ${id}`); process.exit(1);
  }
  text = setEnabledInYml(text, id, false);
  writeFileSync(ROUTINES_YML, text, 'utf8');
  console.log(`[routines] disabled: ${id}`);
}

function cmdBypass(id, sessionFlag) {
  if (!id) { console.error('Usage: routines.js bypass <id> [--session]'); process.exit(1); }
  const text = readFileSync(ROUTINES_YML, 'utf8');
  const routines = parseRoutinesYml(text);
  if (!routines.find(r => r.id === id)) {
    console.error(`[routines] unknown routine: ${id}`); process.exit(1);
  }
  const overrides = readOverrides();
  overrides[id] = { bypassed: true, session: !!sessionFlag, at: new Date().toISOString() };
  writeOverrides(overrides);
  console.log(`[routines] bypassed: ${id}${sessionFlag ? ' (session)' : ''}`);
}

function cmdUnbypass(id) {
  if (!id) { console.error('Usage: routines.js unbypass <id>'); process.exit(1); }
  const overrides = readOverrides();
  if (!overrides[id]) { console.log(`[routines] ${id} was not bypassed`); return; }
  delete overrides[id];
  writeOverrides(overrides);
  console.log(`[routines] unbypass: ${id}`);
}

// ---------------------------------------------------------------------------
// Dispatch mode — called by routine-dispatch.js hook at runtime
// ---------------------------------------------------------------------------
export function dispatchRoutines({ event, context } = {}) {
  const text = readFileSync(ROUTINES_YML, 'utf8');
  const routines = parseRoutinesYml(text);
  const overrides = readOverrides();

  return routines.filter(r => {
    if (!r.enabled) return false;
    if (overrides[r.id]) return false;
    if (r.mechanism !== 'hook') return false;
    // Match trigger to event context
    if (event === 'PostToolUse' && r.trigger === 'pr_create') return true;
    if (event === 'UserPromptSubmit' && r.trigger === 'identity_lookup') return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const isMain = process.argv[1] &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const [,, cmd, arg, ...rest] = process.argv;
  const sessionFlag = rest.includes('--session');

  switch (cmd) {
    case 'list':    cmdList(); break;
    case 'compile': cmdCompile(); break;
    case 'enable':  cmdEnable(arg); break;
    case 'disable': cmdDisable(arg); break;
    case 'bypass':  cmdBypass(arg, sessionFlag); break;
    case 'unbypass': cmdUnbypass(arg); break;
    default:
      console.log('Usage: node tools/routines.js <list|compile|enable|disable|bypass|unbypass> [id] [--session]');
      process.exit(1);
  }
}
