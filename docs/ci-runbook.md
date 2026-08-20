# CI/CD runbook

Read this when touching `.github/workflows/**`, or when a dispatched command or audit
appears to hang. CLAUDE.md links here rather than inlining it, because this detail is
only needed for CI work and would otherwise cost ~400 tokens in every session.

Test on a feature branch before merging.

## Self-hosted runner

The self-hosted runner is the Linux Mission Control host. These workflows pin
`runs-on: [self-hosted, Linux]` and their steps are bash:

- `agent-dispatch.yml`
- `sam-audit.yml`
- `friday-audit.yml`
- `scheduled-tasks.yml`

Install or re-register:

```bash
bash tools/mission-control/install-runner.sh
# or, together with the webhook server:
bash tools/mission-control/install-local.sh --with-runner
```

It installs as a boot-persistent systemd service via the runner's own `svc.sh`, and needs
`gh`, `node`, and the `claude` CLI on the host. The audit and dispatch steps resolve those
by absolute path, `~/.local/bin` first.

## When a dispatched command hangs (#115)

Runner offline ⇒ dispatched `/agent`, `/merge`, `/close` comments and label triggers
silently no-op. No PR comment, no failure signal, nothing queues and nothing retries.

`.github/workflows/runner-health-check.yml` runs daily on `ubuntu-latest` and
opens/updates an issue labelled `runner:down`.

Three failure modes to check, in order:

```bash
# 1. Is Actions enabled at all? Disabled repo-wide silently stops everything,
#    including the health check that is supposed to warn you.
gh api repos/:owner/:repo/actions/permissions

# 2. Is a runner registered and online?
gh api repos/:owner/:repo/actions/runners

# 3. Does it carry every required label? An online runner missing `Linux`
#    is exactly as useless as an offline one — jobs queue forever.
```

The health check enforces #3 via `REQUIRED_LABELS`. It also treats "no evidence" as
`unknown` rather than healthy: without a `RUNNER_ADMIN_TOKEN` secret (fine-grained PAT,
Administration: Read-only) it can only prove *down*, never *up*, so it will not
auto-close the tracking issue on indirect detection alone.

## Audit timing

**Sam (`sam-audit.yml`)** — the pre-merge security gate, and a required status check on
`main`. Triggers, as of #228:

- on `opened`, for non-draft PRs only
- on `ready_for_review` (draft → ready)
- on `synchronize` (every push)

There is no label-based trigger. `labeled`/`ready-to-merge` was deliberately removed in #228:
adding *any* label made the job skip, and GitHub counts a skipped required check as satisfied —
so `open PR → push → add label → merge` shipped code to main with no audit at all. Don't
reintroduce a label trigger to "force a re-audit"; that's the exact bypass this closed.

To re-trigger after addressing feedback: push a commit (covered by `synchronize`), or re-run
the job from the Actions UI.

**Friday (`friday-audit.yml`)** — engineering review, informational only. Fires once, on
`opened`.

