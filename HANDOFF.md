# Agent System Handoff

**Last Updated:** 2026-05-21  
**Owner:** Nathan  
**Status:** ✅ Multi-CLI Agent Orchestration + Memory System Unified

> **For Humans:** Comprehensive handoff guide for system setup and troubleshooting.  
> **For Agents:** Quick reference for startup, decision authority, and memory access across all 3 CLIs.

---

## FOR AGENTS: Quick Reference

### Jarvis Startup Ritual (8 Steps)
```
1. Read agents-memory/jarvis.md decision log + review schedule
2. Run 3 GitHub queries in parallel:
   - (a) last-48h merged PRs (all repos)
   - (b) open stale issues (>2 weeks old)
   - (c) unresolved GitHub Discussions
3. Scan HANDOFF.md "blocked" section + check agent review due dates
4. Probe email (last 24h) + calendar (next 7 days) in parallel via MCP
5. Identify blockers + assess risks
6. Synthesize: what changed, what's blocked, what needs decision
7. Brief human with agenda + decision queue (skip status dumps)
8. Execute + append outcomes to agents-memory/jarvis.md session log
```

**Weekly Cadence:** Saturdays 30m — full system review (all agents, goal scorecard, risk scan)

### Decision Authority Matrix
| Agent | Authority Level | Escalates To | Scope |
|-------|---|---|---|
| **Jarvis** | Autonomous | (none) | Strategy, pivots, resource allocation, agent conflicts |
| **Friday** | Domain | Jarvis | Engineering, architecture, multi-agent technical disputes |
| **Sam** | **Hard Gate** | Friday | Security audit on all main merges (MANDATORY) |
| **Nat** | Domain | Friday | Market positioning, GTM, pricing, budget allocation |
| **Wanda** | Domain | Friday | Design/UX decisions, design system, accessibility |
| **Threepio** | Domain | Jarvis | Documentation, comms, release notes, announcements |
| Others (Ultron, Astra, Pym, Leo) | Domain | Friday | Backend, frontend, database, DevOps respectively |

### Memory System Access (All CLIs)
Location: `.agents/memory/` (synced to all 3 CLIs via `sync_agents_from_repo.ps1`)

**Leadership Decision Logs:**
- `jarvis.md` — CEO decisions, weekly reviews, critical risks
- `friday.md` — CTO engineering discipline, hard gate constraints
- `sam.md` — CSO security audits, compliance decisions
- `nat.md` — CBO business decisions, revenue/customer log

**How Agents Access Memory:**
1. On any CLI (Claude Code, Gemini, Copilot), read `.agents/memory/[agent].md`
2. Memory syncs automatically after `sync_agents_from_repo.ps1` runs
3. Check memory at session start to pull prior context + decision log
4. Append session outcomes to memory after execution

**Verification:** Compare `.claude/agents/`, `.copilot/agents/`, `.gemini/antigravity-cli/agent/` — all should have identical agent definitions (modulo platform model transforms).

---

## FOR HUMANS: System Setup & Maintenance

### What Was Completed

#### Phase 1: Architecture & Setup
- ✅ Unified agent definition system (single source of truth in `.agents/`)
- ✅ Multi-CLI sync automation (`sync_agents_from_repo.ps1`)
- ✅ 10 agents defined with clear decision authority
- ✅ CLAUDE.md configuration (Claude Code)
- ✅ AGENTS.md roster with authority levels
- ✅ Memory system (`.agents/memory/`)

#### Phase 2: CLI Configuration
- ✅ Claude Code agents (`.claude/agents/`)
- ✅ Copilot CLI agents (`.copilot/agents/`)
- ✅ Antigravity/Gemini CLI agents (`.gemini/antigravity-cli/agent/`)

#### Phase 3: Model Allocation & Startup Optimization
- ✅ Streamlined Jarvis startup: 16 steps → 8 parallel steps (token efficiency)
- ✅ Model promotions: Wanda, Threepio upgraded Haiku → Sonnet (domain reasoning)
- ✅ Weekly cadence: Jarvis Saturday 30m review (all agents, goal scorecard, risks)
- ✅ Platform-specific model assignments per agent workload
- ✅ Sync script model mapping functions fixed (conditional logic)

