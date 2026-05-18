# Cross-Agent Memory System

Searchable, repo-agnostic memory for all agents. Single source of truth for decisions, risks, and learnings across all projects.

**Location:** `.claude/agents-memory/` (git-versioned, shared across all CLIs and repos)

---

## How It Works

1. **Each agent has a memory file** (jarvis.md, friday.md, nat.md, sam.md, etc.)
2. **Memory lives in agent file** under `## Memory` section
3. **Structured sections:** Decision Log, Critical Risks, Learnings, Session History, Escalations
4. **Searchable by:** Agent, Project, Date, Decision Type, Status
5. **Jarvis reads on startup** — reads shared memory + repo HANDOFF.md, synthesizes cross-project state

---

## Memory Structure (per agent file)

```markdown
# [Agent Name] - Memory

## Decision Log

| Date | Project | Decision | Owner | Status | Notes |
|------|---------|----------|-------|--------|-------|
| 2026-05-18 | AgentSystem | Consolidate Scout/Beth/Scrooge → Nat | Jarvis | ✅ Complete | Phase 1 business consolidation |
| 2026-05-15 | FaxGenie | Implement retry logic with exponential backoff | Friday | ✅ Shipped | Reduces transient failures by 40% |

## Critical Risks

| Date | Project | Risk | Severity | Owner | Mitigation |
|------|---------|------|----------|-------|-----------|
| 2026-05-10 | AuthService | Session token expiry edge case | HIGH | Sam | Add regression test + audit all token paths |
| 2026-04-20 | FaxGenie | Database connection pool starvation under load | MEDIUM | Friday | Implement pool monitoring + alert at 80% |

## Learnings

- **Repo-to-CLI sync is more robust than CLI-to-repo.** Single source of truth prevents drift. (Jarvis, 2026-05-18)
- **Engineering discipline pays off immediately.** 5-test cadence caught 3 bugs before shipping. (Friday, 2026-05-16)
- **@-mentions in decisions save 2 escalation rounds.** Flag decisions early, not after they're baked. (Nat, 2026-05-12)

## Session History

- **2026-05-18:** Phase 1 business consolidation, sync architecture redesign (Jarvis, 3h)
- **2026-05-16:** FaxGenie query optimization, 40% latency improvement (Friday, 4h)
- **2026-05-14:** Q2 business metrics review, identified 3 growth levers (Nat, 2h)

## Escalations

- **2026-05-17:** @Friday: Database schema change for tenant isolation — impacts all repos. Needs pressure-test + migration rollback plan. (Jarvis)
- **2026-05-15:** @Sam: New vendor (Stripe) has PHI questions. Needs BAA review before contracts signed. (Jarvis)
```

---

## Query Examples

**"What decisions did Friday make in FaxGenie?"**
→ Search friday.md for `FaxGenie` in Decision Log

**"What are all HIGH severity risks?"**
→ Search all agent files for `HIGH` in Critical Risks

**"When did we decide to do X?"**
→ Search MEMORY.md index or specific agent files by date

**"What did Nat learn about sales cycles?"**
→ Search nat.md Learnings section

---

## Ownership Rules

1. **Each agent writes their own memory.** Friday owns friday.md, Nat owns nat.md.
2. **Jarvis synthesizes across agents.** Reads all files, spots conflicts, escalates.
3. **Cross-agent decisions are flagged in both files.** If Friday + Nat decide together, both agent files mention it.
4. **Session Log updated on shutdown.** Every session adds a one-liner to Session History.
5. **Critical Risks reviewed weekly.** Jarvis flags any risks that haven't been mitigated in 1 week.

---

## Searchability (git + grep)

```bash
# Find all decisions about FaxGenie
git grep "FaxGenie" .claude/agents-memory/*.md

# Find all HIGH severity risks
git grep "HIGH" .claude/agents-memory/*.md

# Find all escalations to Friday
git grep "@Friday:" .claude/agents-memory/*.md

# Find sessions from a specific agent
git grep "2026-05" .claude/agents-memory/friday.md
```

---

## Why This Works

| Problem | Solution |
|---------|----------|
| Agent memory gets lost between sessions | Each agent file is git-versioned + in version control |
| Can't search across agents | All files in .claude/agents-memory/, grep-able |
| Decisions aren't tracked | Decision Log table + timestamp |
| Risks slip through cracks | Critical Risks reviewed weekly by Jarvis |
| Escalations aren't documented | Escalations section with @-mention |
| Learnings don't transfer | Learnings section aggregated + quoted |
| Works for only one project | Repo-agnostic (Project column in all tables) |

---

## Integration with Jarvis Startup

**On startup, Jarvis:**
1. Reads shared memory (jarvis.md)
2. Reads .claude/agents-memory/MEMORY.md (this file) for index
3. Scans all repos' HANDOFF.md for recent changes
4. Searches memory for any "HIGH" risks + escalations needing action
5. Proposes 3-5 items based on risk/priority + delegation
6. @-mentions relevant agents

---

## Maintenance

- **Daily:** Jarvis scans for new escalations + HIGH risks (startup ritual)
- **Weekly:** Jarvis reviews Critical Risks section, flags any >1 week old without mitigation
- **Per session:** Agent updates their memory file (Decision Log, Learnings, Session History)
- **Monthly:** Jarvis audits memory for stale decisions, archives closed items
