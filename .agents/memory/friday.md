> **DEPRECATED (see #117):** this file is not read by any current tool. The live memory system is the graph brain under `~/agent-memory/nexus/` (query via `tools/graph/graph-query.js`). Kept as historical/manual scratch notes only — do not rely on it being current.

# Friday Memory & Engineering Decisions

**Last updated:** 2026-05-20  
**CTO decision log**

---

## Engineering Discipline (Canonical)

See `.agents/rules/ENGINEERING-STANDARDS.md` for full detail. Key enforcement:

- **TDD:** Tests first, code passes them
- **Types:** Type hints everywhere (TypeScript, Python)
- **Validation:** Pydantic at I/O boundaries, input validation at system edges
- **Error handling:** No bare except clauses; specific error context
- **Audit logging:** source_ip, user_agent, request_id in all security-relevant operations
- **PHI discipline:** Never in logs, URLs, or error messages
- **Idempotency:** Mutation operations must be idempotent
- **Field preservation:** Updates never lose fields on round-trip
- **Postconditions:** Verify writes succeeded (check database state after insert/update)

---

## Authority & Gating

**Autonomous within domain:**
- Architecture decisions
- Tech choices
- Shipping timeline
- Quality bar & test requirements

**Hard constraint:** Cannot merge to `main` without Sam (CSO) pre-merge security audit. No exceptions, no overrides. If disagreement with Sam, escalate to Jarvis with documented reasoning.

---

## Monthly CTO Review (Template)

Run on [date TBD, 2026-06-20 first]. Check:
- Engineering backlog velocity
- Architecture health (debt, scaling concerns)
- Test coverage trends
- Deployment incident rate
- Cross-repo technical coordination
- Subdomain agent performance (Ultron, Astra, Pym, Leo)

Document findings in agents-memory/friday.md session log.

---

## Session Log

### 2026-06-30 — AgentSystem infra sprint

**Completed — all merged to main:**

1. **PR #80** `worktree-fix-agent-spawn-patterns` — all 10 agent spawn patterns → `claude --bg --agent X -p "..."`, tier-2 model friday/sam/nat → `claude-sonnet-5`. MERGED.
2. **PR #81** `feat/session-namer` — `tools/session-namer.js`: auto-name + search/group/resume for Claude Code + agy sessions. SessionStart/Stop hooks wired globally. MERGED.
3. **PR #89/#90/#93** — Mission Control docs, rename/memory-onboard commands, robust session-namer. MERGED.

**Global settings changes (not in git, already live):**
- `~/.claude/settings.json`: added `env.CAVEMAN_DEFAULT_MODE=full` + `SubagentStart` hook firing caveman-activate.js
- `~/.config/caveman/config.json`: `{"defaultMode":"full"}` — explicit user config
- Net effect: caveman mode `full` applies to main sessions + all `--bg` agents + in-session subagents (Agent tool)

**Verified 2026-07-02 (system audit):** `~/.claude/agents/*.md` content matches `.agents/agents/*.md` source (spawn-pattern fix confirmed live). `sync.log` last entry is stale (2026-06-03) — sync clearly ran again since (content proves it) but wasn't logged; rerun `node tools/sync-agents.js` to get a fresh log entry. `~/.copilot/agents/` no longer exists (Copilot CLI uninstalled) and `~/.gemini/antigravity-cli/agent/` is also gone — both are dead sync targets now, harmless unless those CLIs come back into rotation.

**Open gaps found in audit:**
- `tools/session-cost.js` and `tools/setup-phone-access.sh` exist on disk, untracked in git — referenced by `~/.claude/CLAUDE.md` but not committed. Needs `git add` + commit or they vanish on a clean clone.
- `~/agent-memory/nexus/personal-brain/user-brain.md` still has template placeholders (`[Your role...]`, `[Primary repos]` etc.) — never filled in. `graph.json` is a 7-line skeleton. Every agent's startup brain-read is a no-op until Nathan fills this in.
- This session's Bash/PowerShell tool env had a broken `PATH` (`%NVM_HOME%`/`%NVM_SYMLINK%` literal, unexpanded) — bare `node` failed, had to call `/c/nvm4w/nodejs/node.exe` directly. Windows registry PATH (User+Machine) is correct; this looks like a stale inherited env in the tool session, not a real system misconfig. Restart the Claude Code app/terminal if it recurs.
