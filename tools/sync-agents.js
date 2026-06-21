#!/usr/bin/env node
/**
 * sync-agents.js -- Cross-platform agent sync (Linux/Mac/Windows)
 * Replicates sync_agents_from_repo.ps1 in Node.js.
 * Usage: node tools/sync-agents.js
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = join(__dirname, '..');
const AGENTS_DIR = join(REPO_ROOT, '.agents', 'agents');
const CONFIG_DIR = join(REPO_ROOT, 'config');
const HOME       = homedir();

// Model assignments per CLI (mirrors config/models.yml)
const MODELS = {
  claude:  { jarvis:'claude-opus-4-8', sam:'claude-sonnet-4-6', friday:'claude-sonnet-4-6', nat:'claude-sonnet-4-6', ultron:'claude-sonnet-4-6', pym:'claude-sonnet-4-6', leo:'claude-sonnet-4-6', astra:'claude-sonnet-4-6', wanda:'claude-haiku-4-5-20251001', threepio:'claude-haiku-4-5-20251001', r2d2:'claude-haiku-4-5-20251001' },
  gemini:  { jarvis:'gemini-3.1-pro-preview', sam:'gemini-3.1-pro-preview', friday:'gemini-3-flash-preview', nat:'gemini-3-flash-preview', ultron:'gemini-3-flash-preview', pym:'gemini-3-flash-preview', leo:'gemini-3-flash-preview', astra:'gemini-3-flash-preview', wanda:'gemini-3.1-flash-lite-preview', threepio:'gemini-3.1-flash-lite-preview', r2d2:'gemini-3.1-flash-lite-preview' },
  copilot: { jarvis:'gpt-5.2-codex', sam:'gpt-5.2-codex', friday:'gpt-5.4-mini', nat:'gpt-5.4-mini', ultron:'gpt-5.4-mini', pym:'gpt-5.4-mini', leo:'gpt-5.4-mini', astra:'gpt-5.4-mini', wanda:'gpt-5-mini', threepio:'gpt-5-mini', r2d2:'gpt-5-mini' },
};

function ok(msg)   { console.log('[SUCCESS]', msg); }
function info(msg) { console.log('[INFO]', msg); }
function warn(msg) { console.warn('[WARN]', msg); }

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return meta;
}

function setModel(content, model) {
  return content.replace(/^(model:\s*).*$/m, `$1${model}`);
}

function stripFrontmatter(content) {
  return content.replace(/^---[\s\S]*?---\n/, '');
}

function copilotFrontmatter(name, description, model) {
  const safeDesc = description.replace(/"/g, "'");
  return `---\nname: "${name}"\ndescription: "${safeDesc}"\nmodel: "${model}"\n---\n\n`;
}

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

// Antigravity CLI (agy) ships agents as a plugin: a plugin.json manifest plus an
// agents/<name>.md dir (frontmatter name+description, body = system prompt).
// Installed via `agy plugin install <dir>`. See sync verification notes.
const ANTI_PLUGIN_DIR = join(HOME, '.gemini', 'agentsystem-plugin');
const ANTI_AGENTS_DIR = join(ANTI_PLUGIN_DIR, 'agents');

// Pull the behavior block (the agent's system prompt) out of an agent .md and dedent it.
function behaviorBody(content) {
  const body = stripFrontmatter(content);
  const m = body.match(/^\s*behavior:\s*\|[^\n]*\n([\s\S]*)$/);
  const raw = m ? m[1] : body;
  return raw.split('\n').map(l => l.replace(/^  /, '')).join('\n').trim();
}

// Write one agent into the Antigravity plugin's agents/ dir as Claude-style markdown.
// NOTE: agy silently drops any agent whose `tools:` frontmatter names a tool it
// doesn't recognize (github-cli, gmail, figma, npm, docker, ...). Our tool names are
// abstract/Claude-style and have no agy equivalent, so we omit `tools:` entirely --
// the agent then loads with default tool access (same as built-in agy agents).
function writeAntigravityAgent(file, name, desc, model, content) {
  ensureDir(ANTI_AGENTS_DIR);
  const safeDesc = desc.replace(/\n+/g, ' ').replace(/"/g, "'");
  const md = `---\nname: ${name}\ndescription: "${safeDesc}"\nmodel: ${model}\n`
    + `---\n\n${behaviorBody(content)}\n`;
  writeFileSync(join(ANTI_AGENTS_DIR, file), md, 'utf8');
  ok(`Antigravity: ${join(ANTI_AGENTS_DIR, file)}`);
}

// Finalize the plugin manifest and install it into agy if the CLI is available.
function installAntigravityPlugin() {
  writeFileSync(join(ANTI_PLUGIN_DIR, 'plugin.json'), JSON.stringify({
    name: 'agentsystem',
    version: '1.0.0',
    description: 'AgentSystem agent roster synced from .agents/agents',
    author: 'AgentSystem',
  }, null, 2) + '\n', 'utf8');

  for (const agy of ['agy', join(HOME, '.local', 'bin', 'agy')]) {
    try {
      execFileSync(agy, ['plugin', 'install', ANTI_PLUGIN_DIR], { stdio: 'inherit' });
      ok(`Antigravity: installed plugin via ${agy}`);
      return true;
    } catch { /* try next candidate */ }
  }
  warn(`agy CLI not found -- to register agents run: agy plugin install ${ANTI_PLUGIN_DIR}`);
  return false;
}

