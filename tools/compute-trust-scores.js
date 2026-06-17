import fs from 'fs';
import path from 'path';
import os from 'os';

const RUN_LOG_DIR = path.join(os.homedir(), 'agent-memory', 'nexus', 'run-log');
const OUTPUT_FILE = path.join(os.homedir(), 'agent-memory', 'nexus', 'trust-scores.md');

function classifyResult(result) {
  if (!result || typeof result !== 'string') return 'unknown';
  const trimmed = result.trim().toUpperCase();
  if (trimmed.startsWith('DONE')) return 'success';
  if (trimmed.startsWith('BLOCKED')) return 'failure';
  return 'unknown';
}

function main() {
  console.log('[trust-scores] Reading run-log from:', RUN_LOG_DIR);

  // Fail-soft: missing dir
  if (!fs.existsSync(RUN_LOG_DIR)) {
    console.log('[trust-scores] Run-log directory does not exist — writing empty report');
    writeEmpty();
    return;
  }

  const files = fs.readdirSync(RUN_LOG_DIR).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.log('[trust-scores] No run log files found — writing empty report');
    writeEmpty();
    return;
  }

  // agent -> { total, successes, failures, unknown }
  const scores = {};

  for (const file of files) {
    const filePath = path.join(RUN_LOG_DIR, file);
    let data;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      data = JSON.parse(raw);
    } catch (err) {
      console.warn('[trust-scores] Skipping malformed JSON:', file, err.message);
      continue;
    }

    const agent = (data.agent || 'unknown').toLowerCase();
    const classification = classifyResult(data.result);

    if (!scores[agent]) {
      scores[agent] = { total: 0, successes: 0, failures: 0, unknown: 0 };
    }

    scores[agent].total++;
    if (classification === 'success') scores[agent].successes++;
    else if (classification === 'failure') scores[agent].failures++;
    else scores[agent].unknown++;
  }

  const now = new Date().toISOString();
  const sortedAgents = Object.keys(scores).sort();

  let rows = '';
  for (const agent of sortedAgents) {
    const s = scores[agent];
    const rate = s.total > 0 ? Math.round((s.successes / s.total) * 100) + '%' : '0%';
    rows += `| ${agent} | ${s.total} | ${s.successes} | ${s.failures} | ${s.unknown} | ${rate} |\n`;
  }

  const md = `# Agent Trust Scores
_Last updated: ${now}_

| Agent | Total Runs | Successes | Failures | Unknown | Success Rate |
|-------|-----------|-----------|---------|---------|-------------|
${rows}`;

  // Ensure output dir exists
  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, md, 'utf8');
  console.log('[trust-scores] Written to:', OUTPUT_FILE);
  console.log('[trust-scores] Agents tracked:', sortedAgents.length, '| Total runs:', files.length);
}

function writeEmpty() {
  const now = new Date().toISOString();
  const md = `# Agent Trust Scores
_Last updated: ${now}_

No run data yet. Run logs are written to \`~/agent-memory/nexus/run-log/\` by agent-dispatch.yml.
`;
  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_FILE, md, 'utf8');
  console.log('[trust-scores] Empty report written to:', OUTPUT_FILE);
}

main();
