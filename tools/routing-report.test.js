import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinRecords, computeStats, formatReport } from './routing-report.js';

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
