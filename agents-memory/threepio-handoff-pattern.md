---
name: threepio-handoff-pattern
description: Agent autonomy + auto-documentation via Threepio. Agents self-update memory, HANDOFF.md, repo docs post-session.
metadata:
  type: feedback
---

# Agent Autonomy: Auto-Handoff & Self-Documentation via Threepio

## Goal
Agents automatically publish session output to decision logs, HANDOFF.md, repo-specific docs (CLAUDE.md/GEMINI.md/COPILOT.md), and docs/ without manual follow-up.

**Why:** Chris's agents self-update their files post-session. Minimal handoff friction. Toni doesn't coordinate documentation. Agents own their own output.

**How to apply:** Every agent exit follows template. Threepio aggregates + coordinates cross-repo comms.

---

## Agent Exit Template (All Agents Use)

**Every agent, before closing session, outputs:**

```
## 🔄 SESSION SUMMARY — [Agent Name]

**What I did:**
- [shipped item 1]
- [shipped item 2]
- [blocker or learning]

**What I'm handing off:**
- [next item, owned by @AgentName or unassigned]
- [waiting on: @OtherAgent for X, due YYYY-MM-DD]

**Updates needed:**
- agents-memory/[agent].md: Decision Log + Critical Risks + Session History
- HANDOFF.md: shipped/blocked/next sections
- docs: [repo-specific docs to update]
- claude.md/gemini.md/copilot.md: [if behavior/command changes]

**Threepio: Please publish the updates above when session ends.**
```

---

## Threepio's Handoff Orchestration (Auto-triggered)

**When session ends, Threepio:**

1. **Collect all agent summaries** from this session
2. **Update each agent's memory file:**
   - Append Decision Log row (date, project, decision, status, notes)
   - Add/update Critical Risks table
   - Add Session History entry (1-liner + duration)
   - Add/update Cross-Agent Flags (@-mentions)

3. **Update repo HANDOFF.md files:**
   ```markdown
   # HANDOFF
   
   **Last updated:** YYYY-MM-DD HH:MM UTC
   
   ## What shipped [this session]
   - [item] (shipped by @Agent, PR #123)
   
   ## What's blocked
   - [item] (blocker: X, waiting on @Agent, ETA YYYY-MM-DD)
   
   ## Next items
   - [item] (owner: @Agent, due YYYY-MM-DD)
   
   ## Watch-outs
   - [alert from Critical Risks]
   ```

4. **Update repository-specific docs (if applicable):**
   - claude.md: CLI-specific setup, commands, activation patterns
   - gemini.md: Gemini CLI equivalents
   - copilot.md: Copilot CLI equivalents
   - docs/FEATURE.md: Architecture decisions, usage examples
   - docs/HANDOFF.md: Aggregated view across all repos (Jarvis reads this)

5. **Create/update top-level HANDOFF.md** (repo root):
   - Pulls from all sub-repo HANDOFF.md files
   - Single source of truth for Jarvis startup ritual

6. **Commit all changes to feature branch and open PR (for audit gate):**
   ```bash
   git checkout -b auto/session-handoff-[agent-name]-[date]
   git add agents-memory/ HANDOFF.md claude.md gemini.md copilot.md docs/
   git commit -m "Auto-update: session handoff [Agent names] [date]"
   git push origin auto/session-handoff-[agent-name]-[date]
   gh pr create --title "Auto-update: session handoff [Agent Names]" --body "Automated session summary from @[Agent]. Requires Sam's pre-merge security review."
   ```
   - Threepio opens PR → Sam reviews (security audit gate applies) → if approved, Threepio merges to main

7. **Notify:** Log completion. No slack/email needed (Jarvis reads committed memory + HANDOFF on next startup).

---

## Example Session Flow

### Friday (CTO) Session Ends

