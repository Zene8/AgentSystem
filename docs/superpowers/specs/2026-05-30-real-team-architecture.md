# Real Team Architecture — Brainstorm

**Date:** 2026-05-30
**Author:** Friday (CTO)
**Context:** How do we make the agent system work like a real co-located team — persistent shared state, push notifications, cross-project identity, and genuine proactivity — across Claude Code, Gemini CLI, and Copilot?

---

## Q1: What does "works like a real team" require at the infrastructure level?

### Scoring the current system

| Real-team requirement | Current state | Gap |
|---|---|---|
| Persistent shared state | `~/agent-memory/nexus/` shared across CLIs via filesystem | Weak: no locking, race conditions on concurrent writes |
| Push notifications | agent-message.js inbox files, polled at startup | Missing: agents only see messages when they run, not within minutes |
| Context travels with the person | Brain files in nexus, loaded at startup | Partial: loaded per-session but not incrementally updated mid-session |
| Stable roles across projects | Agent definitions in `~/.claude/agents/` etc | Solid: syncs to all CLIs, role identity is consistent |

### What's missing

**Active notification bus.** The biggest gap. A real team member gets a Slack ping within 30 seconds. Our agents see inboxes only when they start a new session. Proposal: a lightweight file watcher (`tools/notify-daemon.js`) that runs as a background process on the dev machine, watches `~/agent-memory/nexus/inbox/` for new messages, and triggers a desktop notification or writes to a terminal bell — so the human (Nathan) sees that an agent left a message without having to start a new session.

**Optimistic locking on shared writes.** When two agents write to `sona-patterns.md` concurrently (e.g., two parallel Ultron workers finishing at the same time), last-write wins. Fix: use a `.lock` file with a TTL (30s) — any writer acquires the lock, writes, releases. Lock files are cheap and work across all CLIs with no extra deps.

**Incremental brain updates.** Currently each agent loads the brain at startup but doesn't update it during a session. A long Friday session should write discoveries back to the brain as it works, not just at the end. Fix: `tools/brain-update.js --key="<topic>" --value="<learning>"` — a single-purpose appender that any agent can call at any point. Idempotent (deduplicates by key).

---

## Q2: Cross-project agent identity

### The problem

Jarvis running in `genie/` has read the genie graph. Jarvis running in `new-saas/` has no idea genie exists. A real CTO brings institutional memory to every project. Ours doesn't.

### Proposal: Project Registry + Cross-project Startup

**`~/agent-memory/nexus/projects/`** — one file per project:

```
~/agent-memory/nexus/projects/
  arbor-genie.md
  agent-system.md
  new-saas.md
  ...
```

Each file:
```markdown
# arbor-genie
**Repo:** ~/projects/arbor-genie
**Stack:** Next.js 15, Prisma, Postgres, Stripe, Sentry, Vercel
**Test command:** pnpm test
**Deploy:** Vercel CI (push to main)
**Key decisions:** Use Postgres (not Mongo) — 2026-03-10; Stripe for payments — 2026-02-01
**Status:** production
**Primary contact:** Friday
**Last active:** 2026-05-28
```

**Startup change for all agents:** After reading user brain, also run:
```
node ~/AgentSystem/tools/project-registry.js --current
```
This reads CWD git remote, finds the matching project file, and outputs a one-paragraph summary. Agents include this in their context for the session. If the project isn't registered, they prompt to register it.

**Cross-project decisions:** When Friday runs `decision-log.js --search`, it searches ALL decisions regardless of project slug. This means "we used Postgres in genie" surfaces when working on a new service. The project slug in the filename makes the source clear.

**`known-repos.json`** already exists as the registry — extend it with stack + key-decisions fields rather than creating a parallel structure.

---

## Q3: Async communication model across CLIs

### The duplicate-agent problem

Two terminal sessions open: one with Claude Code running Friday, one with Gemini CLI running Friday. They are completely unaware of each other. If both pick up the same GitHub issue, they produce conflicting PRs.

### What breaks with current shared-inbox approach

Shared inbox files work for message delivery but not for task claiming. There's no "I'm working on this" signal that another CLI instance can read before starting.

### Proposals

**Session lock files** — simplest fix, add immediately:

```
~/agent-memory/nexus/locks/friday-<hostname>-<pid>.lock
Content: {"task": "issue-42", "started": "2026-05-30T14:23:00Z", "cli": "claude-code"}
TTL: 30 minutes (stale if mtime > 30 min ago)
```

Before an agent picks up any task, it checks for active locks. If a lock exists for the same task, it skips and picks the next one. Lock is created at task start, deleted at task end. Implementation: 10 lines in agent startup.

**Cross-CLI handoff format** — structured markdown any CLI can parse:

```markdown
# Handoff: issue-42 — auth middleware refactor
**From:** Friday (claude-code, session 2026-05-30T14:23)
**Status:** in-progress / blocked / complete
**Completed:** Routes updated, tests written
**Remaining:** PR not yet opened — Sam audit pending
**Files touched:** src/middleware/auth.ts, tests/auth.test.ts
**Next action:** gh pr create --base dev
```

Written to `~/agent-memory/nexus/handoffs/issue-42.md`. Any Friday instance in any CLI reads this before starting work on issue 42.

