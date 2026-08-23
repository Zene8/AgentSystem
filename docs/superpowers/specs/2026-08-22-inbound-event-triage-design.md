# Inbound Event Triage — Design

**Date:** 2026-08-22
**Status:** approved, unimplemented
**Supersedes nothing.** Extends `daily-triage` (Life OS stage 2) rather than replacing it.

## Problem

Everything the agent fleet actions on the owner's behalf arrives through one 24-hour funnel:
the `daily-triage` job in `.github/workflows/scheduled-tasks.yml`. An email at 09:00 waits until
the 15:00 UTC run. A failed workflow waits the same. Two consequences:

1. **Latency is the product.** The system cannot react to anything, only report on it.
2. **A single run is a single point of failure.** Every defect in stage 1 — a missing `handoff:`
   block (#417), a Drive file saved without a `.md` suffix (#436), an archive that never lands
   (#233) — degrades or blanks the entire day's actioning.

`POST /github` in `tools/mission-control/webhook-server.js` was built to fix this and never
worked. `gh api repos/Zene8/AgentSystem/hooks` returns `[]` — no webhook is configured — and
Mission Control binds tailnet/loopback only, with no public HTTPS ingress in any deploy path
(`docs/mission-control-linux-deploy.md` lists nginx/Caddy/tunnel as options, none installed). The
receiver has never processed a single real event. It is not half-built; it is complete and
unreachable. That is why "add a webhook listener" resolves here to **polling from the server**,
not to wiring up the existing endpoint.

## Non-goals

- **No public ingress.** No Cloudflare Tunnel, no nginx TLS terminator, no open inbound port.
  Considered and rejected: a genuinely internet-reachable endpoint on the host that also runs the
  self-hosted Actions runner is a materially larger attack surface than the latency saves.
- **No new autonomy.** The ceiling stays exactly where `daily-triage` put it: draft PRs only.
- **Not a replacement for the daily run.** The cron becomes a reconciler, not a corpse.

## Architecture

Four layers. All code lives in `tools/`, so it is git-carried and deploys through the existing
`mission-control-update.timer` — unlike the Life OS skills, which are gitignored (#187) and are
the sole reason #439 exists.

```
ADAPTERS  tools/inbound/<source>.js
  poll(cursor, policy) -> { items: Envelope[], cursor }
  Pure. No model call. No dispatch. No event-bus knowledge. Testable against stubbed responses.
        |
        v
POLLER  tools/inbound/poll-run.js --source=<s>
  load policy -> load cursor -> adapter.poll() -> drop seen -> publish 'inbound-item' -> save cursor
        |
        v
EVENT BUS  tools/event-bus.js   (exists; add 'inbound-item' to KNOWN_TYPES)
  queue/ -> processing/ -> done.jsonl | dead-letter.jsonl, exponential backoff, recoverStale()
        |
        v
DISPATCHER  tools/event-dispatcher.js   (exists; extended)
  one Haiku call per item -> { verdict, why, agent, prompt }
    ignore  -> complete(), recorded, zero further spend
    notify  -> complete(), surfaced in panel + closeout
    action  -> publish 'spawn-agent'  (existing type, existing cap/dedupe/requeue path)
        |
        v
  Jarvis / Friday / Leo  ->  draft PR only
```

Outputs are a separate, non-polled layer:

```
OUTPUTS  tools/outbound/notion-task.js, tools/outbound/calendar-event.js
  Invoked BY agents to create a Notion task or a Calendar event. No timer. No cursor.
```

Calendar and Notion are outputs first. Notion is additionally polled once a day for tasks;
Calendar is never polled.

### The envelope

Every adapter normalizes to one shape. The dispatcher and the classifier know only this:

```js
{
  source:     'gmail' | 'beeper' | 'github' | 'notion',
  externalId: String,   // stable, source-native; the dedupe key
  ts:         String,   // ISO 8601
  actor:      String,   // sender / author / triggering user
  subject:    String,
  body:       String,   // may be truncated by the adapter
  url:        String,   // deep link a human can open
}
```

`externalId` must be stable across polls. A source that only offers an unstable id is not
adaptable and must not be added.

### Cadence tiers

One systemd timer per tier, not per source, so adding a source does not add a unit.

| Tier | Interval | Sources | Rationale |
|---|---|---|---|
| `fast` | 2 min | Gmail, Beeper/Discord | Conversational. Latency is the whole point. |
| `medium` | 10 min | GitHub notifications | Filtered to failed workflow runs and issues assigned to the owner. |
| `daily` | 1x/day | Notion tasks | Task lists do not need a 2-minute reaction. |

The tier a source runs in comes from `cadence:` in the policy file, not from code, so retuning
does not need a deploy.

## State

`~/.cache/agentsystem/inbound/<source>.json`, located with the **existing exported `cacheDir()`
from `tools/brain-sync-run.js`** — imported, not reimplemented. Shape:

```json
{ "cursor": "<source-native>", "lastRunAt": "<ISO>", "seenIds": ["...bounded ring, last 500"] }
```

Two placements that are deliberate and were both wrong in an obvious first draft:

- **Not `~/agent-memory`.** A cursor rewrites every two minutes and holds no facts. It would
  conflict on every brain sync, which is exactly why `session-log.jsonl`, `routing-log.jsonl` and
  the injection logs are already gitignored inside the brain.
- **Not `tmpdir()`.** A reboot that clears the cursor makes the entire inbox look new. With
  `action` verdicts live, that is a spawn storm, not a slow morning. Same reasoning that moved the
  brain-sync alert state out of `tmpdir()` in #434.

`seenIds` is a belt-and-braces dedupe *behind* the cursor, for sources whose cursor semantics are
inclusive or approximate.

A cursor file that is present but unparseable is a **hard stop for that adapter** with an alert.
It must never be treated as absent, because absent means "poll from the beginning".

## Policy

`$LIFE_REPO/inbound-policy.yml`, in the private Life OS repo. The public repo ships
`docs/inbound-policy.example.yml` — schema only, no personal data.

```yaml
gmail:
  enabled: true
  cadence: fast
  senders_allow: []          # personal; private repo only
  labels_ignore: []
  max_actions_per_day: 12
beeper:
  enabled: true
  cadence: fast
  chats_allow: []
  max_actions_per_day: 12
github:
  enabled: true
  cadence: medium
  reasons: [ci_activity, assign, review_requested]
  max_actions_per_day: 20
notion:
  enabled: true
  cadence: daily
  databases: []
  max_actions_per_day: 5
```

**Fail closed.** A missing, unreadable or unparseable policy file disables the adapter. It never
defaults open. Same direction as `GITHUB_WEBHOOK_SECRET` being unset, which rejects every webhook
rather than accepting them.

**`$LIFE_REPO` becomes a hard dependency.** It is currently unset on the runner (#281), where it
only degrades the closeout path. Under this design an unset `$LIFE_REPO` would silently disable
every adapter — a system that does nothing and reports success. The poller therefore fails loudly
at startup when `$LIFE_REPO` is unset, and #281 must be resolved before phase 4.

## Privacy boundary

Item bodies reach the classifier and the spawned agent's prompt. They do **not** reach durable
storage. `done.jsonl`, the closeout and the panel record only:

```
{ source, externalId, url, verdict, why, actor }
```

`done.jsonl` lives under `~/agent-memory/nexus/events/`. That repo is private, but it syncs to
every host — writing mail bodies there distributes them further than they need to travel. Policy
data (`senders_allow`, `chats_allow`) never leaves the private repo and is never passed as a
workflow input, because `Zene8/AgentSystem` is public and Actions logs would publish it — the same
constraint that ruled out shipping the skill by `workflow_dispatch` in #439.

## Safety

### Autonomy ceiling

Draft PRs only. No auto-sent email, no auto-sent chat message, no merge, no issue close, no push
to `main`. An `action` verdict yields a draft PR or a `human-needed` alert and nothing else.
Sam's gate on `main` is untouched: the event path has no more reach than an agent has today.

### Kill switch

Sentinel file `~/.cache/agentsystem/inbound/PAUSED` halts **dispatch** while polling and cursor
advancement continue. Registered in the `OPS` allowlist in `webhook-server.js` so the panel gets
a one-tap button.

A file rather than `systemctl stop`, for two reasons. Stopping the service freezes the cursor, so
the backlog becomes a replay storm at restart. And a misbehaving classifier must be stoppable in
one second from a phone, not from an ssh session into a host that refuses ssh (#439, #361).

### Ceilings

Enforced in the dispatcher, never in the adapter:

- `max_actions_per_day` per source. An item over the cap is recorded as `notify` with reason
  `daily-cap` — degraded, not dropped silently.
- `MC_MAX_PER_HARNESS` (4) and `MC_MAX_BG_SESSIONS` (8) still apply. This is the reason to route
  through the `spawn-agent` event type instead of calling `spawnAgent()` directly the way
  `POST /github` does: the overflow-requeue path already exists on that route, and the direct call
  has no durability, no backoff and no dead-letter.
- The classifier is bounded by dedupe — one Haiku call per *new* item, never per poll. A 2-minute
  Gmail timer is 720 polls/day and near-zero cost on a quiet day.

### Failure modes

| Failure | Behavior |
|---|---|
| Adapter API error, expired token | `event-bus.fail()`, backoff, dead-letter after 3 attempts, `human-needed` alert keyed per host and source. #263 (expired `BEEPER_ACCESS_TOKEN`) is this exact case and currently fails silently. |
| Classifier returns unparseable JSON | Treated as `notify`. Never `ignore`, never `action`. An unreadable verdict must not be able to drop an item or to spend on one. |
| Poller timer dead | The reconciler sees a stale `lastRunAt` and raises `inbound-poller-stale`. A timer that fails silently by construction needs an external detector (#361), and "the process exited 0" is not "the feature ran" (#362). |
| Cursor corrupt | Adapter refuses to poll, alerts. Never re-reads the whole source. |
| Duplicate delivery | `seenIds` ring plus the existing 30 s spawn dedupe on `agent|cwd|model|prompt`. |
| Both paths action one item | See "Two-path drift" below. |

### Two-path drift

For phases 2-5 the cron and the poller are both live actioners. `tools/daily-triage-lock.js`
exists but the poller is not currently a participant in it. Phase 3 makes the poller, the
dispatcher and the reconciler share one lock, or the same item gets actioned twice by two paths
that each believe they are alone.

### The Gmail-specific risk

Every other source is repository activity, where a misfire costs a junk draft PR. A misread email
that spawns an agent is the only case whose blast radius leaves the owner's own machines. Three
independent brakes, all of which must be landed before phase 4, not after:

1. `senders_allow` — an allowlist, not a blocklist.
2. Draft-PR-only ceiling.
3. `max_actions_per_day`.

## Deployment

The self-hosted runner is `baselyserver-mc`, labels `[self-hosted, X64, Linux, mission-control]`,
and it is Mission Control's own host. `workflow_dispatch` is therefore already a remote hand into
the ssh-refusing box.

- **Code:** git-carried in `tools/`. `mission-control-update.timer` pulls and restarts.
- **Timers:** a new `runner-maintenance.yml` mode installs the three tier units, gated on a
  `--check` the way `repair-install` gates the actions-watchdog and brain-sync timers. `ExecStart`
  points at the canonical checkout `$HOME/dev/AgentSystem`, never the Actions workspace, whose
  path `actions/checkout` rewrites (#361).
- **Policy:** already on the host in `$LIFE_REPO`. Never passed as a workflow input (see Privacy
  boundary).

**#439 does not block this design.** It blocks exactly one thing: transporting the gitignored
skill file, whose only channel is tar-over-ssh.

## The reconciler

`daily-triage` stops being the primary actioner and becomes the audit pass. On its existing
schedule it:

1. Reads `done.jsonl` and `dead-letter.jsonl` for the day.
2. Sweeps its existing sources for anything the poller never saw.
3. Writes `closeouts/YYYY-MM-DD.md` including every autonomous action taken that day.
4. Raises `inbound-poller-stale` if any tier's `lastRunAt` is older than 3x its interval.

`GET /briefing` is unchanged. The daily human-readable record of what the system did unobserved is
what makes this design acceptable rather than alarming, and it is not optional.

Consequence: **#471, #417, #436 and #439 all still need to land.** The reconciler still reads the
stage-1 handoff. The event path does not make those moot; it stops them being the only way
anything gets done.

Any change to the `daily-triage` schedule must be made in `.github/workflows/scheduled-tasks.yml`
and `config/routines.yml` together — `node tools/routines.js verify` exits 1 on a mismatch.

## Build order

| Phase | Content | Gate |
|---|---|---|
| 0 | Unblock the parallel track: #471/#470/#451 flipped ready, unpushed `5db0791` moved onto a branch and opened as a PR, the 8 behind commits pulled, laptop webhook key resolved. | none |
| 1 | Envelope, `inbound-item` type, policy loader (fail-closed), cursor store. Tests only, no network. | full suite green |
| 2 | GitHub adapter, `poll-run.js`, medium timer. End to end to a real draft PR. | one real draft PR from one real notification |
| 3 | Classifier, verdict handling, kill switch, daily caps, shared lock. | kill switch provably stops dispatch |
| 4 | Gmail + Beeper adapters, fast timer. | #281 and #263 resolved; three Gmail brakes live |
| 5 | Notion daily adapter; Notion + Calendar outputs. | none |
| 6 | Reconciler, `inbound-poller-stale`, #417 handoff contract, #436 Drive naming. | closeout lists every autonomous action |

Phase 2 deliberately proves the entire path using the one source with zero new auth and zero
personal data, before any private source is wired to it.

## Testing

- **Adapters:** contract tests against stubbed API responses. Cursor monotonicity. Unstable-id
  rejection. Body truncation.
- **Policy loader:** missing file disables; unparseable disables; unset `$LIFE_REPO` throws.
- **Dispatcher:** each verdict; unparseable classifier output becomes `notify`; daily cap becomes
  `notify` with reason; `PAUSED` halts dispatch but not polling.
- **Event bus:** existing `event-bus.test.js` covers backoff and dead-letter; add `inbound-item`.
- **Live HTTP:** extend `tests/test_mission_control_http.js` for the new `OPS` entries.
- No npm dependencies. Node builtins plus `graph-lib.js` only, per the `tools/**` path rule.
- `isMainModule(import.meta.url)` from `tools/is-main.js` for every new entry point. Never a
  hand-rolled `process.argv[1]` comparison — `tools/is-main.test.js` fails the build on one.