function syncAgent(file) {
  const agentName = file.replace(/\.md$/, '').toLowerCase();
  const srcPath   = join(AGENTS_DIR, file);
  const content   = readFileSync(srcPath, 'utf8');
  const meta      = parseFrontmatter(content);
  const name      = meta.name || agentName;
  const desc      = meta.description || '';

  info(`Syncing: ${agentName}`);

  // Claude Code
  const claudeDir = join(HOME, '.claude', 'agents');
  ensureDir(claudeDir);
  const claudeModel = MODELS.claude[agentName] || meta.model || '';
  writeFileSync(join(claudeDir, file), setModel(content, claudeModel), 'utf8');
  ok(`Claude: ${join(claudeDir, file)}`);

  // Gemini CLI
  const geminiDir = join(HOME, '.gemini', 'agents');
  ensureDir(geminiDir);
  const geminiModel = MODELS.gemini[agentName] || 'gemini-3-flash-preview';
  writeFileSync(join(geminiDir, file), setModel(content, geminiModel), 'utf8');
  ok(`Gemini: ${join(geminiDir, file)}`);

  // Copilot
  const copilotDir = join(HOME, '.copilot', 'agents');
  ensureDir(copilotDir);
  const copilotModel = MODELS.copilot[agentName] || 'gpt-5.4-mini';
  const body = stripFrontmatter(content);
  writeFileSync(join(copilotDir, file), copilotFrontmatter(name, desc, copilotModel) + body, 'utf8');
  ok(`Copilot: ${join(copilotDir, file)}`);

  // Antigravity CLI (agy) -- stage into the plugin agents/ dir (installed after the loop)
  writeAntigravityAgent(file, name, desc, geminiModel, content);
}

function syncConfig() {
  const destDir = join(HOME, '.claude', 'agents', 'config');
  ensureDir(destDir);
  if (!existsSync(CONFIG_DIR)) return;
  for (const f of readdirSync(CONFIG_DIR)) {
    if (!f.endsWith('.yml')) continue;
    copyFileSync(join(CONFIG_DIR, f), join(destDir, f));
    ok(`Config: ${f} -> ${destDir}`);
  }
}

info('Starting cross-platform agent sync...');

// Rebuild the Antigravity plugin staging dir from scratch so removed agents don't linger.
if (existsSync(ANTI_AGENTS_DIR)) rmSync(ANTI_AGENTS_DIR, { recursive: true, force: true });

const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'));
for (const file of files) {
  try { syncAgent(file); } catch (e) { warn(`Failed ${file}: ${e.message}`); }
}

syncConfig();
installAntigravityPlugin();

const claudeCount  = readdirSync(join(HOME, '.claude', 'agents')).filter(f => f.endsWith('.md')).length;
const geminiCount  = existsSync(join(HOME, '.gemini', 'agents')) ? readdirSync(join(HOME, '.gemini', 'agents')).filter(f => f.endsWith('.md')).length : 0;
const copilotCount = existsSync(join(HOME, '.copilot', 'agents')) ? readdirSync(join(HOME, '.copilot', 'agents')).filter(f => f.endsWith('.md')).length : 0;
const antiCount    = existsSync(ANTI_AGENTS_DIR) ? readdirSync(ANTI_AGENTS_DIR).filter(f => f.endsWith('.md')).length : 0;

ok(`Sync complete -- Claude: ${claudeCount}, Gemini: ${geminiCount}, Copilot: ${copilotCount}, Antigravity: ${antiCount}`);