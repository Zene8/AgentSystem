'use strict';
// SubagentStop (and Stop) hook — detached, non-blocking episodic write-back.
// Reads the session transcript, extracts {task, files, outcome, agent} and appends
// a SONA episodic entry so subagent work is captured in the memory bank.
// Mirrors the non-blocking detached pattern from memory-capture-hook.js — spawns
// the writer, unrefs, and exits 0 immediately. Never fails the harness.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const TOOLS = process.env.AGENT_TOOLS_ROOT ||
  path.resolve(__dirname, '..', 'tools');

// Parse transcript and extract episodic facts for SONA.
// Returns { task, files, outcome, agent } or null on any failure.
function extractEpisodicFacts(transcriptPath) {
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const messages = JSON.parse(raw);
    if (!Array.isArray(messages)) return null;

    // Find the assistant's last DONE/BLOCKED status line (output protocol).
    let outcome = 'unknown';
    let task = 'subagent task';
    let agent = 'unknown';
    const touchedFiles = new Set();

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || !msg.content) continue;

      const contentArr = Array.isArray(msg.content) ? msg.content : [msg.content];
      for (const block of contentArr) {
        const text = typeof block === 'string' ? block :
          (block && block.type === 'text' ? block.text : '');
        if (!text) continue;

        // Extract DONE/BLOCKED from output protocol (first match wins, scanning backwards).
        if (!outcome || outcome === 'unknown') {
          if (/^DONE:/m.test(text)) {
            outcome = 'done';
            const m = text.match(/^DONE:\s*(.+)$/m);
            if (m) task = m[1].trim().slice(0, 120);
          } else if (/^BLOCKED:/m.test(text)) {
            outcome = 'blocked';
            const m = text.match(/^BLOCKED:\s*(.+)$/m);
            if (m) task = m[1].trim().slice(0, 120);
          }
        }
      }

      // Look for agent name in tool_use (subagent invocations).
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && block.type === 'tool_result') continue;
          if (block && block.type === 'tool_use' && block.name === 'agent') {
            agent = (block.input && block.input.agent) || agent;
          }
        }
      }
    }

    // Collect file paths from tool uses (Edit/Write/Read calls).
    for (const msg of messages) {
      if (!msg || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (!block || block.type !== 'tool_use') continue;
        const filePath = block.input && (block.input.file_path || block.input.path);
        if (filePath && typeof filePath === 'string') {
          // Keep only short relative-ish paths for the SONA entry.
          const parts = filePath.replace(/\\/g, '/').split('/');
          const rel = parts.slice(-3).join('/');
          touchedFiles.add(rel);
        }
      }
    }

    return {
      task,
      files: [...touchedFiles].slice(0, 10).join(', ') || 'none',
      outcome,
      agent,
    };
  } catch {
    return null;
  }
}

// Write an episodic node directly to sona-patterns.md (no CLI arg constraints).
function writeEpisodicNode(facts, transcriptPath) {
  const writerScript = path.join(TOOLS, 'sona-episodic-write.js');
  const args = [
    writerScript,
    `--task=${facts.task}`,
    `--files=${facts.files}`,
    `--outcome=${facts.outcome}`,
    `--agent=${facts.agent}`,
  ];

  try {
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // spawn failure is non-fatal.
  }
}

if (require.main === module) {
  let transcriptPath = null;

  try {
    const raw = fs.readFileSync(0, 'utf8');
    const payload = JSON.parse(raw);
    transcriptPath = payload.transcript_path || null;
  } catch {
    process.stdout.write('OK');
    process.exit(0);
  }

  if (!transcriptPath) {
    process.stdout.write('OK');
    process.exit(0);
  }

  try {
    const facts = extractEpisodicFacts(transcriptPath);
    if (facts) {
      writeEpisodicNode(facts, transcriptPath);
    }
  } catch {
    // Non-fatal — never block session end.
  }

  process.stdout.write('OK');
}
