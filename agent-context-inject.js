'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PROJECT_MD_NAMES = ['CLAUDE.md', 'GEMINI.md', 'AGENT_INSTRUCTIONS.md'];
const CONFIG_DIR = path.join(os.homedir(), '.claude', 'agents', 'config');
const CEO_MD = path.join(os.homedir(), '.claude', 'agents', 'executive', 'ceo.md');

function findProjectMd(startDir) {
  let dir = startDir;
  const root = path.parse(dir).root;

  while (dir !== root) {
    for (const name of PROJECT_MD_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return { path: candidate, content: fs.readFileSync(candidate, 'utf8') };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readConfig(filename) {
  try {
    return fs.readFileSync(path.join(CONFIG_DIR, filename), 'utf8');
  } catch {
    return '';
  }
}

function readCeoPrompt() {
  try {
    return fs.readFileSync(CEO_MD, 'utf8');
  } catch {
    return '';
  }
}

function buildPreamble(projectContent, modelsYml, mcpsYml, toolsYml, ceoPrompt) {
  const sections = [];

  if (projectContent) {
    sections.push(`=== ACTIVE PROJECT CONTEXT ===\n${projectContent}`);
  }
  if (modelsYml) {
    sections.push(`=== AVAILABLE MODELS ===\n${modelsYml}`);
  }
  if (mcpsYml) {
    sections.push(`=== AVAILABLE MCPS ===\n${mcpsYml}`);
  }
  if (toolsYml) {
    sections.push(`=== AVAILABLE TOOLS ===\n${toolsYml}`);
  }
  if (ceoPrompt) {
    sections.push(`=== YOUR ROLE ===\nYou are the CEO agent. All prompts route through you by default unless the user explicitly addresses another agent.\n\n${ceoPrompt}`);
  }

  return sections.join('\n\n');
}

module.exports = { findProjectMd, buildPreamble, readCeoPrompt };

if (require.main === module) {
  const cwd = process.cwd();
  const projectMd = findProjectMd(cwd);
  const modelsYml = readConfig('models.yml');
  const mcpsYml = readConfig('mcps.yml');
  const toolsYml = readConfig('tools.yml');
  const ceoPrompt = readCeoPrompt();

  const preamble = buildPreamble(
    projectMd ? projectMd.content : null,
    modelsYml,
    mcpsYml,
    toolsYml,
    ceoPrompt
  );

  process.stdout.write(preamble || 'OK');
}
