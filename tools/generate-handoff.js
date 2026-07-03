#!/usr/bin/env node
/**
 * generate-handoff.js — Auto-generate HANDOFF.md for session continuation.
 *
 * Usage:
 *   node generate-handoff.js [--cwd=PATH] [--trigger=manual|auto]
 *
 * Writes HANDOFF.md at git repo root (or cwd if not a git repo).
 * Content: repo status, recent commits, current branch, open PR info, session context.
 * Deterministic, no LLM calls, no external API dependencies (except gh if available).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const flags = {};
for (const arg of args) {
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    if (eq >= 0) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    else flags[arg.slice(2)] = true;
  }
}

const CWD = flags.cwd || process.cwd();
const HOME = homedir();
const REGISTRY = join(HOME, 'agent-memory', 'nexus', 'session-registry.jsonl');

/**
 * Get git root directory. Returns null if not a git repo.
 */
function getGitRoot(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      timeout: 2000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim();
  } catch {
    return null;
  }
}

/**
 * Get current branch name.
 */
function getBranch(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeout: 2000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get git status --short output.
 */
function getGitStatus(cwd) {
  try {
    const out = execFileSync('git', ['status', '--short'], {
      cwd,
      timeout: 2000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim();
  } catch {
    return '';
  }
}

/**
 * Get recent commits (10 lines).
 */
function getRecentCommits(cwd) {
  try {
    const out = execFileSync('git', ['log', '--oneline', '-10'], {
      cwd,
      timeout: 2000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.toString().trim();
  } catch {
    return '';
  }
}

/**
 * Get current PR info if available (via gh pr view).
 */
function getPRInfo(cwd) {
  try {
    const out = execFileSync('gh', ['pr', 'view', '--json', 'number,title,url,state'], {
      cwd,
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const data = JSON.parse(out.toString());
    return data;
  } catch {
    return null;
  }
}

/**
 * Get repo name from path (basename).
 */
function getRepoName(path) {
  const base = path.split(/[/\\]/).pop();
  return base || 'repo';
}

/**
 * Get current session info from registry (latest session in this cwd).
 */
function getCurrentSessionInfo(cwd) {
  if (!existsSync(REGISTRY)) return null;
  try {
    const lines = readFileSync(REGISTRY, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    // Find the most recent session in this cwd
    const matching = lines.filter(e => e.cwd === cwd).sort((a, b) =>
      (b.timestamp || '').localeCompare(a.timestamp || '')
    );

    return matching[0] || null;
  } catch {
    return null;
  }
}

/**
 * Generate HANDOFF.md content.
 */
function generateContent(gitRoot, cwd) {
  const repoName = getRepoName(gitRoot || cwd);
  const branch = getBranch(gitRoot || cwd);
  const gitStatus = getGitStatus(gitRoot || cwd);
  const recentCommits = getRecentCommits(gitRoot || cwd);
  const prInfo = getPRInfo(gitRoot || cwd);
  const sessionInfo = getCurrentSessionInfo(cwd);

  const date = new Date().toISOString().slice(0, 10);
  const time = new Date().toISOString().slice(11, 16);

  let content = `# HANDOFF.md — ${repoName} Session Continuation\n\n`;
  content += `**Generated:** ${date} ${time}\n`;
  content += `**Branch:** ${branch}\n`;
  content += `**Repo:** ${repoName} (${cwd})\n\n`;
  content += `---\n\n`;

  // Session info
  if (sessionInfo) {
    content += `## Current Session\n\n`;
    content += `**Session ID:** ${sessionInfo.session}\n`;
    content += `**Title:** ${sessionInfo.title || 'pending'}\n`;
    if (sessionInfo.first_prompt) {
      content += `**First Prompt:** ${sessionInfo.first_prompt.slice(0, 150)}\n`;
    }
    content += `\n`;
  }

  // Repo status
  if (gitStatus) {
    content += `## Working Tree Status\n\n`;
    content += `\`\`\`\n${gitStatus}\n\`\`\`\n\n`;
  } else {
    content += `## Working Tree Status\n\n`;
    content += `Clean working tree.\n\n`;
  }

  // Recent commits
  if (recentCommits) {
    content += `## Recent Commits\n\n`;
    content += `\`\`\`\n${recentCommits}\n\`\`\`\n\n`;
  }

  // PR info
  if (prInfo) {
    content += `## Pull Request\n\n`;
    content += `**PR #${prInfo.number}:** ${prInfo.title}\n`;
    content += `**State:** ${prInfo.state}\n`;
    content += `**URL:** ${prInfo.url}\n\n`;
  }

  // Next steps placeholder
  content += `## Next Steps\n\n`;
  content += `<!-- Add continuation notes here -->\n`;
  content += `- [ ] \n`;

  return content;
}

/**
 * Main entry point.
 */
function main() {
  const gitRoot = getGitRoot(CWD);
  const targetDir = gitRoot || CWD;
  const handoffPath = join(targetDir, 'HANDOFF.md');

  try {
    const content = generateContent(gitRoot, CWD);
    writeFileSync(handoffPath, content, 'utf8');
    console.log(`[generate-handoff] wrote ${handoffPath}`);
  } catch (err) {
    console.error(`[generate-handoff] error: ${err.message}`);
    process.exit(1);
  }
}

main();
