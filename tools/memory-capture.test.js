import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCapturePrompt, parseCaptureFacts, captureFromTranscript } from './memory-capture.js';

// --- Pure unit tests ---

test('buildCapturePrompt includes transcript text', () => {
  const p = buildCapturePrompt('User said: I prefer dark mode');
  assert.match(p, /I prefer dark mode/);
  assert.match(p, /NONE/);
  assert.match(p, /durable/);
});

test('buildCapturePrompt truncates transcript at 8000 chars', () => {
  const long = 'x'.repeat(10000);
  const p = buildCapturePrompt(long);
  assert.ok(p.length < 10000 + 500);
  assert.ok(!p.includes('x'.repeat(8001)));
});

test('parseCaptureFacts extracts bullet lines only', () => {
  const out = parseCaptureFacts('- prefers dark mode\n- uses vim\nnot a bullet\n');
  assert.deepStrictEqual(out, ['prefers dark mode', 'uses vim']);
});

test('parseCaptureFacts returns empty for NONE', () => {
  assert.deepStrictEqual(parseCaptureFacts('NONE'), []);
  assert.deepStrictEqual(parseCaptureFacts('none'), []);
});

test('parseCaptureFacts returns empty for blank input', () => {
  assert.deepStrictEqual(parseCaptureFacts(''), []);
  assert.deepStrictEqual(parseCaptureFacts('   '), []);
});

test('parseCaptureFacts caps at 5 facts', () => {
  const input = Array.from({ length: 8 }, (_, i) => `- fact ${i}`).join('\n');
  assert.strictEqual(parseCaptureFacts(input).length, 5);
});

test('parseCaptureFacts handles asterisk bullets', () => {
  const out = parseCaptureFacts('* uses TypeScript\n* prefers TDD');
  assert.deepStrictEqual(out, ['uses TypeScript', 'prefers TDD']);
});

test('captureFromTranscript returns ok:false for missing transcript', () => {
  const r = captureFromTranscript('/nonexistent/path/transcript.txt');
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /not found/);
});

test('captureFromTranscript returns ok:false and writes nothing on LLM failure', () => {
  const tmpDir = join(tmpdir(), `mc-test-lf-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const txPath = join(tmpDir, 'transcript.txt');
  writeFileSync(txPath, 'some content', 'utf8');
  try {
    const r = captureFromTranscript(txPath, { llm: () => { throw new Error('llm down'); } });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /llm failed/);
    assert.deepStrictEqual(r.written, []);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- Acceptance test: end-to-end with fixture brain root ---
// Uses AGENT_MEMORY_ROOT to redirect all writes to a temp dir.
// Stubs ONLY the extraction LLM; reconcile uses pure Jaccard (target section is empty
// so detectAction hits the !existingFacts.length -> ADD shortcut with no LLM needed).

test('acceptance: captured fact lands in user-brain.md via remember()', () => {
  const tmpRoot = join(tmpdir(), `mc-accept-${Date.now()}`);
  const brainDir = join(tmpRoot, 'nexus', 'personal-brain');
  const nodesDir = join(brainDir, 'nodes');
  const brainPath = join(brainDir, 'user-brain.md');
  mkdirSync(nodesDir, { recursive: true });

  const transcript = `
User: I always prefer TypeScript over JavaScript for new projects.
Assistant: Understood, I'll use TypeScript.
User: Also, run tests before any PR.
`;
  const txPath = join(tmpRoot, 'session.txt');
  writeFileSync(txPath, transcript, 'utf8');

  // Minimal user-brain.md with no "Capture Test" section — so reconcile never calls LLM.
  writeFileSync(brainPath, '# Brain\n\n## Who I Am\n\n- Solo founder\n', 'utf8');
  // Minimal graph.json so splitPersonalBrain doesn't crash.
  writeFileSync(join(brainDir, 'graph.json'),
    JSON.stringify({ version: '1.0', brain: 'agent', project_slug: 'personal-brain', nodes: [], edges: [] }),
    'utf8');

  // Stub LLM: returns the one clear preference from the transcript.
  const stubLlm = () => '- prefers TypeScript over JavaScript for new projects';

  const prevRoot = process.env.AGENT_MEMORY_ROOT;
  process.env.AGENT_MEMORY_ROOT = tmpRoot;
  try {
    const r = captureFromTranscript(txPath, { llm: stubLlm, section: 'Capture Test' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.extracted, 1);
    assert.strictEqual(r.written.length, 1);

    const brainContent = readFileSync(brainPath, 'utf8');
    assert.match(brainContent, /prefers TypeScript over JavaScript for new projects/);
    assert.match(brainContent, /## Capture Test/);
  } finally {
    process.env.AGENT_MEMORY_ROOT = prevRoot !== undefined ? prevRoot : '';
    if (prevRoot === undefined) delete process.env.AGENT_MEMORY_ROOT;
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