#### Phase 4: Memory System Unification
- ✅ Created `.agents/memory/` with decision logs for leadership tier (Jarvis, Friday, Sam, Nat)
- ✅ Integrated memory system across all 3 CLIs (Claude Code, Gemini, Copilot)
- ✅ Monthly review templates per agent role
- ✅ Session logging for quarterly audits

---

### Current System State

#### Agent Roster (10 agents)

| Agent | Role | Model | Authority | Escalates To |
|-------|------|-------|-----------|--------------|
| **Jarvis** | CEO | Opus 4.7 | Autonomous | (None) |
| **Friday** | CTO | Sonnet 4.6 | Domain | Jarvis |
| **Nat** | CBO | Sonnet 4.6 | Domain | Friday |
| **Sam** | CSO | Sonnet 4.6 | Hard Gate | Friday |
| **Wanda** | Design | Sonnet 4.6 | Domain | Jarvis |
| **Threepio** | Comms | Sonnet 4.6 | Domain | Jarvis |
| **Ultron** | Backend Dev | Haiku 4.5 | Domain | Friday |
| **Astra** | Frontend Dev | Haiku 4.5 | Domain | Friday |
| **Pym** | Database Dev | Haiku 4.5 | Domain | Friday |
| **Leo** | DevOps | Haiku 4.5 | Domain | Friday |

#### Directory Structure

```
.agents/
├── agents/              # Master definitions (git source of truth)
│   ├── jarvis.md (UPDATED: 8-step startup, weekly cadence)
│   ├── friday.md
│   ├── nat.md
│   ├── sam.md
│   ├── wanda.md (UPDATED: model Haiku → Sonnet)
│   ├── threepio.md (UPDATED: model Haiku → Sonnet)
│   ├── ultron.md
│   ├── astra.md
│   ├── pym.md
│   └── leo.md
├── memory/              # Decision logs, quarterly reviews (NEW)
│   ├── jarvis.md
│   ├── friday.md
│   ├── nat.md
│   └── sam.md
├── rules/               # Shared standards
│   └── ENGINEERING-STANDARDS.md
└── workflows/           # Reusable patterns

.claude/agents/          # Claude Code synced configs (user-level)
.copilot/agents/        # Copilot CLI synced configs (user-level)
.gemini/antigravity-cli/agent/  # Antigravity JSON configs (user-level)

CLAUDE.md               # Claude Code setup
AGENTS.md              # Agent roster + authority
AGENTS-MEMORY.md       # Decision log index
HANDOFF.md            # This file (dual-audience)
```

---

### How the System Works

#### 1. Master Definitions
All agent definitions live in `.agents/agents/` as Markdown files. These are the **single source of truth**.

```markdown
# Example: .agents/agents/jarvis.md

name: Jarvis
model: claude-opus-4-7
description: CEO, autonomous orchestration of all agents, streamlined 8-step startup, weekly cadence review
argument-hint: --skip-mcp, --agenda-only, --focus=[repo-name]
tools: github-cli, gmail, google-calendar, bash, git
behavior: |
  Autonomous decision authority: strategy, pivots, resource allocation...
  Streamlined 8-step startup (parallel checks, batch queries, skip redundancy):
    (1) Read agents-memory/jarvis.md decision log + review schedule
    (2) Run 3 GitHub queries in parallel...
    ...
```

#### 2. Sync Automation
Run `sync_agents_from_repo.ps1` to distribute definitions to all CLIs:

```powershell
# From project root:
powershell -File sync_agents_from_repo.ps1
```

**What it does:**
- Reads 10 agent definitions from `.agents/agents/`
- Copies `.agents/memory/` to all CLI config directories
- Transforms model names per platform (Claude → Gemini, Copilot)
- Writes to `.claude/`, `.copilot/`, `.gemini/` directories
- Validates sync integrity + spot-checks 2 agents

**Auto-sync:** Hook runs after file edits (see CLAUDE.md hooks section).

#### 3. Platform-Specific Models