```
## 🔄 SESSION SUMMARY — Friday

**What I did:**
- Approved tenant isolation schema (after pressure-test: 100 concurrent tenants, 0 failures)
- Defined retry strategy (exponential backoff: 1s, 2s, 4s, 8s, max 32s)
- Blocked: @Pym schema ship (waiting on connection pool baseline measurement)

**What I'm handing off:**
- @Pym: Measure connection pool size under 50 concurrent users. Baseline due EOW.
- @Astra: Add regression test for auth flow (3 test cases). Due 2026-05-22.
- @Leo: Diagnose flaky CI tests (2 failures last week). Root cause analysis due 2026-05-20.

**Updates needed:**
- agents-memory/friday.md:
  - Add Decision Log: "Approved tenant isolation schema after 100-tenant pressure-test"
  - Update Critical Risks: "FaxGenie tenant isolation" → Status ✅ Approved (pending Pym baseline)
  - Add Session History: "Pressure-tested tenant isolation schema, defined retry strategy. Blocked: pool baseline. (4h)"
  - Update Cross-Agent Flags: @Pym (baseline due EOW), @Astra (auth tests due 2026-05-22), @Leo (CI diagnose)

- HANDOFF.md:
  - shipped: "Tenant isolation schema approved (pressure-tested 100 concurrent, 0 failures)"
  - blocked: "Connection pool baseline measurement (waiting on @Pym, due EOW)"
  - next: "Deploy tenant isolation after @Pym baseline + @Astra regression tests"

- docs/ENGINEERING-STANDARDS.md:
  - Add: "Exponential backoff retry pattern: 1s, 2s, 4s, 8s, max 32s. Reduces transient failures by 40%."

**Threepio: Please publish the updates above when session ends.**
```

### Threepio Executes

```
# Threepio Auto-Handoff Output

✅ Updated agents-memory/friday.md:
   - Decision Log: "2026-05-16 | FaxGenie | Approve tenant isolation schema | ✅ Shipped"
   - Critical Risks: "FaxGenie tenant isolation" status → "✅ Approved (pending @Pym baseline)"
   - Session History: Added entry
   - Cross-Agent Flags: Updated 3 @-mentions

✅ Updated HANDOFF.md:
   - shipped: +1 entry
   - blocked: +1 entry (waiting on @Pym baseline)

✅ Updated docs/ENGINEERING-STANDARDS.md:
   - Added exponential backoff pattern section

✅ Committed + pushed:
   commit 7f3a9c1: Auto-update: session handoff Friday 2026-05-16

Ready for next session. Jarvis will read updated memory + HANDOFF on startup.
```

---

## Agent Memory File Structure (Per Agent)

```markdown
# [Agent] - Memory

## Decision Log

| Date | Project | Decision | Status | Notes |
|------|---------|----------|--------|-------|
| YYYY-MM-DD | Repo | What I decided | ✅/🔄/⏳ | Context for future me |

## Critical Risks

| Date | Project | Risk | Severity | Mitigation | Owner | Status |
|------|---------|------|----------|-----------|-------|--------|
| YYYY-MM-DD | Repo | What's risky | HIGH/MED/LOW | How to fix | @Agent | 🔄/⏳ |

## Learnings

- **[Fact]** — [Why this matters]. (Agent, YYYY-MM-DD)

## Session History

- **YYYY-MM-DD:** [1-liner summary of work]. (Xh)

## Cross-Agent Flags

- **@Agent:** [What I need from you, due date]

## Framework References

- [[framework-name]]: Link to shared principle
```

---

## What Makes This Work

1. **Agent owns their own output** — No external aggregator needed. Agent writes the summary, Threepio automates the publishing.

2. **Threepio is dumb orchestrator** — Reads agent summary, executes deterministic updates. No decisions. No logic.

3. **Committed to git** — Memory + HANDOFF live in version control. Idempotent. Auditable. Survives agent unavailability.

4. **Minimal friction** — Agent writes summary. Threepio publishes. Next session, Jarvis reads committed state. No manual sync.

5. **Scales across repos** — Each repo has own HANDOFF.md. Threepio aggregates to top-level HANDOFF.md for Jarvis multi-repo view.

6. **Self-healing** — If Threepio fails to publish, agent can re-trigger: "@Threepio: publish session summary for [agent]". Idempotent (git prevents duplicates).

---

## Implementation Checklist

- [ ] Add Agent Exit Template to AGENTS.md
- [ ] Create Threepio orchestration script (PowerShell or Node)
- [ ] Update each agent definition with session exit instructions
- [ ] Test: Friday session → Threepio publish → Jarvis reads on next startup
- [ ] Document: Show example flow in AGENTS.md
- [ ] Validate: Commit log shows auto-update entries, memory is up-to-date
