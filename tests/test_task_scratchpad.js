/**
 * tests/test_task_scratchpad.js
 * node --test tests/test_task_scratchpad.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOL = join(__dirname, '..', 'tools', 'task-scratchpad.js');
const nexusDir = join(homedir(), 'agent-memory', 'nexus');
const TEST_PROJECT = 'test-scratchpad-proj';
const TEST_ISSUE = '9999';
const taskDir    = join(nexusDir, 'tasks', TEST_PROJECT, `issue-${TEST_ISSUE}`);
const scratchpad = join(taskDir, 'scratchpad.md');
const archiveDir = join(nexusDir, 'tasks', 'archive', TEST_PROJECT);

function run(argStr) {
  return execSync(`node "${TOOL}" ${argStr} --project=${TEST_PROJECT}`, {
    encoding: 'utf8',
    env: { ...process.env },
  }).trim();
}

before(() => {
  if (existsSync(taskDir)) rmSync(taskDir, { recursive: true, force: true });
});

after(() => {
  if (existsSync(taskDir)) rmSync(taskDir, { recursive: true, force: true });
  if (existsSync(archiveDir)) {
    const entries = readdirSync(archiveDir).filter(f => f.startsWith(`issue-${TEST_ISSUE}`));
    for (const e of entries) rmSync(join(archiveDir, e), { recursive: true, force: true });
  }
});

describe('task-scratchpad lifecycle', () => {
  it('--init creates scratchpad.md', () => {
    const out = run(`--init --issue=${TEST_ISSUE} --workers="Ultron,Pym"`);
    assert.ok(out.includes('Initialized'), `Expected 'Initialized' in: ${out}`);
    assert.ok(existsSync(scratchpad), 'scratchpad.md should exist');
  });

  it('--init writes header with workers and project', () => {
    const content = readFileSync(scratchpad, 'utf8');
    assert.ok(content.includes('Ultron,Pym'));
    assert.ok(content.includes(TEST_PROJECT));
    assert.ok(content.includes(`issue #${TEST_ISSUE}`));
  });

  it('--write appends entry with agent name', () => {
    run(`--write --issue=${TEST_ISSUE} --agent=Ultron --message="Found N+1 query in auth service"`);
    const content = readFileSync(scratchpad, 'utf8');
    assert.ok(content.includes('Ultron'));
    assert.ok(content.includes('Found N+1 query'));
  });

  it('multiple agent writes all appear in scratchpad', () => {
    run(`--write --issue=${TEST_ISSUE} --agent=Pym --message="Added index on users.email"`);
    run(`--write --issue=${TEST_ISSUE} --agent=Astra --message="Updated loading spinner"`);
    const content = readFileSync(scratchpad, 'utf8');
    assert.ok(content.includes('Pym'));
    assert.ok(content.includes('Added index on users.email'));
    assert.ok(content.includes('Astra'));
    assert.ok(content.includes('Updated loading spinner'));
  });

  it('--read outputs full scratchpad contents', () => {
    const out = run(`--read --issue=${TEST_ISSUE}`);
    assert.ok(out.includes('Ultron'));
    assert.ok(out.includes('Pym'));
    assert.ok(out.includes('Astra'));
  });

  it('--close moves task dir to archive', () => {
    run(`--close --issue=${TEST_ISSUE}`);
    assert.ok(!existsSync(taskDir), 'taskDir should be gone after close');
    assert.ok(existsSync(archiveDir), 'archive dir should exist');
    const entries = readdirSync(archiveDir);
    assert.ok(entries.some(e => e.startsWith(`issue-${TEST_ISSUE}`)), 'archived entry not found');
  });

  it('--write after close exits with error', () => {
    assert.throws(
      () => run(`--write --issue=${TEST_ISSUE} --agent=Ultron --message="post-close write"`),
      /Command failed/,
    );
  });
});
