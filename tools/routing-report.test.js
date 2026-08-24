import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { joinRecords, computeStats, formatReport, checkRoutingLog, loadRecords } from './routing-report.js';

function tmpLog(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'routing-report-test-'));
  const p = join(dir, 'routing-log.jsonl');
  if (contents !== undefined) writeFileSync(p, contents, 'utf8');
  return p;
}

test('joinRecords: pairs hint and actual records by shared promptHash', () => {
  const records = [
    { ts: 't1', promptHash: 'abc123', hint: 'infra', agentHint: 'Friday' },
    { ts: 't2', promptHash: 'abc123', agent: 'Friday' },
    { ts: 't3', promptHash: 'zzz999', hint: 'security', agentHint: 'Sam' },
  ];
  const joined = joinRecords(records);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].promptHash, 'abc123');
  assert.equal(joined[0].hint, 'infra');
  assert.equal(joined[0].agentActual, 'Friday');
});

test('joinRecords: unmatched hint (no actual-agent record yet) is dropped', () => {
  const records = [{ ts: 't1', promptHash: 'onlyhint', hint: 'infra', agentHint: 'Friday' }];
  assert.equal(joinRecords(records).length, 0);
});

test('joinRecords: skips malformed records missing promptHash', () => {
  const records = [{ ts: 't1', hint: 'infra' }, null, {}];
  assert.equal(joinRecords(records).length, 0);
});

test('computeStats: hit when agentHint matches agentActual (case-insensitive)', () => {
  const joined = [{ promptHash: 'h1', hint: 'infra', agentHint: 'Friday', agentActual: 'friday' }];
  const { branches, misroutes } = computeStats(joined);
  assert.equal(branches.get('infra').total, 1);
  assert.equal(branches.get('infra').hit, 1);
  assert.equal(misroutes.size, 0);
});

test('computeStats: miss when agentHint differs from agentActual, recorded as misroute', () => {
  const joined = [{ promptHash: 'h1', hint: 'infra', agentHint: 'Leo', agentActual: 'Friday' }];
  const { branches, misroutes } = computeStats(joined);
  assert.equal(branches.get('infra').total, 1);
  assert.equal(branches.get('infra').hit, 0);
  assert.equal(misroutes.get('Leo -> Friday'), 1);
});

test('computeStats: hint === "none" records excluded from branch scoring', () => {
  const joined = [{ promptHash: 'h1', hint: 'none', agentHint: null, agentActual: 'Friday' }];
  const { branches } = computeStats(joined);
  assert.equal(branches.size, 0);
});

test('computeStats: aggregates multiple records per branch', () => {
  const joined = [
    { promptHash: 'h1', hint: 'infra', agentHint: 'Friday', agentActual: 'Friday' },
    { promptHash: 'h2', hint: 'infra', agentHint: 'Friday', agentActual: 'Leo' },
  ];
  const { branches } = computeStats(joined);
  assert.equal(branches.get('infra').total, 2);
  assert.equal(branches.get('infra').hit, 1);
});

test('formatReport: reports "no joined records" message when branches empty', () => {
  const report = formatReport(new Map(), new Map());
  assert.match(report, /No joined hint\/actual records yet/);
});

test('formatReport: renders per-branch hit rate and misroute lines', () => {
  const branches = new Map([['infra', { total: 4, hit: 3 }]]);
  const misroutes = new Map([['Leo -> Friday', 1]]);
  const report = formatReport(branches, misroutes);
  assert.match(report, /infra\s+3\/4 \(75\.0%\)/);
  assert.match(report, /Leo -> Friday: 1/);
});

// #351: --check must tell a quiet week (no input) apart from blind telemetry (input present,
// yields nothing) — only the latter is a real drift-check failure.
test('checkRoutingLog: missing file is NOT blind (quiet week, not a failure)', () => {
  const result = checkRoutingLog('/nonexistent/routing-log.jsonl');
  assert.equal(result.blind, false);
});

test('checkRoutingLog: empty file is NOT blind (quiet week, not a failure)', () => {
  const p = tmpLog('');
  assert.equal(checkRoutingLog(p).blind, false);
});

test('checkRoutingLog: file with only malformed lines IS blind', () => {
  const p = tmpLog('not json\nalso not json\n');
  const result = checkRoutingLog(p);
  assert.equal(result.blind, true);
  assert.match(result.reason, /0 parsed as valid JSON/);
});

// #351 real regression: both sides populated (hints AND actuals present, well above the sample
// floor) but minted with different promptHashes for the same turn, so nothing ever joins.
// #480: the actuals here are hashSource: 'pointer' — reliable, post-#473 data — so this stays a
// genuine, actionable regression under the new predicate; see the un-tagged variant below for
// the legacy/self-healing case this same shape used to conflate it with.
test('checkRoutingLog: both sides populated, zero overlap (#351 audit case) ARE blind', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push({ ts: `h${i}`, promptHash: `hint${i}`, hint: 'infra', agentHint: 'Friday' });
  }
  for (let i = 0; i < 10; i++) {
    // disjoint hashes — never joins; hashSource: 'pointer' marks these as reliable, not legacy.
    rows.push({ ts: `a${i}`, promptHash: `actual${i}`, agent: 'Leo', hashSource: 'pointer' });
  }
  const p = tmpLog(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const result = checkRoutingLog(p);
  assert.equal(result.blind, true);
  assert.match(result.reason, /0 hint\/actual pairs share a promptHash/);
  assert.equal(result.notice, null);
});