| Claude Model | Gemini Model | Copilot Model |
|---|---|---|
| claude-opus-4-7 | Gemini 3.1 Pro (High) | 5.2 codex |
| claude-sonnet-4-6 | Gemini 3.5 Flash (High) | 5.2 codex |
| claude-haiku-4-5-20251001 | Gemini 3.5 Flash (Medium) | 5.4 mini |

#### 4. Memory System
All agents can access shared decision logs at session start:

```bash
# All CLIs have access to:
.agents/memory/jarvis.md    # CEO decisions, weekly reviews
.agents/memory/friday.md    # CTO engineering discipline
.agents/memory/sam.md       # CSO security decisions
.agents/memory/nat.md       # CBO business decisions
```

Memory syncs automatically when `sync_agents_from_repo.ps1` runs. Agents append session outcomes for quarterly audits.

---

### Critical Files & Paths

| File | Purpose | Edit? |
|------|---------|-------|
| `.agents/agents/*.md` | Master agent definitions | ✅ Yes — edit here |
| `.agents/memory/*.md` | Decision logs (NEW) | ✅ Yes — for leadership tier |
| `sync_agents_from_repo.ps1` | Sync script | ⚠️ Careful — model mapping logic |
| `.claude/agents/` | Claude Code user config | ❌ No — auto-synced |
| `.copilot/agents/` | Copilot CLI user config | ❌ No — auto-synced |
| `.gemini/antigravity-cli/agent/` | Antigravity user config | ❌ No — auto-synced |
| `.agents/rules/` | Engineering standards | ✅ Yes — governance |
| CLAUDE.md | Claude Code config | ✅ Yes — local setup |
| AGENTS.md | Agent roster | ✅ Yes — reference only |

---

### Essential Commands

#### Sync agents + memory to all CLIs
```powershell
powershell -File sync_agents_from_repo.ps1
```

#### View agent roster
```bash
cat AGENTS.md
cat .agents/agents/jarvis.md
```

#### Access memory system
```bash
cat .agents/memory/jarvis.md      # CEO decisions
cat .agents/memory/friday.md      # CTO discipline
cat .agents/memory/sam.md         # CSO audit log
cat .agents/memory/nat.md         # CBO decisions
```

#### Check engineering standards
```bash
cat .agents/rules/ENGINEERING-STANDARDS.md
```

#### Verify sync integrity
```bash
ls .claude/agents/
ls .copilot/agents/
ls .gemini/antigravity-cli/agent/
```

---

### Git Workflow

#### Edit agent definitions
```bash
git checkout -b feature/agent-update
# Edit .agents/agents/[agent].md or .agents/memory/[agent].md
git add .agents/agents/ .agents/memory/
git commit -m "feat(agents): update [agent] - synced via $CLI"
powershell -File sync_agents_from_repo.ps1
git add .claude/ .copilot/ .gemini/
git commit -m "sync: distribute agent definitions to all CLIs"
git push origin feature/agent-update
```

#### Create PR
- Reviewer: **Friday** (CTO) for architecture
- Hard gate: **Sam** (CSO) for security implications
- Merge to main only after both approve

---

### Troubleshooting

#### Agents not loading in Copilot
**Symptom:** `model: "True" is not available`  
**Cause:** Sync script `Get-CopilotModel()` returning boolean  
**Fix:** Re-run sync script (fixed in v2026-05-20)

```powershell
powershell -File sync_agents_from_repo.ps1
```

#### Claude Code agents have wrong model
**Symptom:** Agent shows Claude Haiku but should show Sonnet  
**Cause:** Master definition `.agents/agents/[agent].md` has wrong model  
**Fix:** Edit master definition and re-run sync

#### Memory not synced to all CLIs
**Symptom:** `.agents/memory/` missing in Claude Code or Copilot config  
**Cause:** Sync script not executed or script failed  
**Fix:** Check sync output, verify `.agents/memory/` has all 4 files

#### Antigravity agents missing
**Symptom:** `.gemini/antigravity-cli/agent/` is empty  
**Cause:** Sync script not executed or script failed  
**Fix:** Check sync output for errors, verify `.agents/agents/` has all 10 files

---

### Known Issues & Limitations

