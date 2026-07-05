import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rotateFile, findJsonlLogs } from './rotate-logs.js';

test('rotateFile shifts numbered suffixes and moves live file to .1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-logs-'));
  const target = path.join(dir, 'session-log.jsonl');
  fs.writeFileSync(target, 'live\n');
  fs.writeFileSync(`${target}.1`, 'gen1\n');
  fs.writeFileSync(`${target}.2`, 'gen2\n');

  const actions = rotateFile(target, 5, false);

  assert.ok(!fs.existsSync(target), 'live file should have moved to .1');
  assert.equal(fs.readFileSync(`${target}.1`, 'utf8'), 'live\n');
  assert.equal(fs.readFileSync(`${target}.2`, 'utf8'), 'gen1\n');
  assert.equal(fs.readFileSync(`${target}.3`, 'utf8'), 'gen2\n');
  assert.ok(actions.length > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rotateFile deletes oldest generation beyond --keep', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-logs-'));
  const target = path.join(dir, 'x.jsonl');
  fs.writeFileSync(target, 'live\n');
  fs.writeFileSync(`${target}.1`, 'g1\n');
  fs.writeFileSync(`${target}.2`, 'g2\n');

  rotateFile(target, 2, false);

  assert.ok(!fs.existsSync(`${target}.3`), 'no .3 generation should exist when keep=2');
  assert.equal(fs.readFileSync(`${target}.1`, 'utf8'), 'live\n');
  assert.equal(fs.readFileSync(`${target}.2`, 'utf8'), 'g1\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rotateFile dry-run makes no filesystem changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-logs-'));
  const target = path.join(dir, 'y.jsonl');
  fs.writeFileSync(target, 'live\n');

  rotateFile(target, 5, true);

  assert.ok(fs.existsSync(target));
  assert.ok(!fs.existsSync(`${target}.1`));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('findJsonlLogs lists only .jsonl files in dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-logs-'));
  fs.writeFileSync(path.join(dir, 'a.jsonl'), '');
  fs.writeFileSync(path.join(dir, 'b.md'), '');
  const logs = findJsonlLogs(dir);
  assert.equal(logs.length, 1);
  assert.ok(logs[0].endsWith('a.jsonl'));
  fs.rmSync(dir, { recursive: true, force: true });
});