// #480: same disjoint shape as above, but the actuals are untagged/legacy (hashSource !==
// 'pointer', as every actual record written before commit 63ad978 is). These can never join
// under the new pointer-hash mechanism by construction — that's expected, self-healing, and
// must NOT be reported as blind/drift, unlike the pointer-tagged case above.
test('checkRoutingLog: hints + legacy-only actuals, zero overlap, IS green-with-notice, NOT blind (#480)', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push({ ts: `h${i}`, promptHash: `hint${i}`, hint: 'infra', agentHint: 'Friday' });
  }
  for (let i = 0; i < 10; i++) {
    rows.push({ ts: `a${i}`, promptHash: `actual${i}`, agent: 'Leo' }); // no hashSource — legacy
  }
  const p = tmpLog(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const result = checkRoutingLog(p);
  assert.equal(result.blind, false);
  assert.equal(result.reason, null);
  assert.match(result.notice, /0 are hashSource:'pointer'/);
  assert.match(result.notice, /predates the #473 pointer-hash fix/);
  assert.match(result.notice, /self-heals as pointer-tagged actuals accumulate/);
});

// #480: a legacy (untagged) actual record must still be allowed to join if it happens to share a
// promptHash with a hint — hashSource only affects the blind/notice determination, never the join
// itself — and the resulting pair must still show up in stats. The overall verdict is
// green-with-notice (not plain green), because pointer-tagged actuals still don't exist.
test('checkRoutingLog: legacy actual that happens to match still joins and is not blind (#480)', () => {
  const rows = [
    { ts: 't1', promptHash: 'h1', hint: 'infra', agentHint: 'Friday' },
    { ts: 't2', promptHash: 'h1', agent: 'Friday' }, // legacy, but matches by coincidence
  ];
  for (let i = 2; i < 16; i++) {
    rows.push({ ts: `h${i}`, promptHash: `hint${i}`, hint: 'infra', agentHint: 'Friday' });
  }
  const p = tmpLog(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const result = checkRoutingLog(p);
  assert.equal(result.blind, false);
  assert.equal(result.joinedRecords, 1, 'legacy actual still joins its matching hint');
  assert.match(result.notice, /0 are hashSource:'pointer'/);

  // computeStats/formatReport must also see the joined pair, not silently drop it.
  const joined = joinRecords(loadRecords(p));
  assert.equal(joined.length, 1);
  const { branches } = computeStats(joined);
  assert.equal(branches.get('infra').total, 1);
  assert.equal(branches.get('infra').hit, 1);
});

// #480: pointer-tagged actuals present but the log has NOT yet accumulated a joining pair — a
// genuinely healthy, un-ambiguous "not yet enough data" case, distinct from the regression above
// only by record volume, kept here for completeness of the state matrix.
test('checkRoutingLog: pointer-tagged actual joins its hint — plain green, no notice (#480)', () => {
  const rows = [
    { ts: 't1', promptHash: 'h1', hint: 'infra', agentHint: 'Friday' },
    { ts: 't2', promptHash: 'h1', agent: 'Friday', hashSource: 'pointer' },
  ];
  const p = tmpLog(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const result = checkRoutingLog(p);
  assert.equal(result.blind, false);
  assert.equal(result.notice, null);
  assert.equal(result.joinedRecords, 1);
});

// #466: a headless CI host (e.g. baselyserver) logs hints via memory-router.js but never runs an
// interactive session, so sona-writeback-hook.js never writes an actual-agent record. Actuals is
// permanently empty — that's not the #351 minting-mismatch failure, there's nothing to join.
test('checkRoutingLog: hints only, no actuals (headless host, #466) is NOT blind', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ ts: `h${i}`, promptHash: `hint${i}`, hint: 'infra', agentHint: 'Friday' });
  }
  const p = tmpLog(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const result = checkRoutingLog(p);
  assert.equal(result.blind, false);
  assert.match(result.reason, /headless host, not drift/);
});

// #466: below the sample floor, a zero-join result is inconclusive either way — too few records
// to tell "empty by construction" apart from a real minting mismatch.
test('checkRoutingLog: below sample floor with zero join is NOT blind', () => {
  const rows = [
    { ts: 't1', promptHash: 'h1', hint: 'infra', agentHint: 'Friday' },
    { ts: 't2', promptHash: 'h2', agent: 'Leo' }, // different hash, but only 2 records total
  ];
  const p = tmpLog(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const result = checkRoutingLog(p);
  assert.equal(result.blind, false);
  assert.match(result.reason, /below the .*-record floor/);
});

test('checkRoutingLog: at least one joined pair is NOT blind', () => {
  const rows = [
    { ts: 't1', promptHash: 'h1', hint: 'infra', agentHint: 'Friday' },
    { ts: 't2', promptHash: 'h1', agent: 'Friday' },
  ];
  const p = tmpLog(rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  const result = checkRoutingLog(p);
  assert.equal(result.blind, false);
  assert.equal(result.joinedRecords, 1);
});

// #466 audit: joinRecords() classifies with `hint` winning over `agent` (else-if), so a record
// carrying BOTH fields is filed under hints alone and can never produce a pair. If the side
// counts used independent hasOwnProperty checks they would report both sides populated, and a
// log made only of such records would be declared drift no operator could act on.
test('checkRoutingLog: records carrying BOTH hint and agent are one-sided, not drift (#466)', () => {
  const rows = [];
  for (let k = 0; k < 20; k += 1) {
    rows.push(JSON.stringify({ promptHash: `h${k}`, hint: 'Friday', agent: 'Friday' }));
  }
  const r = checkRoutingLog(tmpLog(rows.join('\n') + '\n'));
  assert.equal(r.joinedRecords, 0, 'join is empty: hint wins, so nothing lands on the actual side');
  assert.equal(r.blind, false, 'one-sided by construction, so not reportable as drift');
  assert.match(r.reason, /only one side of the join is populated \(20 hint, 0 actual\)/);
});