**Shared task queue** (`~/agent-memory/nexus/queue.jsonl`) — for the proactive case where Jarvis wants to assign work without targeting a specific CLI. Each line is a JSON task entry. Agents poll on startup, claim by appending a "claimed" entry. First claimer wins. Simple, file-system-safe for low-frequency task dispatch.

### Assessment

The lock + handoff combination is sufficient for current volume (1-2 concurrent sessions max). The queue.jsonl approach is the right eventual architecture for when agents become more autonomous and sessions overlap frequently.

---

## Q4: Genuinely proactive agents

### Current state

Agents are reactive: they run when you start a session or a cron fires. A real engineer notices a failing test in CI without being asked.

### Infrastructure for proactivity

**Universal webhook receiver** — Leo builds `tools/webhook-server.js`: a small Express-free HTTP server (using Node's `http` module, no npm deps) listening on port 9876. Receives any webhook, routes by payload signature to appropriate agent inbox.

Payload routing:
- `{ repository, pusher }` → GitHub push → Friday inbox
- `{ error, project, environment }` → Sentry alert → Leo inbox
- `{ type: "payment_intent" }` → Stripe event → Nat inbox
- Unrecognized → Jarvis inbox with raw payload

Start command: `node ~/AgentSystem/tools/webhook-server.js` (runs as a background process or systemd/launchd service).

**GitHub notification polling** (`tools/gh-notify-poll.js`):
```
gh api /notifications --paginate
```
- Classify each notification by reason: `mention` → addressed agent, `review_requested` → Sam, `assign` → Friday
- Write to appropriate inbox file
- Run via scheduled task every 5 minutes (existing `~/AgentSystem/.github/workflows/scheduled-tasks.yml` already has the cron infrastructure)
- Cost at startup-notification volume: ~$0.001/day (Haiku classification, 2 API calls per notification)

**Pattern: Sentry → Leo inbox → Leo auto-creates GitHub issue**

When a Sentry alert comes in via webhook, Leo's inbox gets a new message. Next time Leo starts a session (or a cron runs Leo), it sees the inbox message, reads the Sentry event, creates a GitHub issue with reproduction steps, assigns `agent:friday` label. Friday auto-dispatches via agent-dispatch.yml. No human required in the loop for known error patterns.

This is the "genuinely proactive" loop: external event → inbox → agent → issue → dispatch → fix → PR.

---

## Q5: Team onboarding for new projects

### Current state

New project = manual setup. Nathan has to run graph-init, set up CLAUDE.md, tell agents about the repo. This takes 20-30 minutes of context-building that should be automated.

### Proposal: `tools/project-onboard.js`

```
node ~/AgentSystem/tools/project-onboard.js --repo=<path|url> [--name=<slug>]
```

Steps:
1. If URL: clone to `~/projects/<slug>/`
2. Read `README.md`, `CLAUDE.md`, `package.json` / `pyproject.toml` / `Cargo.toml` for stack detection
3. Detect test command: look for `scripts.test` in package.json, `pytest.ini`, `Makefile` targets
4. Detect deploy: look for Vercel config, Dockerfile, `.github/workflows/deploy*`
5. Run: `node ~/AgentSystem/tools/graph/graph-init.js <repo-path>` to build code graph
6. Write `~/agent-memory/nexus/projects/<slug>.md` with detected info
7. Append to `~/agent-memory/nexus/known-repos.json`
8. Write to Jarvis inbox: "New project registered: <slug>. Summary: <stack>. Awaiting first task."

Implementation: ~150 lines, pure Node.js builtins + existing graph-lib.js. No npm deps required.

### The "new engineer joins" analogy

The onboarding flow is the agent equivalent of a new engineer's first day:
- Clone repo (step 1)
- Read the README (step 2)
- Set up local dev (steps 3-4)
- Get a code tour (step 5 — graph-init)
- Get added to the team channel (step 8 — Jarvis notification)

After onboard completes, any agent starting a session in that directory gets full context from the project registry rather than starting blind.

---

## Implementation Priority

| Item | Impact | Effort | Priority |
|---|---|---|---|
| Project registry (`projects/<slug>.md`) | High — fixes cross-project identity | Low — extend known-repos.json | P0 |
| Session lock files | High — fixes duplicate-agent problem | Low — 10 lines per agent | P0 |
| `project-onboard.js` | High — removes manual setup | Medium — 150 lines | P1 |
| Cross-CLI handoff format | Medium — improves continuity | Low — write/read markdown | P1 |
| Webhook receiver (port 9876) | High — enables proactivity | Medium — 100 lines Node http | P1 |
| GitHub notification polling | Medium — passive awareness | Low — gh api + classify | P2 |
| `brain-update.js` (incremental) | Medium — richer context over time | Low — 30 lines | P2 |
| `notify-daemon.js` (desktop push) | Low at current volume | Medium | P3 |

The P0 items (project registry + session locks) can be shipped in the same PR as this architecture doc since they touch no existing files beyond known-repos.json schema.

---

## Conclusion

The system already has the bones of a real team: stable roles, shared memory, async messaging, CI/CD dispatch. The gaps are at the edges: agents don't know about each other's in-flight work, don't get push notifications, and need manual setup for each new project.

The fixes are all file-system-based and dependency-free — consistent with the constraint that tools must work in any CLI without npm installs. The highest-leverage single change is the project registry + cross-project startup augmentation: it makes every agent immediately more useful in every new project with no additional human setup.
