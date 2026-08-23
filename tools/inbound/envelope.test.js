// Tests for tools/inbound/envelope.js — pure, no I/O, no network.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCES,
  BODY_MAX_CHARS,
  truncateBody,
  normalizeEnvelope,
  redactForRecord,
} from './envelope.js';

function valid(overrides = {}) {
  return {
    source: 'github',
    externalId: 'notification-12345',
    ts: '2026-08-22T10:00:00Z',
    actor: 'Zene8/AgentSystem',
    subject: 'CI failed on main',
    body: 'sam-audit.yml failed',
    url: 'https://github.com/Zene8/AgentSystem/actions/runs/1',
    ...overrides,
  };
}

test('SOURCES is the four v1 sources; calendar is output-only and absent', () => {
  assert.deepEqual(SOURCES, ['gmail', 'beeper', 'github', 'notion']);
  assert.ok(!SOURCES.includes('calendar'));
});

test('truncateBody leaves short text alone', () => {
  assert.equal(truncateBody('hello'), 'hello');
  assert.equal(truncateBody(''), '');
});

test('truncateBody marks truncation and never exceeds the cap', () => {
  const long = 'x'.repeat(BODY_MAX_CHARS + 500);
  const cut = truncateBody(long);
  assert.ok(cut.length <= BODY_MAX_CHARS);
  assert.ok(cut.endsWith('[truncated]'));
});

test('truncateBody coerces null/undefined to empty rather than "null"', () => {
  assert.equal(truncateBody(null), '');
  assert.equal(truncateBody(undefined), '');
});

test('normalizeEnvelope returns exactly the envelope fields, ts as ISO', () => {
  const env = normalizeEnvelope(valid());
  assert.deepEqual(Object.keys(env).sort(),
    ['actor', 'body', 'externalId', 'source', 'subject', 'ts', 'url']);
  assert.equal(env.ts, '2026-08-22T10:00:00.000Z');
});

test('normalizeEnvelope treats a missing body as empty, not an error', () => {
  const env = normalizeEnvelope(valid({ body: undefined }));
  assert.equal(env.body, '');
});

test('normalizeEnvelope truncates an oversized body as a backstop', () => {
  const env = normalizeEnvelope(valid({ body: 'y'.repeat(BODY_MAX_CHARS * 2) }));
  assert.ok(env.body.length <= BODY_MAX_CHARS);
  assert.ok(env.body.endsWith('[truncated]'));
});

test('normalizeEnvelope rejects non-objects', () => {
  for (const bad of [null, undefined, 'string', 42, ['a']]) {
    assert.throws(() => normalizeEnvelope(bad), /must be an object/);
  }
});

test('normalizeEnvelope names the missing field', () => {
  for (const field of ['source', 'externalId', 'ts', 'actor', 'subject', 'url']) {
    const raw = valid();
    delete raw[field];
    assert.throws(() => normalizeEnvelope(raw), new RegExp(`envelope\\.${field}`));
  }
});

test('normalizeEnvelope rejects a whitespace-only required field', () => {
  assert.throws(() => normalizeEnvelope(valid({ subject: '   ' })), /envelope\.subject/);
});

test('normalizeEnvelope rejects an unknown source', () => {
  assert.throws(() => normalizeEnvelope(valid({ source: 'slack' })), /is not one of/);
});

test('normalizeEnvelope rejects an externalId with whitespace — it is the dedupe key', () => {
  assert.throws(() => normalizeEnvelope(valid({ externalId: 'id 123' })), /whitespace/);
});

test('normalizeEnvelope rejects an unparseable ts', () => {
  assert.throws(() => normalizeEnvelope(valid({ ts: 'last tuesday' })), /parseable date/);
});

test('normalizeEnvelope rejects a non-string body', () => {
  assert.throws(() => normalizeEnvelope(valid({ body: { text: 'hi' } })), /body must be a string/);
});

test('redactForRecord omits subject and body — done.jsonl reaches every host', () => {
  const env = normalizeEnvelope(valid());
  const rec = redactForRecord(env, { verdict: 'action', why: 'ci failure on main' });
  assert.equal(rec.subject, undefined);
  assert.equal(rec.body, undefined);
  assert.deepEqual(Object.keys(rec).sort(),
    ['actor', 'externalId', 'source', 'ts', 'url', 'verdict', 'why']);
  assert.equal(rec.verdict, 'action');
});

test('redactForRecord keeps url as the click-through to the source of truth', () => {
  const env = normalizeEnvelope(valid());
  assert.equal(redactForRecord(env).url, env.url);
});
