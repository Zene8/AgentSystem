// sam_audit_merge_ready.test.js — the merge-ready ping must not assert what it did not check (#295).
//
// The old step posted "Sam approved. Tests passing. **Ready to merge**" from a condition that
// read Sam's own verdict and nothing else — no test check, no rollup. It was observed on PR #294
// telling a human to `/merge` while a required check was red.
//
// As with the linked-issue gate, the interesting cases are the ones where the honest answer is
// "no": a failing check, a pending check, and an unreadable rollup. A green PR proves nothing
// here — the buggy version got that case right by accident, every time.
//
// The script is extracted from the shipped workflow and compiled the way actions/github-script
// compiles it, so there is one copy of this logic and the test exercises the real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractBlockScalars } from '../tools/workflow-lint.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = join(HERE, '..', '.github', 'workflows', 'sam-audit.yml');
const workflowText = readFileSync(WORKFLOW, 'utf8');

const SELF_NAME = 'Security Audit (Sam CSO)';
const SHA = 'abcdef1234567890';

function pingScriptSource() {
  const blocks = extractBlockScalars(workflowText).filter(b => b.key === 'script');
  const match = blocks.filter(b => b.body.includes('const SELF'));
  assert.equal(match.length, 1, `expected exactly one merge-ready ping script, found ${match.length}`);
  return match[0].body;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const compiled = new AsyncFunction('github', 'context', 'core', pingScriptSource());

const run_ = (name, id, conclusion, status = 'completed') => ({ name, id, status, conclusion });

const BOT = { login: 'github-actions[bot]', type: 'Bot' };
const HUMAN = { login: 'natha', type: 'User' };

/** A comment already on the PR. `marked` means it carries the sticky marker. */
const comment_ = (id, { user = BOT, marked = true, text = 'previous ping' } = {}) => ({
  id,
  user,
  body: `${marked ? '<!-- audit-gate -->\n' : ''}${text}`,
});

/**
 * @param {object} opts
 * @param {Array} [opts.checkRuns]  check runs on the head SHA
 * @param {Array} [opts.statuses]   legacy commit statuses
 * @param {Error} [opts.throws]     make the rollup read fail
 * @param {Array} [opts.comments]   comments already on the PR (for the sticky upsert, #404)
 * @param {Error} [opts.listThrows] make the existing-comment lookup fail
 * @param {Error} [opts.patchThrows] make the update of the found comment fail
 * @param {Error} [opts.createThrows] make the terminal createComment fail
 * @param {boolean} [opts.allowNoComment] the terminal createComment is expected to fail and post
 *   nothing — skip the "exactly one comment" invariant that every other case must satisfy.
 */
async function post({
  checkRuns = [], statuses = [], throws = null,
  comments = [], listThrows = null, patchThrows = null, createThrows = null,
  allowNoComment = false,
}) {
  const warnings = [];
  const posted = [];
  const patched = [];
  const listCalls = [];
  const core = { warning: m => warnings.push(String(m)), info: () => {}, setOutput: () => {} };
  const context = {
    repo: { owner: 'Zene8', repo: 'AgentSystem' },
    payload: { pull_request: { number: 294, head: { sha: SHA } } },
  };
  const listForRef = async ({ ref }) => {
    if (throws) throw throws;
    assert.equal(ref, SHA, 'the rollup must be read for the PR head SHA, not the default branch');
    return checkRuns;
  };
  const github = {
    paginate: async (fn, params) => fn(params),
    rest: {
      checks: { listForRef },
      repos: {
        getCombinedStatusForRef: async () => {
          if (throws) throw throws;
          return { data: { statuses } };
        },
      },
      issues: {
        createComment: async (args) => {
          if (createThrows) throw createThrows;
          posted.push(args);
        },
        updateComment: async (args) => {
          if (patchThrows) throw patchThrows;
          patched.push(args);
        },
        listComments: async (params) => {
          listCalls.push(params);
          if (listThrows) throw listThrows;
          return comments;
        },
      },
    },
  };
  await compiled(github, context, core);
  if (allowNoComment) {
    return { body: undefined, warnings, args: undefined, posted, patched, listCalls };
  }
  // Exactly one comment must exist afterwards — created when there was none to reuse, PATCHed
  // onto the existing one otherwise. Two of either, or one of each, is the #404 append bug.
  assert.equal(
    posted.length + patched.length, 1,
    `exactly one comment must be created or updated (created ${posted.length}, updated ${patched.length})`
  );
  const args = posted[0] ?? patched[0];
  return { body: args.body, warnings, args, posted, patched, listCalls };
}

// "Ready to merge" as an assertion, not as a substring of "Not ready to merge".
const claimsReady = body => /\*\*Ready to merge\*\*/.test(body) && /reply `\/merge`/.test(body);

// ── The cases the old step got wrong ──────────────────────────────────────────────────────────

test('a failing check means the ping does NOT say ready to merge', async () => {
  const { body } = await post({
    checkRuns: [
      run_('PR must be linked to an issue', 2, 'failure'),
      run_('test', 3, 'success'),
    ],
  });
  assert.equal(claimsReady(body), false, 'must not invite /merge while a check is red');
  assert.match(body, /Not ready to merge/);
  assert.match(body, /PR must be linked to an issue/, 'the failing check must be named');
  assert.match(body, /Sam \(CSO\) approved/, 'the audit verdict is still reported — it is true');
});

test('a still-running check means the ping does NOT say ready to merge', async () => {
  const { body } = await post({
    checkRuns: [run_('test', 4, null, 'in_progress'), run_('workflow-lint', 5, 'success')],
  });
  assert.equal(claimsReady(body), false);
  assert.match(body, /still running/);
  assert.match(body, /`test`/);
});

test('an unreadable rollup reports only what the step knows', async () => {
  const { body, warnings } = await post({ throws: new Error('HTTP 403: rate limited') });
  assert.equal(claimsReady(body), false, 'unknown is not the same as green');
  assert.match(body, /Could not read the check rollup/);
  assert.match(body, /Sam \(CSO\) approved/);
  assert.ok(warnings.some(w => /check rollup/.test(w)), 'a degraded read must be logged');
});

test('a check cancelled on the current attempt counts as not passing', async () => {
  const { body } = await post({ checkRuns: [run_('test', 6, 'cancelled')] });
  assert.equal(claimsReady(body), false);
  assert.match(body, /`test`/);
});

test('a failing LEGACY commit status blocks the ready claim too', async () => {
  const { body } = await post({
    checkRuns: [run_('test', 7, 'success')],
    statuses: [{ context: 'ci/external', state: 'failure' }],
  });
  assert.equal(claimsReady(body), false);
  assert.match(body, /ci\/external/);
});

// ── The cases it must not get wrong in the other direction ────────────────────────────────────

test('all other checks green says ready to merge and offers /merge', async () => {
  const { body } = await post({
    checkRuns: [run_('test', 8, 'success'), run_('workflow-lint', 9, 'success')],
  });
  assert.equal(claimsReady(body), true);
  assert.match(body, /abcdef1/, 'the claim is scoped to a specific commit');
});

test("the job's own in-progress check run is excluded", async () => {
  // It is the thing posting the comment. Counting it would make every ping say a check is still
  // running — about itself — and nothing would ever read as ready.
  const { body } = await post({
    checkRuns: [run_(SELF_NAME, 10, null, 'in_progress'), run_('test', 11, 'success')],
  });
  assert.equal(claimsReady(body), true);
});

test('a superseded older attempt does not veto the newest result', async () => {
  const { body } = await post({
    checkRuns: [run_('test', 12, 'cancelled'), run_('test', 13, 'success')],
  });
  assert.equal(claimsReady(body), true);
});

test('skipped and neutral conclusions count as satisfied', async () => {
  // GitHub itself treats both as satisfying a required check (#228). Calling them failures here
  // would contradict the merge button — wrong in the opposite direction, but still wrong.
  const { body } = await post({
    checkRuns: [run_('docs-only', 14, 'skipped'), run_('advisory', 15, 'neutral')],
  });
  assert.equal(claimsReady(body), true);
});

// ── Sticky comment: one ping per PR, edited in place (#404) ───────────────────────────────────
//
// The step fires on every check-suite state change, so a bare createComment appends a fresh
// near-identical ping each time the check list settles. Measured on PR #400 (two pings, 08:25 and
// 08:33) and PR #370 (three, inside four minutes) — every one with created_at == updated_at,
// proving nothing was ever patched. The comment must be an upsert keyed on a hidden marker.

const MARKER = '<!-- audit-gate -->';

test('the marker is the first line of the body, so the next run can find this comment', async () => {
  const { body } = await post({ checkRuns: [run_('test', 20, 'success')] });
  assert.equal(body.split('\n')[0], MARKER, 'the marker must lead the body');
  // Hidden marker, not visible chrome: it must not disturb the rendered text.
  assert.match(body, /^\S*\n?✅ \*\*Sam \(CSO\) approved\*\*/m);
});

test('with no existing ping, one is created', async () => {
  const { posted, patched } = await post({ checkRuns: [run_('test', 21, 'success')] });
  assert.equal(patched.length, 0, 'nothing to update on the first run');
  assert.equal(posted[0].issue_number, 294);
});

test('an existing marked bot ping is UPDATED, never appended to', async () => {
  const { posted, patched, body } = await post({
    checkRuns: [run_('test', 22, 'success')],
    comments: [comment_(5237723639)],
  });
  assert.equal(posted.length, 0, 'a second createComment is the #404 bug');
  assert.equal(patched[0].comment_id, 5237723639, 'the existing ping must be patched by id');
  assert.equal(claimsReady(body), true, 'the patched body carries the current verdict');
});

test('the ping is looked up with pagination, not just page 1', async () => {
  // A busy PR exceeds one page. Missing the existing comment silently regresses to appending —
  // the same failure mode, and invisible, because the fallback is exactly the old behavior.
  const { listCalls } = await post({ checkRuns: [run_('test', 23, 'success')] });
  assert.equal(listCalls.length, 1, 'the comment list must be read before posting');
  assert.equal(listCalls[0].per_page, 100, 'per_page: 100 is load-bearing, not a tuning knob');
  assert.equal(listCalls[0].issue_number, 294);
  assert.match(pingScriptSource(), /github\.paginate\(github\.rest\.issues\.listComments/);
});

test('when several marked pings already exist, the OLDEST is updated and none are deleted', async () => {
  // Every PR in the #404 evidence already has 2-3 of these. Picking the newest would leave the
  // oldest as the one a reader scrolls to first; deleting is not this step's business.
  const { posted, patched } = await post({
    checkRuns: [run_('test', 24, 'success')],
    comments: [comment_(300), comment_(100), comment_(200)],
  });
  assert.equal(posted.length, 0);
  assert.equal(patched.length, 1, 'multi-match must not fan out into several PATCHes');
  assert.equal(patched[0].comment_id, 100, 'the oldest marked ping wins');
});

test("a human's comment quoting the marker is not hijacked", async () => {
  const { posted, patched } = await post({
    checkRuns: [run_('test', 25, 'success')],
    comments: [comment_(400, { user: HUMAN })],
  });
  assert.equal(patched.length, 0, 'the step must never edit a human comment');
  assert.equal(posted.length, 1);
});

test('an unmarked bot comment is left alone', async () => {
  // Other steps and workflows comment on the same PR — the review body, the linked-issue gate.
  const { posted, patched } = await post({
    checkRuns: [run_('test', 26, 'success')],
    comments: [comment_(500, { marked: false, text: 'PR must be linked to an issue' })],
  });
  assert.equal(patched.length, 0, 'only this step\'s own marked ping may be edited');
  assert.equal(posted.length, 1);
});

test('a bot comment that merely QUOTES the marker is not adopted as the ping', async () => {
  // Sam's finding on #406. The marker is matched with startsWith, not includes, because the bot
  // authors other comments here whose bodies relay diff-derived text — and any PR touching this
  // workflow, this test or the runbook carries the literal marker in its diff. The dangerous shape
  // is this step's own "audit could not run" body, which interpolates model output: it is OLDER, so
  // an includes-match plus "oldest wins" would PATCH the outage record away with a green verdict.
  const outageRecord = {
    id: 800,
    user: BOT,
    body: '⚠️ **Sam (CSO) — Audit could not run**\n\nthe diff adds `<!-- audit-gate -->` to the body',
  };
  const { posted, patched } = await post({
    checkRuns: [run_('test', 29, 'success')],
    comments: [outageRecord, comment_(900)],
  });
  assert.equal(posted.length, 0, 'the genuine ping at 900 was available to edit');
  assert.equal(
    patched[0].comment_id, 900,
    'the outage record at 800 is older and would win "oldest wins" — it must not match at all'
  );
});

test('the marker must be matched anchored, not anywhere in the body', () => {
  // Guards the fix rather than the symptom: a future edit relaxing this back to `includes`
  // reopens the whole class, and the failure is invisible (a real comment silently overwritten).
  const src = pingScriptSource();
  assert.match(src, /startsWith\(MARKER\)/, 'the marker match must be anchored to the body start');
  assert.equal(
    /includes\(MARKER\)/.test(src), false,
    'an unanchored includes(MARKER) match can adopt any bot comment quoting the marker'
  );
});

test('a failed lookup falls back to posting, and does not fail the audit', async () => {
  // This step runs AFTER an approved verdict. An exception here turns the required check
  // `Security Audit (Sam CSO)` red on a PR Sam actually passed — worse than a duplicate comment.
  const { posted, warnings } = await post({
    checkRuns: [run_('test', 27, 'success')],
    listThrows: new Error('HTTP 502: bad gateway'),
  });
  assert.equal(posted.length, 1, 'an unreadable comment list degrades to appending, not to red');
  assert.ok(warnings.some(w => /502|existing/i.test(w)), 'the degraded lookup must be logged');
});

test('a ping deleted between the lookup and the edit degrades to posting', async () => {
  // The 404 race: someone deletes the comment while the rollup is being read.
  const { posted, warnings } = await post({
    checkRuns: [run_('test', 28, 'success')],
    comments: [comment_(600)],
    patchThrows: new Error('HTTP 404: Not Found'),
  });
  assert.equal(posted.length, 1, 'a failed PATCH must still leave the verdict on the PR');
  assert.ok(warnings.some(w => /404/.test(w)));
});

test('a 403 on the update is named as a permission regression, not a generic failure', async () => {
  // The one failure mode the fail-soft design can hide: losing `pull-requests: write` degrades to
  // appending behind a still-green check. It must not read like the benign 404 race, because a
  // human has to act on it. This is the annotation that makes the blind spot visible.
  const err = Object.assign(new Error('Resource not accessible by integration'), { status: 403 });
  const { posted, warnings } = await post({
    checkRuns: [run_('test', 30, 'success')],
    comments: [comment_(1000)],
    patchThrows: err,
  });
  assert.equal(posted.length, 1, 'the verdict still reaches the PR');
  assert.ok(
    warnings.some(w => /PERMISSION REGRESSION \(403\)/.test(w)),
    `a 403 must be labelled a permission regression, got: ${JSON.stringify(warnings)}`
  );
});

test('a 404 on the update is NOT labelled a permission regression', async () => {
  const err = Object.assign(new Error('Not Found'), { status: 404 });
  const { warnings } = await post({
    checkRuns: [run_('test', 31, 'success')],
    comments: [comment_(1100)],
    patchThrows: err,
  });
  assert.ok(warnings.some(w => /deleted \(404\)/.test(w)));
  assert.equal(
    warnings.some(w => /PERMISSION REGRESSION/.test(w)), false,
    'crying permission regression on a benign race trains people to ignore the annotation'
  );
});

test('the sticky path applies to the unreadable-rollup body too', async () => {
  // The degraded body is posted from the catch block; if the upsert lived inside the try, that
  // path would keep appending forever and nobody would notice.
  const { patched, body } = await post({
    throws: new Error('HTTP 403: rate limited'),
    comments: [comment_(700)],
  });
  assert.equal(patched[0].comment_id, 700);
  assert.match(body, /Could not read the check rollup/);
  assert.equal(body.split('\n')[0], MARKER);
});

test('a throwing terminal createComment does not fail the required check', async () => {
  // The terminal createComment (no existing marked comment, or the lookup itself failed) sat
  // outside any try/catch — the one call in this step not covered by the fail-soft contract
  // above it. A throw here must warn, not propagate, or it reddens `Security Audit (Sam CSO)`
  // on a PR Sam already approved.
  const err = Object.assign(new Error('API rate limit exceeded'), { status: 403 });
  const { posted, warnings } = await post({
    checkRuns: [run_('test', 40, 'success')],
    createThrows: err,
    allowNoComment: true,
  });
  assert.equal(posted.length, 0, 'the throwing call never actually posts');
  assert.ok(
    warnings.some(w => /Could not post audit ping/.test(w)),
    `the failure must be logged, got: ${JSON.stringify(warnings)}`
  );
  assert.ok(
    warnings.some(w => /PERMISSION REGRESSION \(403\)/.test(w)),
    `a 403 on the terminal createComment must be named a permission regression, got: ${JSON.stringify(warnings)}`
  );
});

// ── Static guards ─────────────────────────────────────────────────────────────────────────────

test('the ping step has no bare createComment as its last act', () => {
  // The regression to guard: a future edit dropping the upsert and going back to a single
  // unconditional createComment at the end of the script.
  const src = pingScriptSource();
  assert.match(src, /issues\.updateComment/, 'the step must be able to PATCH an existing ping');
  assert.ok(src.includes(MARKER), 'the marker must be embedded in the workflow itself');
});

test('the marker is a hidden HTML comment, not visible text', () => {
  assert.match(MARKER, /^<!--.*-->$/);
});


test('the SELF constant matches the job name GitHub will use', () => {
  // GitHub names the check run after the job's `name:`. If they drift, the exclusion stops
  // matching and every ping reports the audit as a pending check against itself.
  assert.match(workflowText, /^\s+name:\s*Security Audit \(Sam CSO\)\s*$/m);
  assert.ok(pingScriptSource().includes(`'${SELF_NAME}'`));
});

test('the unconditional "Tests passing" claim is gone', () => {
  // Asserted as a boolean rather than with doesNotMatch(workflowText, …): a failure there dumps
  // the entire workflow into the test output and buries the one line that matters.
  assert.equal(
    /Sam approved\. Tests passing\./.test(workflowText), false,
    'sam-audit.yml still contains the fixed "Tests passing" sentence, which asserts a test ' +
    'result the step never read — see #295'
  );
});

test('the job declares the scopes the rollup read needs', () => {
  assert.match(workflowText, /^\s+checks:\s*read\s*$/m);
  assert.match(workflowText, /^\s+statuses:\s*read\s*$/m);
});
