# Cross-Agent Memory System

Searchable, repo-agnostic memory for all agents. Single source of truth for decisions, risks, and learnings across all projects.

**Location:** `agents-memory/` (git-versioned, shared across all CLIs and repos)

---

## How It Works

1. **Each agent has a memory file** (jarvis.md, friday.md, nat.md, sam.md, etc.)
2. **Memory lives in agent file** — Decision Log, Critical Risks, Learnings, Session History, Escalations
3. **Searchable by:** Agent, Project, Date, Decision Type, Status
4. **Jarvis reads on startup** — reads shared memory + repo HANDOFF.md, synthesizes cross-project state

---

## Memory Structure (per agent file)

```markdown
# [Agent Name] - Memory

## Decision Log

| Date | Project | Decision | Status | Notes |
|------|---------|----------|--------|-------|
| 2026-05-18 | AgentSystem | Phase 1: Consolidate Scout/Beth/Scrooge → Nat | ✅ Complete | Reduces complexity |

## Critical Risks

| Date | Project | Risk | Severity | Owner | Mitigation | Status |
|------|---------|------|----------|-------|-----------|--------|
| 2026-05-18 | FaxGenie | Schema not pressure-tested | HIGH | Friday | 100 concurrent load test | 🔄 In Progress |

## Learnings

- **Repo-to-CLI sync more robust.** Single source of truth prevents drift. (Jarvis, 2026-05-18)

## Session History

- **2026-05-18:** Phase 1 consolidation, sync redesign (3.5h)

## Escalations

- **2026-05-18 @Friday:** Tenant isolation schema — needs pressure-test + rollback plan. ETA?
```

---

## Query Examples

```bash
# Find all decisions about FaxGenie
git grep "FaxGenie" agents-memory/*.md

# Find all HIGH severity risks
git grep "HIGH" agents-memory/*.md

# Find all escalations to Friday
git grep "@Friday:" agents-memory/*.md
```

---

## Ownership Rules

1. **Each agent writes their own memory.** Friday owns friday.md, Nat owns nat.md.
2. **Jarvis synthesizes across agents.** Reads all, spots conflicts, escalates.
3. **Cross-agent decisions flagged in both files.** If Friday + Nat decide together, both mention it.
4. **Session Log updated on shutdown.** One-liner added to Session History.
5. **Critical Risks reviewed weekly.** Jarvis flags any >1 week without mitigation.

---

## Integration with Jarvis Startup

**On startup, Jarvis:**
1. Reads `agents-memory/jarvis.md` (Decision Log, Critical Risks, Escalations)
2. Scans all repos' HANDOFF.md for changes
3. Searches memory for HIGH risks + escalations needing action
4. Proposes 3-5 agenda items
5. Dispatches agents with @-mentions

---

## Related Documents

- **threepio-handoff-pattern.md** — Agent autonomy + auto-documentation design. Agents self-update memory post-session via SESSION SUMMARY template. Threepio auto-publishes to all repos.
- **PHASE3-VS-CHRIS-DETAILED-COMPARISON.md** — Exhaustive side-by-side of user's Phase 3 system vs Chris's 9-agent system. 12 categories (architecture, scalability, decision authority, fault tolerance, MCP dependency, memory, leadership, overhead, learning curve, compliance, cost per feature, risk mitigation).
- **OVERENGINEERING-ASSESSMENT.md** — Honest assessment: Phase 3 is 30% overengineered for today (8 agents), 30% right-sized for month 6 (12 agents), 40% future-proofed for month 12 (15+ agents). Verdict: worth building, simplify ceremony (16-step → 5-step, MCP → GitHub only).

---

## Maintenance

- **Daily:** Jarvis scans for escalations + HIGH risks
- **Weekly:** Jarvis reviews Critical Risks, flags >1 week old
- **Per session:** Agent updates memory (Decision Log, Learnings, Session History) or outputs SESSION SUMMARY → Threepio auto-publishes
- **Monthly:** Jarvis audits for stale decisions, archives closed items