#### Model Name Constraints
- Gemini model names must include full spec: `"Gemini 3.1 Pro (High)"` not `"Gemini 3.1 Pro"`
- Copilot model names must match platform availability (update mapping if new models added)
- Claude names are canonical; others transform from these

#### Sync Timing
- Auto-sync runs on file edit (PowerShell hook in CLAUDE.md)
- If hook fails, manual sync required: `powershell -File sync_agents_from_repo.ps1`
- No continuous sync — changes require explicit sync run
- Memory system syncs alongside agent definitions

#### Multi-Platform Testing
- Test agent load in each CLI after sync (Claude Code, Copilot, Antigravity)
- Verify model field matches platform (check frontmatter/JSON)
- Verify memory files present in all 3 CLI config directories

---

### Weekly Cadence (Jarvis)

**Every Saturday, 30 minutes:**
- [ ] Review all 10 agents for status + blockers
- [ ] Check goal scorecard (quarterly targets)
- [ ] Identify risks >1 week old
- [ ] Append session outcome to `.agents/memory/jarvis.md`

---

### Monthly Deep Reviews

**By Agent (dates TBD):**
- **Friday (CTO):** Engineering discipline audit, hard gate constraints
- **Nat (CBO):** Revenue targets, customer health, GTM effectiveness
- **Sam (CSO):** Threat landscape, vendor audits, compliance readiness
- **Wanda (Design):** Design system consistency, accessibility audit
- **Threepio (Comms):** Documentation currency, release communication

See `.agents/memory/[agent].md` for review templates and decision logs.

---

### Next Steps (For Next Owner)

#### Immediate
- [ ] Verify all 3 CLI platforms load agents without errors
- [ ] Test Jarvis invocation in each CLI
- [ ] Confirm model assignments match platform

#### Near-term (1-2 weeks)
- [ ] Implement first Saturday cadence review (Jarvis)
- [ ] Verify memory system syncs correctly to all CLIs
- [ ] Test cross-agent escalation workflows

#### Medium-term (1-2 months)
- [ ] Add integration tests for sync (verify Claude vs Copilot vs Gemini consistency)
- [ ] Document agent-specific prompt patterns
- [ ] Create incident response runbook for agent failures
- [ ] Run first monthly deep review (pick one agent)

#### Long-term (quarterly)
- [ ] Quarterly security audit (Sam)
- [ ] Quarterly business review (Nat)
- [ ] Quarterly engineering discipline review (Friday)

---

### Emergency Contacts

| Role | Agent | Escalate When |
|------|-------|---------------|
| CEO / Orchestrator | Jarvis | System-wide decisions, strategy shifts |
| CTO / Architecture | Friday | Technical conflicts, architecture |
| CSO / Security | Sam | Security implications, compliance |
| CBO / Business | Nat | Business impact, budget, GTM |

---

### Key Decisions Made

1. **Single source of truth in `.agents/`:** Master definitions here, all CLIs sync from repo.
2. **Model tiering:** Jarvis → best, Friday/Nat/Sam → second-best, others → cost-optimal.
3. **Streamlined startup:** Jarvis 16 steps → 8 parallel steps (reduce token waste, faster startup).
4. **Model promotions:** Wanda, Threepio upgraded to Sonnet (domain reasoning over cost efficiency).
5. **Memory system:** Centralized decision logs synced to all 3 CLIs for context continuity.
6. **PowerShell sync:** Platform-agnostic automation, idempotent, no state drift.
7. **No direct CLI edits:** All agent changes go through `.agents/` + sync, prevents desync.
8. **Hard gate on security:** Sam (CSO) approves all main merges; no exceptions.
9. **Weekly cadence:** Jarvis Saturday 30m review (all agents, goal scorecard, risk scan).

---

### Questions?

Refer to:
- **Agent roles & authority:** AGENTS.md, CLAUDE.md
- **Memory system access:** `.agents/memory/`, this HANDOFF
- **Technical setup:** CLAUDE.md, this HANDOFF
- **Escalation paths:** AGENTS.md (authority column)
- **Engineering discipline:** `.agents/rules/ENGINEERING-STANDARDS.md`
