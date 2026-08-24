// Workflow defects of the shape that costs real runs: the workflow is syntactically valid, goes
// green, and does nothing.
//
//   1. ci-failure-notify.yml said `workflow_run.workflows: [test.yml]`. That key matches a
//      workflow's `name:`, not its filename, so it matched nothing and the notifier never fired
//      once. Nothing failed — there was simply never a run.
//   2. scheduled-tasks.yml's daily-triage held `issues: write` alone, so the job committed and
//      tested two branches, could push neither, and reported success (#243).
//
// Per-job GITHUB_TOKEN scopes are covered by tests/workflow_permissions.test.js, which checks each
// job against the specific writes it makes rather than checking the file has a block at all.
//
// Regex rather than a YAML parser on purpose: tools/** and tests/** take no npm deps (CLAUDE.md),
// and both defects live in single lines that a regex reads exactly as well.

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WF_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');
const files = fs.readdirSync(WF_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
const read = (f) => fs.readFileSync(path.join(WF_DIR, f), 'utf8');

test('workflow_run.workflows entries match a real workflow name, not a filename', () => {
  const names = new Set(
    files
      .map((f) => read(f).match(/^name:\s*(.+?)\s*$/m))
      .filter(Boolean)
      .map((m) => m[1].replace(/^['"]|['"]$/g, ''))
  );
  assert.ok(names.size > 0, 'no workflow declared a name: — the parse is wrong, not the workflows');

  for (const f of files) {
    // `workflows: [A, B]` — the inline form this repo uses.
    for (const m of read(f).matchAll(/^\s*workflows:\s*\[([^\]]*)\]/gm)) {
      for (const raw of m[1].split(',')) {
        const ref = raw.trim().replace(/^['"]|['"]$/g, '');
        if (!ref) continue;
        assert.ok(
          !/\.ya?ml$/i.test(ref),
          `${f}: workflow_run.workflows: [${ref}] is a FILENAME. This key matches a workflow's ` +
            `name:, so it silently matches nothing and the workflow never triggers.`
        );
        assert.ok(
          names.has(ref),
          `${f}: workflow_run.workflows: [${ref}] matches no workflow name:. ` +
            `Known names: ${[...names].sort().join(', ')}`
        );
      }
    }
  }
});

test('runner health check ignores abandoned queued runs, so its alert can clear', () => {
  // A third defect of the same shape: the check ran, went green, and could never stop alerting.
  // Indirect detection counted any run queued >10min as proof the runner is offline. GitHub can
  // leave a run permanently `queued` with nothing to cancel — the 2026-08-06 outage stranded three
  // on a branch merged and deleted the same day — so the check reported `state=down` against an
  // online idle runner, the tracking issue could never auto-close, and every daily run commented
  // on it again. The window needs an upper bound: only a recently queued run says anything about
  // the runner now.
  const src = read('runner-health-check.yml');
  const select = src.match(/select\(\s*\.created_at\s*<\s*\$cutoff[^)]*\)/);
  assert.ok(select, 'runner-health-check.yml no longer filters queued runs by created_at — parse is stale');
  assert.match(
    select[0],
    /\.created_at\s*>\s*\$\w+/,
    'runner-health-check.yml counts queued runs with no upper age bound. A run GitHub left queued ' +
      'days ago on a deleted branch then pins state=down forever and the runner:down issue can ' +
      'never auto-close.'
  );
  assert.match(
    src,
    /--arg\s+\w+\s+"\$\(date -u -d '-\d+ hours?' \+%Y-%m-%dT%H:%M:%SZ\)"/,
    'the upper bound must come from a jq --arg holding a real timestamp, or the select above ' +
      'compares against an undefined variable and silently matches nothing.'
  );
});

test('sam-audit reports an audit that could not run as an error, not a security block', () => {
  // Fourth defect of the same shape, and the most expensive: the verdict had exactly two states.
  //
  //   if grep -q '^APPROVED:' "$RESULT"; then status=approved; else status=blocked; fi
  //
  // With `continue-on-error: true` on the claude step, EVERY non-approval path — nonzero exit,
  // spend limit, network error, empty result file, model refusal — landed on `blocked`, and
  // whatever text happened to be in $RESULT got posted as Sam's security finding. On 2026-08-09
  // PRs #327 and #328 both carried a 🚫 REQUEST_CHANGES review whose entire body was the CLI's
  // own "You've hit your org's monthly spend limit" message. Two PRs blocked-for-security with
  // nothing audited, and no signal anywhere that the gate was down.
  //
  // Fail-closed is correct and must not change. What must be true is that the workflow says which
  // of the two happened.
  const src = read('sam-audit.yml');

  assert.match(
    src,
    /\bstatus=error\b/,
    'sam-audit.yml has no `error` verdict. With only approved/blocked, an infrastructure failure ' +
      'is posted as a security finding.'
  );
  assert.match(
    src,
    /grep -q '\^BLOCKED:'/,
    '`blocked` must require the real BLOCKED: marker. Reaching it as the else-branch of the ' +
      'APPROVED: check is what made every outage look like a security block.'
  );
  assert.match(
    src,
    /steps\.audit\.outcome/,
    'the verdict must consult the audit step\'s outcome. `continue-on-error: true` means a step ' +
      'that dies before writing $GITHUB_OUTPUT leaves `status` empty, and an empty status must ' +
      'not fall through to the blocked wording.'
  );

  // The error branch of the review-posting script, isolated: `if (status === 'error') { ... }`.
  const branch = src.match(/if \(status === 'error'\) \{[\s\S]*?\n(\s+)\}/);
  assert.ok(branch, "sam-audit.yml has no `if (status === 'error')` branch in the review step — parse is stale");
  for (const forbidden of ['REQUEST_CHANGES', 'createReview', '🚫']) {
    assert.ok(
      !branch[0].includes(forbidden),
      `the error branch uses ${forbidden}. A "changes requested" review for a spend limit or a ` +
        `dead runner is the same lie in a different place — an outage is not a security finding.`
    );
  }
  assert.match(
    branch[0],
    /issues\.createComment/,
    'the error case must be a plain comment, visibly distinct from a blocking review.'
  );
  assert.match(
    branch[0],
    /could not run/i,
    'the error comment must say the audit could not run, not that Sam blocked the PR.'
  );

  // Fail-closed, and page a human — nothing on the runner can fix a spend limit by itself.
  assert.match(
    src,
    /human-needed\.js[\s\S]{0,80}raise sam-audit-cannot-run/,
    'an audit that cannot run must raise the `sam-audit-cannot-run` human-needed alert. A stable ' +
      'key is what makes a repeat outage comment rather than open an issue per push.'
  );
  const failStep = src.slice(src.indexOf("if: steps.review.outputs.status == 'error'"));
  assert.match(
    failStep.slice(0, failStep.indexOf('\n      - name:') + 1 || undefined),
    /exit 1/,
    'the error path must still fail the check. Fail-closed does not change — only the story does.'
  );
});

test('daily-triage can push a branch and open the PR it is specified to produce', () => {
  // Stage 2's whole output is draft PRs. `issues: write` alone let the job finish "successfully"
  // with its committed branches stranded and unpushed (#243).
  const src = read('scheduled-tasks.yml');
  const job = src.slice(src.indexOf('\n  daily-triage:'));
  const block = job.slice(0, job.indexOf('\n    env:'));
  for (const scope of ['issues: write', 'contents: write', 'pull-requests: write']) {
    assert.ok(
      block.includes(scope),
      `scheduled-tasks.yml daily-triage is missing '${scope}'. Without contents+pull-requests the ` +
        `run cannot push a branch or open a PR, and silently strands its work (#243).`
    );
  }
});

test('weekly-trust-scores does not pass --allow-empty, so a missing run-log fails the job (#405)', () => {
  // compute-trust-scores.js documents --allow-empty as a bootstrap-only escape hatch (it exits 1
  // on missing input specifically so an inert trust-score pass is loud). The workflow passed the
  // flag unconditionally, which permanently re-disabled that signal: an empty report could never
  // make weekly-trust-scores go red, forever, on every host — the same class of defect as #314's
  // weekly-memory-decay silent skip. The host has dispatched agents by now, so run-log exists and
  // the escape hatch is no longer needed here.
  const src = read('scheduled-tasks.yml');
  const job = src.slice(src.indexOf('\n  weekly-trust-scores:'), src.indexOf('\n  weekly-hygiene:'));
  const computeStep = job.slice(job.indexOf('Compute trust scores'));
  const runLine = computeStep.match(/^\s*run:\s*node .*compute-trust-scores\.js.*$/m);
  assert.ok(runLine, 'weekly-trust-scores has no compute-trust-scores.js run: line — parse is stale');
  assert.ok(
    !runLine[0].includes('--allow-empty'),
    'weekly-trust-scores passes --allow-empty unconditionally, so a missing run-log can never fail ' +
      'this job — it stays green forever even if agent-dispatch.yml stops writing run-log (#405).'
  );
});

test('a daily-triage cron slot lands inside the 3h freshness window after stage 1 (#452)', () => {
  // Stage 1 (Grok Tasks, external) archives the day's brief at ~14:05-14:21 UTC in practice, not
  // the documented 06:00 (observed Drive createdTime across five days). The daily-triage skill
  // only accepts a handoff whose age <= 3h, so a stage-2 slot that fires before stage 1 has run
  // can NEVER see a fresh brief and reports the degraded fallback sweep every day by construction
  // — the exact defect #452 named for the old 13:00 UTC slot (13:00 < 14:05, always stale) as well
  // as the 05:00 one it was filed against. This asserts at least one cron fires after 14:05 UTC
  // and within the 3h window (i.e. before 17:05 UTC), so the fix can't silently regress.
  const STAGE1_FIRE_HOUR = 14 + 21 / 60; // latest observed fire, 14:21 UTC
  const FRESHNESS_HOURS = 3;
  const src = read('scheduled-tasks.yml');
  const schedule = src.slice(src.indexOf('  schedule:'), src.indexOf('  workflow_dispatch:'));
  const hours = [...schedule.matchAll(/cron:\s*'0\s+(\d{1,2})\s+\*\s+\*\s+\*'/g)].map((m) => Number(m[1]));
  assert.ok(hours.length >= 2, 'expected at least the two daily-triage crons — parse is stale');
  const fresh = hours.some((h) => h >= STAGE1_FIRE_HOUR && h <= STAGE1_FIRE_HOUR + FRESHNESS_HOURS);
  assert.ok(
    fresh,
    `no daily-triage cron hour (${hours.join(', ')}) falls within [${STAGE1_FIRE_HOUR}, ` +
      `${STAGE1_FIRE_HOUR + FRESHNESS_HOURS}] UTC — every stage-2 run will report a stale/missing ` +
      `handoff and fall back, hiding a genuinely missed stage 1 (#452).`
  );
});
