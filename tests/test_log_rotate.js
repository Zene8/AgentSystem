/**
 * tests/test_log_rotate.js
 * node --test tests/test_log_rotate.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, utimesSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveJsonl, pruneArchive, truncateLog } from '../tools/log-rotate.js';

let dir;

before(() => { dir = mkdtempSync(join(tmpdir(), 'log-rotate-test-')); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

describe('archiveJsonl', () => {
  it('leaves small files untouched', () => {
    const fp = join(dir, 'small.jsonl');
    writeFileSync(fp, 'x'.repeat(10));
    const result = archiveJsonl(fp, 1000);
    assert.equal(result, null);
    assert.equal(readFileSync(fp, 'utf8'), 'x'.repeat(10));
  });

  it('archives oversized files and leaves an empty live file', () => {
    const fp = join(dir, 'big.jsonl');
    writeFileSync(fp, 'y'.repeat(2000));
    const archivePath = archiveJsonl(fp, 1000);
    assert.ok(archivePath && existsSync(archivePath));
    assert.equal(readFileSync(archivePath, 'utf8'), 'y'.repeat(2000));
    assert.equal(readFileSync(fp, 'utf8'), '');
  });

  it('dry-run makes no changes', () => {
    const fp = join(dir, 'dryrun.jsonl');
    writeFileSync(fp, 'z'.repeat(2000));
    const archivePath = archiveJsonl(fp, 1000, { dryRun: true });
    assert.ok(archivePath);
    assert.equal(existsSync(archivePath), false);
    assert.equal(readFileSync(fp, 'utf8'), 'z'.repeat(2000));
  });
});

describe('pruneArchive', () => {
  it('deletes only files older than keepDays', () => {
    const archiveDir = join(dir, 'archive2');
    mkdirSync(archiveDir, { recursive: true });
    const oldFp = join(archiveDir, 'old.jsonl');
    const newFp = join(archiveDir, 'new.jsonl');
    writeFileSync(oldFp, 'old');
    writeFileSync(newFp, 'new');
    const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    utimesSync(oldFp, oldTime, oldTime);

    const deleted = pruneArchive(archiveDir, 30);
    assert.deepEqual(deleted, [oldFp]);
    assert.equal(existsSync(oldFp), false);
    assert.equal(existsSync(newFp), true);
  });
});

describe('truncateLog', () => {
  it('leaves small files untouched', () => {
    const fp = join(dir, 'small.log');
    writeFileSync(fp, 'a'.repeat(10));
    const changed = truncateLog(fp, 1000, 500);
    assert.equal(changed, false);
    assert.equal(statSync(fp).size, 10);
  });

  it('truncates oversized files to keep only the tail', () => {
    const fp = join(dir, 'big.log');
    const content = 'HEAD'.repeat(100) + 'TAIL_MARKER';
    writeFileSync(fp, content);
    const changed = truncateLog(fp, 10, 20);
    assert.equal(changed, true);
    const result = readFileSync(fp, 'utf8');
    assert.equal(result.length, 20);
    assert.ok(result.endsWith('TAIL_MARKER'));
  });
});
