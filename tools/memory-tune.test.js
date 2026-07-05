import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateVisits,
  tuneImportance,
  planSonaCompaction,
  summarizeArchive,
  extractAvoidFacts,
} from './memory-tune.js';

const DAY = 24 * 60 * 60 * 1000;

test('aggregateVisits: counts accesses per node, tracks last-visited', () => {
  const lines = [
    JSON.stringify({ ts: '2026-07-01T00:00:00.000Z', nodes: ['a', 'b'] }),
    JSON.stringify({ ts: '2026-07-02T00:00:00.000Z', nodes: ['a'] }),
    '',
    'not-json',
  ];
  const stats = aggregateVisits(lines);
  assert.equal(stats.get('a').count, 2);
  assert.equal(stats.get('a').lastVisited, '2026-07-02T00:00:00.000Z');
  assert.equal(stats.get('b').count, 1);
  assert.equal(stats.has('c'), false);
});

test('aggregateVisits: ignores malformed records', () => {
  const stats = aggregateVisits([JSON.stringify({ nodes: ['x'] }), JSON.stringify({ ts: 'x' })]);
  assert.equal(stats.size, 0);
});

test('tuneImportance: accessed node gets boosted, bounded at max', () => {
  const boosted = tuneImportance(0.5, { count: 3, lastVisited: new Date().toISOString() });
  assert.ok(boosted > 0.5);
  const capped = tuneImportance(0.99, { count: 20, lastVisited: new Date().toISOString() });
  assert.ok(capped <= 1.0);
});

test('tuneImportance: never-accessed high-importance node decays toward baseline', () => {
  const now = 1_000_000_000_000;
  const decayed = tuneImportance(0.9, undefined, now);
  assert.ok(decayed < 0.9);
  assert.ok(decayed >= 0.5);
});

test('tuneImportance: stale-but-below-baseline node unchanged', () => {
  const now = 1_000_000_000_000;
  const unchanged = tuneImportance(0.3, undefined, now);
  assert.equal(unchanged, 0.3);
});

test('tuneImportance: recently accessed node (below stale threshold) not decayed', () => {
  const now = 1_000_000_000_000;
  const recent = new Date(now - 2 * DAY).toISOString();
  const val = tuneImportance(0.9, { count: 0, lastVisited: recent }, now);
  assert.equal(val, 0.9);
});

function mkEntry(id, date, agent, text) {
  const raw = `### ${id} — ${date} — ${agent}\n${text}\n`;
  return { id, date, agent, text: `${id} — ${date} — ${agent}\n${text}`, raw };
}

test('planSonaCompaction: keeps recent entries, archives old ones beyond cutoff', () => {
  const now = Date.now();
  const oldDate = new Date(now - 40 * DAY).toISOString().slice(0, 10);
  const newDate = new Date(now - 1 * DAY).toISOString().slice(0, 10);
  const entries = [
    mkEntry('[episodic]', oldDate, 'Friday', '**A:** did x | success: yes'),
    mkEntry('[episodic]', newDate, 'Friday', '**A:** did y | success: yes'),
  ];
  const { keep, archive } = planSonaCompaction(entries, now);
  assert.equal(keep.length, 1);
  assert.equal(archive.length, 1);
  assert.equal(archive[0].date, oldDate);
});

test('planSonaCompaction: enforces entry-count cap even for recent entries', () => {
  const now = Date.now();
  const entries = [];
  for (let i = 0; i < 5; i++) {
    entries.push(mkEntry('[episodic]', new Date(now - i * DAY).toISOString().slice(0, 10), 'Friday', `**A:** did ${i} | success: yes`));
  }
  const { keep, archive } = planSonaCompaction(entries, now, { maxEntries: 3, maxBytes: 1e9, archiveAgeDays: 9999 });
  assert.equal(keep.length, 3);
  assert.equal(archive.length, 2);
});

test('summarizeArchive: clusters by tag, computes success rate', () => {
  const entries = [
    mkEntry('[episodic]', '2026-01-01', 'Friday', '**A:** x | success: yes'),
    mkEntry('[episodic]', '2026-01-02', 'Friday', '**A:** x | success: no'),
  ];
  const summary = summarizeArchive(entries);
  assert.equal(summary.length, 1);
  assert.equal(summary[0].key, 'episodic');
  assert.equal(summary[0].total, 2);
  assert.equal(summary[0].successRate, 0.5);
});

test('extractAvoidFacts: only pulls success:no entries with an agent', () => {
  const entries = [
    mkEntry('[episodic]', '2026-01-01', 'Friday', '**A:** worked fine | success: yes'),
    mkEntry('[episodic]', '2026-01-02', 'Ultron', '**A:** wrong approach used | success: no'),
  ];
  const facts = extractAvoidFacts(entries);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].agent, 'Ultron');
  assert.match(facts[0].fact, /^Avoid: wrong approach used/);
});