`friday-audit.yml` skips docs-only changes via a workflow-level `paths-ignore`
(`docs/**`, `**/*.md`) and PRs labelled `spec`. `sam-audit.yml` deliberately does **not** use
`paths-ignore` (#147): it is a required status check, so a workflow-level path filter would mean
docs-only PRs never produce the check at all, making them permanently unmergeable once branch
protection requires it. Instead it early-exits *inside* the job (still labelled `spec` PRs too),
so the required check still reports a passing result without spending an audit run. Do not add
`paths-ignore` to `sam-audit.yml` — it would silently break docs-only PRs. `pr-auto-review` (the
cavecrew reviewer, formerly in `scheduled-tasks.yml`) is retired; `friday-audit.yml` is the single
engineering reviewer.

## Required status checks on `main`

`Node.js tests`, `Security Audit (Sam CSO)` and `PR must be linked to an issue`. The security
audit needs the self-hosted runner, so with no usable runner every PR is unmergeable without an
admin override — and an admin override merges without the security gate. Fix the runner rather
than making a habit of `--admin`.

## Linked-issue check (#275, #296)

`pr-linked-issue-check.yml` runs on `ubuntu-latest` for every PR opened, synchronized, edited or
(un)labelled against `main`, and is a **required status check** with `enforce_admins`. It
collects candidate issue references from:

- the branch name matching `issue-<N>-...`, and
- close/fix/resolve keywords plus `#N` in the PR body (`closes #42`, `fixes #42`, …)

Every candidate is then **resolved through the API** (`issues.get` against this repo). This is
the part #296 added; before it, the check only pattern-matched strings, so `Closes #99999` and a
branch named `issue-0-whatever` both passed a gate that was already required on `main`.

| Case | Verdict | Why |
|------|---------|-----|
| number resolves to an issue here, open **or closed** | linked | the gate enforces that the work is tracked, not that the tracker is still open — issues legitimately close before their PR merges |
| number resolves to a **pull request** | not linked | PRs share the issue numbering space and come back from the same endpoint; a PR is not a tracked work item, and `Closes #<pr>` is usually a typo for the PR's own number |
| number does not exist (**404**) | not linked | the #296 case |
| `#0`, or no reference at all | not linked | rejected before any API call |
| any other API error — 403 rate limit, 5xx, 410, network | **linked, marked UNVERIFIED** | fail-open, deliberately: see below |
| PR labelled `spec` | exempt | design/discussion, not merged code |

**The fail-open is load-bearing.** This is a required check with `enforce_admins`, so failing
closed on a transient API error blocks every merge in the repo at once with no non-admin way
out and no code change that fixes it. A run that could not reach the issues API emits a
`::warning` containing `DEGRADED` and a reason string starting `UNVERIFIED`, and passes. If you
see that, re-run the job — the green check verified nothing.

The `issues: read` permission on that job is what makes the resolution work. Drop it and every
call errors into the fail-open path, i.e. the gate silently reverts to the syntax-only check
#296 removed, staying green the whole time. `tests/pr_linked_issue_check.test.js` pins it.

## "Ready to merge" ping (#295)

The ping `sam-audit.yml` posts after an approving audit used to state that tests were passing
and the PR was ready to merge, having read neither the test check nor the rollup — it fired on
Sam's own verdict alone. On PR #294 it invited a human to `/merge` while a required check was
red. `/merge` itself was never bypassable (`tools/pr-guard.js` gates it in `agent-dispatch.yml`
and does read the checks), so the cost was trust: a confident wrong "ready to merge" trains
people out of reading the check list.

It now reads the check rollup for the head SHA — check runs plus legacy commit statuses,
excluding its own in-progress run — and posts one of: ready to merge, N checks failing (named),
N checks still running (named), or, if the rollup cannot be read, an explicit statement that it
does not know. Sam's approval is reported as covering the security audit only.

### It is ONE comment, edited in place (#404)

The step is triggered by `synchronize` as well as `opened`/`ready_for_review`, and its body depends
on a check rollup that is still moving while it runs — so it necessarily runs several times per PR
and would say something different each time. It used to end in a bare `issues.createComment`, which
appended a fresh ping per run: PR #400 got one at 08:25 ("2 other check(s) are still running") and
another at 08:33 ("Ready to merge"), PR #370 got three inside four minutes. The tell in the API is
`created_at == updated_at` on every one of them — no comment was ever patched.

It is now an upsert keyed on a hidden `<!-- audit-gate -->` marker on the body's first line: find
the bot-authored comment carrying the marker, `updateComment` it, `createComment` only if there is
none. Four things about it are deliberate and should survive future edits:

- **Match the marker, not the wording.** The text changed in #295 and is not unique to this step —
  `runner-maintenance.yml` also mentions "Ready to merge".
- **Anchor the marker match with `startsWith`, never `includes`.** Caught in review on #404. The bot
  authors other comments on the same PR whose bodies relay diff-derived text — including this
  workflow's own "audit could not run" body, which interpolates model output. Any PR touching
  `sam-audit.yml`, its test, or this runbook carries the literal marker string in its diff. With an
  unanchored match, such a comment can be adopted as "the ping", and because it is *older* the
  "oldest wins" rule below picks it — so the next approved run PATCHes an outage record away and
  leaves a green check. Not a merge bypass (`pr-guard.js` gates on a PR *review*, which
  `updateComment` cannot touch), but a loss of audit trail.
- **`github.paginate` with `per_page: 100`.** At the default 30 the previous ping falls off page 1
  on a busy PR, the lookup misses, and the step silently degrades to the append bug. Same
  load-bearing reason as the linked-issue gate's dedupe.
- **Both API calls are fail-soft and fall back to posting.** The step runs only after an APPROVED
  verdict, so a throw here turns the required check `Security Audit (Sam CSO)` red on a PR Sam
  actually passed. A duplicate comment is a nuisance; a red gate on a clean PR blocks the merge
  path for everyone. Failures are surfaced with `core.warning`, never swallowed.
- **The upsert sits outside the rollup `try`.** A failed comment-list read says nothing about the
  check rollup, and folding it into that handler would rewrite an accurate body into "could not
  read the check rollup" — reintroducing the #295 defect of reporting something it never checked.

When several marked pings already exist (every PR above), the **oldest** is updated and the rest are
left alone — this step does not delete comments. No permission change was needed:
`issues.updateComment` against a PR is authorized by `pull-requests: write`, the same scope
`createComment` already relied on (see the note in `pr-linked-issue-check.yml`).

Verifying a change here means two pushes to a scratch PR and then
`gh api repos/Zene8/AgentSystem/issues/<n>/comments`: the proof is ONE ping whose `updated_at` has
advanced past its `created_at`. A count of one alone proves nothing — the second run may simply not
have fired.

## Workflow lint (#293)

`workflow-lint.yml` fails when a file in `.github/workflows/` is unloadable or invalid.

**Why it exists.** GitHub does not surface an unloadable workflow as a failing check — it omits
the check from the list entirely. No red X, no annotation, nothing in `gh pr checks`.
`pr-linked-issue-check.yml` shipped in #275 with a line at column 0 inside a `script: |` block,
which ended the YAML block scalar early and made the file unparseable. It then sat for weeks
looking like a working required gate while executing zero times (#286). A required check that
cannot load is worse than no check: it looks like coverage and provides none.

Two layers, neither of which covers the other:

| Layer | Catches | Does not catch |
|-------|---------|----------------|
| `actionlint` (pinned v1.7.12, sha256-verified) | YAML syntax, schema, expressions, runner labels, action inputs | anything inside a `script:` body — to it that is an opaque string |
| `node tools/workflow-lint.js` | invalid JavaScript in every `script:` block; a conservative YAML structure check | schema and expression errors |

Run either locally:

```bash
node tools/workflow-lint.js                 # all workflows; exit 1 on findings
node tools/workflow-lint.js path/to.yml     # one file
node --test tools/workflow-lint.test.js     # also runs under npm test
```

Two things to know before changing the linter:

- **Do not swap `AsyncFunction` for `node --check`.** A github-script body is an async *function
  body*, so top-level `await` and top-level `return` are both legal. `node --check` parses a whole
  module and rejects one or the other depending on mode — ESM rejects `return`, CJS rejects
  `await`. There is no mode that accepts both. `tools/workflow-lint.test.js` asserts this.
- **`tools/**` is Node-builtins-only**, so there is no `js-yaml`. Block scalars are extracted by
  applying the indentation rule directly: a block scalar ends at the first non-empty line indented
  less than the block's own indent. That is the rule #275 violated, so implementing it here is the
  check, not a workaround.

actionlint's `shellcheck` and `pyflakes` integrations are disabled (`-shellcheck= -pyflakes=`).
shellcheck is preinstalled on ubuntu runners and reports pre-existing SC2086/SC2001 style findings
in unrelated workflows; folding those into this gate would make it land red for reasons unrelated
to loadability. Enabling it is a follow-up once those are cleared.

## Runner host maintenance (#347)

`ssh` to the runner box is refused (port 22, connection refused), so
`.github/workflows/runner-maintenance.yml` is the only hands-on channel to its `~/agent-memory`. It
is `workflow_dispatch` **only** — deliberately not a routine, because `config/routines.yml` would
then demand a matching cron job in `scheduled-tasks.yml` and `node tools/routines.js verify` would
exit 1, and because a repair that can lose facts should never run unattended.

The single input is `type: choice`. That is a security boundary, not a convenience: these steps run
privileged commands on the same host that runs `sam-audit.yml`, the hard gate on merges to `main`,
so a free-form string input would be arbitrary remote code execution on the machine that decides
what gets merged.

**It cannot be dispatched before it is merged.** GitHub only indexes a `workflow_dispatch` workflow
that exists on the repository's **default branch**; until then `--ref <feature-branch>` returns
`HTTP 404: workflow runner-maintenance.yml not found on the default branch`, and the file does not
appear in `gh api repos/:owner/:repo/actions/workflows` at all. `--ref` selects which branch's copy
*runs*, not whether the workflow exists. So the first `status` run is a post-merge action, and the
branch-before-merge testing rule cannot apply to a dispatch-only workflow — lint and YAML parse are
the pre-merge evidence available.

```bash
gh workflow run runner-maintenance.yml -f mode=status            # read-only; always run this first
gh workflow run runner-maintenance.yml -f mode=repair-brain      # only after reading a status run
gh workflow run runner-maintenance.yml -f mode=reclone-brain     # only when repair-brain can't run — object store is corrupt
gh workflow run runner-maintenance.yml -f mode=bootstrap-run-log # one-time; unblocks weekly-trust-scores
```

`repair-brain` is the dangerous one, because the runner's checkout may hold commits that exist on
no other host (per-agent decision logs, user preference nodes). Its order is the safety property:

1. tar the whole checkout **including `.git`** to `~/agent-memory-backups/` — the local-only commits
   are the irreplaceable part, and a working-tree-only backup would not restore them;
2. resolve markers **before any `git add`**. This inversion is the whole fix: `brain-sync.js` runs
   `git add -A` *before* it pulls, so a half-merged tree is just file content to it and markers get
   committed and pushed as data (#344, 128 files);
3. reconcile with `git merge`, which keeps **both** parents. A merge commit cannot drop a local
   commit; a reset can. `reset --hard`, `push --force`, `checkout --theirs` and `clean -fd` are
   absent from that file on purpose;
4. prove zero markers remain **before** pushing, so the repair run cannot be the one that publishes
   markers to origin;
5. rebuild every graph, then re-run `memory-decay.js --all` — verification by execution, not by
   exit code.

If any of that cannot be done losslessly the job **stops**, raises the `runner-brain-repair-blocked`
human-needed alert, and exits nonzero. Stopping is the designed outcome; forcing a resolution is the
failure mode.

`tools/resolve-brain-markers.js` is the repair itself and is runnable anywhere (`--check` reports
without writing). Two rules, both lossless: a block whose every line on both sides is a date-ish
frontmatter key keeps the **earlier** value (`created:` is a creation timestamp, so a later value is
a re-import artifact); everything else **unions** both sides, HEAD first, de-duplicated.
`graph.json` is never repaired line-by-line — it is generated, so the tool takes one side that
parses and the rebuild comes from `nodes/` via:

```bash
node tools/graph/graph-init.js <slug> --brain-path="$HOME/agent-memory/nexus/<slug>"
```

Use `--brain-path`. The positional `graph-init.js <slug> <path>` form writes a brain nested inside
the brain and prints a success line for work it did not do (#346), and its output arrow is relative
so the two forms are indistinguishable from the log.

`reclone-brain` is the escalation when `repair-brain` refuses because the git object store itself
is unreadable (`error: object file .../XX is empty`, `fatal: bad object HEAD`) rather than merely
holding conflict markers — `repair-brain` fetches and merges, both of which need a working object
store first.

```bash
gh workflow run runner-maintenance.yml -f mode=reclone-brain    # only after status/repair-brain confirm corruption, not conflicts
```

It replaces rather than repairs, and only after proving the replacement drops nothing:

1. tar the whole checkout **including `.git`** first, same as `repair-brain`;
2. refuse to run at all unless `rev-parse HEAD` fails or `fsck --full` reports damage — this is not
   a shortcut around `repair-brain` for ordinary conflicts;
3. clone origin fresh into a **side** directory; the corrupt checkout is never touched by the clone;
4. prove the old HEAD, every local branch tip, and `fsck --no-reflog --unreachable` (zero dangling
   commits) all check out against the fresh clone — and treat a failed `for-each-ref` or `fsck` call
   itself as unproven, not as "nothing to report", since a damaged store can fail to walk objects at
   all and silently yield empty output;
5. swap by `mv`, never `rm -rf` — the corrupt checkout lands at `agent-memory-corrupted-<stamp>` and
   is kept, not deleted;
6. rebuild every graph, then re-run `memory-decay.js --all` against the fresh clone.

If any of that cannot be proven safe the job **stops**, raises the `runner-brain-reclone-blocked`
human-needed alert (a distinct key from `repair-brain`'s `runner-brain-repair-blocked` — resolving
one must not close an alert about the other), and exits nonzero.

## Action archive cache — the 429 in `Set up job` (#457)

`Sam Security Audit` run 32182510133 failed **before any repo code ran**:

```
Failed to download action 'https://codeload.github.com/actions/checkout/tar.gz/11d5960a…'
Error: Response status code does not indicate success: 429 (Too Many Requests).
Failed to download archive '…' after 3 attempts.
```

One PR sync fires six workflows here and ~10 self-hosted jobs each re-download the *identical*
`actions/checkout` tarball from one egress IP. codeload throttles the IP and a required check goes
red for a reason no diff can fix. Re-running is not a fix — the next sync repeats it exactly.

The runner has a supported local archive cache. From actions/runner
`src/Runner.Common/Constants.cs`:

```csharp
public static readonly string ActionArchiveCacheDirectory = "ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE";
```

`src/Runner.Worker/ActionManager.cs` reads it, and on a hit copies from disk instead of calling
codeload at all; on a **miss it falls straight through** to `DownloadRepositoryArchive`. That
fall-through is why seeding is safe with no rollback path: a partial or stale cache can only reduce
codeload traffic, never break a job. The layout is fixed by that same file —
`<cache>/<owner>_<repo>/<resolvedSha>.tar.gz` (`.zip` on Windows), keyed on the **resolved SHA**,
which is why every `uses:` in this repo being SHA-pinned is what makes seeding possible at all: a
tag-pinned action resolves to a SHA the runner only learns at job time.

Seed it with the dispatch-only job:

```bash
gh workflow run runner-maintenance.yml -f mode=seed-action-cache
```

It parses every SHA-pinned `uses:` out of `.github/workflows/`, downloads each tarball once into
`$HOME/actions-runner-action-cache`, verifies it untars before moving it into place, and reports
seeded/present/failed. A hard-coded action list was rejected: a list updated by hand goes stale
silently, and a stale entry reads as a working cache that never hits.

Three things about that job that are deliberate:

- **It is its own mode, not part of `repair-install`.** `repair-install`'s preflight `fatal`s on an
  unhealthy canonical checkout, and rightly so — but a 429 from codeload has nothing to do with
  `~/agent-memory`, and a fix for a red required check must not sit behind an unrelated brain
  repair. This mode reads no brain state and writes no repo state.
- **It wires the variable through `runsvc.sh`, not a `.env` and not a systemd drop-in.** The unit
  the runner's own `svc.sh` generates is `ExecStart={{RunnerRoot}}/runsvc.sh` with **no
  `EnvironmentFile`** — a `.env` would be read by nothing. A drop-in needs `sudo` on the host that
  gates merges. `runsvc.sh` is owned by the runner user and carries an explicit insertion point,
  `# insert anything to setup env when running as a service`; the export goes immediately after it,
  because appending at EOF lands after `wait $PID` and never executes. A timestamped `.bak` is left
  beside it.
- **It never restarts the runner.** It is executing *on* the runner it would restart, so
  `svc.sh restart` kills the job and reports a failure — one more red run, the thing being fixed.
  Instead it reads `/proc/<Runner.Listener pid>/environ` and reports whether the variable is
  actually live, because "the file says so" is not "the process has it" (the #362 distinction). The
  setting goes live at the next runner restart, which auto-update performs unattended; to force it
  from the host console: `cd ~/actions-runner && sudo ./svc.sh stop && sudo ./svc.sh start`.

## The `status` probe must never fail (#457)

`runner-maintenance.yml -f mode=status` run 32187001323 exited **128** mid-report, printing the
first few lines and then stopping — no `dirty paths`, and none of the canonical-checkout section,
which is the first thing #449 tells a human to read. The step's own header says it is "read-only by
construction … none of them may fail the job — an unknown state must still be reported", and that
contract was broken by the shell: GitHub invokes `run:` as
`bash --noprofile --norc -e -o pipefail {0}`, and a step's own `set -uo pipefail` does **not** clear
that `-e`. Against a brain with a damaged object database the first `git` call returned 128,
`pipefail` propagated it and `-e` ended the probe.

Rules for anything diagnostic in that file:

- Start the step with an explicit **`set +e`**. Nothing else clears the injected `-e`.
- Never `git … | wc -l`. Two failure modes in one: `pipefail` turns a git rc of 128 into a dead
  step, and `wc -l` of no output is `0`, which reads as *clean* — the worst possible answer on a
  corrupt brain. Capture, check the rc, then count.
- An unreadable value prints as `unknown (git <cmd> exited <rc>: <first line>)`, never as a blank —
  a blank line and a healthy empty value are indistinguishable to the human reading the report.
- The probe names corruption explicitly: an empty `HEAD` plus a failed fetch plus rc 128 is the
  `brain-sync-corrupt` condition (#434), **not** a merge conflict, and the two have different
  repairs (`reclone-brain` vs `repair-brain`). A truncated report leaves a human unable to tell
  which they need.

`repair-install` and `Post-repair status` were checked for the same shape and already guard every
command (`set +e` / `|| true`). The `-euo pipefail` steps elsewhere in the file are deliberate
fail-stop safety properties and were left alone — a *repair* that half-runs should stop; a *probe*
that half-runs is the bug.

## Healing a dirty canon checkout — `heal-canon` (#462)

`enforcement-drift-check` fails on one line when the canonical checkout `~/dev/AgentSystem` falls
behind:

```
FAILED: canon checkout is behind origin/main
```

`repair-install`'s bounded self-heal answers, correctly:

```
SKIPPED — canon has 2 dirty path(s); someone may be mid-edit.
Rewriting that tree from a dispatch is not acceptable.
```

Both are right, and together they are a dead end: `repair-install` must never start rewriting
working trees as a side effect of someone dispatching it to fix hooks, and `ssh` to the runner host
is refused, so nobody can resolve the edits by hand either. That is why two dirty paths sat in canon
from 2026-08-10 failing a nightly job.

Two things close it, both in `runner-maintenance.yml`:

- **`status` prints the diff, not just the path names.** `git diff --stat`, the full `git diff`
  capped at 500 lines (the cap is stated when hit), plus separate sections naming staged changes
  and untracked files, which no `git diff` covers. Read-only — no fetch, no remote rev-spec —
  because `status` mutates nothing. Without this, a keep-or-discard call needs host access that
  does not exist.
- **`heal-canon` is the repair, and it preserves the edits rather than discarding them.**
  `git stash push`, then `merge --ff-only`, then it prints the exact `git stash pop` to restore.
  `checkout --`, `reset --hard` and `clean` are banned here for the same reason they are banned in
  `repair-brain` and `reclone-brain`: each destroys work with a zero exit code.

The stash is **proven to exist before the tree is touched further** — `refs/stash` resolves, an
entry carrying this run's stamp is in `git stash list`, and the count went up — the same shape as
the `reclone-brain` prove step, for the same reason. A zero exit from `stash push` with no stash
behind it is the shape that would let the merge run over unheld edits, so all three proofs are
required and any failure stops the run having done nothing else. Untracked files stop it before
anything happens at all: `stash push` without `-u` leaves them alone, so this job will not claim to
have preserved work it never touched. A clean tree is reported and handed back to `repair-install`,
which already covers that case including the branch return.

`heal-canon` is a separate dispatch on purpose. Touching a dirty tree should always be something a
human chose.
