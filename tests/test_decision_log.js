/**
 * tests/test_decision_log.js
 * node --test tests/test_decision_log.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOL = join(__dirname, '..', 'tools', 'decision-log.js');
const nexusDir     = join(homedir(), 'agent-memory', 'nexus');
const decisionsDir = join(nexusDir, 'decisions');
const archiveDir   = join(nexusDir, 'decisions', 'archive');
const TEST_PROJECT = 'test-decision-proj';

function run(argStr) {
  return execSync(`node "${TOOL}" ${argStr} --project=${TEST_PROJECT}`, {
    encoding: 'utf8',
    env: { ...process.env },
  }).trim();
}

function testFiles() {
  if (!existsSync(decisionsDir)) return [];
  return readdirSync(decisionsDir)
    .filter(f => f.includes(TEST_PROJECT) && f.endsWith('.md'));
}

before(() => {
  if (existsSync(decisionsDir)) {
    for (const f of testFiles()) {
      try { unlinkSync(join(decisionsDir, f)); } catch {}
    }
  }
});

after(() => {
  for (const f of testFiles()) {
    try { unlinkSync(join(decisionsDir, f)); } catch {}
  }
  if (existsSync(archiveDir)) {
    const archived = readdirSync(archiveDir).filter(f => f.includes(TEST_PROJECT));
    for (const f of archived) {
      try { unlinkSync(join(archiveDir, f)); } catch {}
    }
  }
});

describe('decision-log write', () => {
  it('writes a decision file', () => {
    const out = run(`--write --title="Use Postgres" --decision="Chose Postgres over MongoDB" --rationale="Team familiarity, ACID guarantees" --agent=Friday`);
    assert.ok(out.includes('Decision written'), `Got: ${out}`);
    const files = testFiles();
    assert.strictEqual(files.length, 1, 'Should have one decision file');
  });

  it('file contains title, decision, rationale, project', () => {
    const files = testFiles();
    const content = readFileSync(join(decisionsDir, files[0]), 'utf8');
    assert.ok(content.includes('Use Postgres'));
    assert.ok(content.includes('Chose Postgres over MongoDB'));
    assert.ok(content.includes('Team familiarity'));
    assert.ok(content.includes(TEST_PROJECT));
  });

  it('file contains expiry date', () => {
    const files = testFiles();
    const content = readFileSync(join(decisionsDir, files[0]), 'utf8');
    assert.match(content, /\*\*Expires:\*\* \d{4}-\d{2}-\d{2}/);
  });
});

describe('decision-log search', () => {
  before(() => {
    run(`--write --title="Use Stripe for payments" --decision="Chose Stripe over Braintree" --rationale="Better docs, webhook reliability" --agent=Nat`);
  });

  it('returns results as JSON array', () => {
    const out = run('--search --query="Postgres database"');
    const results = JSON.parse(out);
    assert.ok(Array.isArray(results));
  });

  it('returns relevant result for matching query', () => {
    const out = run('--search --query="Postgres database"');
    const results = JSON.parse(out);
    assert.ok(results.length > 0, 'Should find at least one result');
    const topTitle = results[0].title.toLowerCase();
    const topSummary = results[0].summary.toLowerCase();
    assert.ok(topTitle.includes('postgres') || topSummary.includes('postgres'));
  });

  it('returns empty array for no-match query', () => {
    const out = run('--search --query="zqxwvutsrponmlkj"');
    const results = JSON.parse(out);
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });
});

describe('decision-log list', () => {
  it('lists decisions without crashing', () => {
    const out = run('--list');
    assert.ok(typeof out === 'string');
    // Should contain our test project slug in some form
    assert.ok(out.includes(TEST_PROJECT) || out.toLowerCase().includes('postgres'));
  });
});

describe('decision-log expire', () => {
  it('archives a decision with past expiry', () => {
    run(`--write --title="Temp decision" --decision="Will expire" --rationale="Test" --agent=Friday --expires=180`);
    const filesBefore = testFiles();
    const tempFile = filesBefore.find(f => f.includes('temp-decision'));
    assert.ok(tempFile, 'temp-decision file should exist');

    // Force expiry to past date
    const filepath = join(decisionsDir, tempFile);
    let content = readFileSync(filepath, 'utf8');
    content = content.replace(/\*\*Expires:\*\* \S+/, '**Expires:** 2020-01-01');
    writeFileSync(filepath, content, 'utf8');

    const out = run('--expire');
    assert.ok(out.includes('1 decision(s) archived') || out.includes('Archived expired decision'));

    const filesAfter = testFiles();
    assert.ok(!filesAfter.some(f => f.includes('temp-decision')), 'Expired file should be archived');
  });
});
