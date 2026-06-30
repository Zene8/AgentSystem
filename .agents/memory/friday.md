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

**Completed (2 PRs open, Sam audit pending):**

1. **PR #80** `worktree-fix-agent-spawn-patterns` — all 10 agent spawn patterns → `claude --bg --agent X -p "..."`, tier-2 model friday/sam/nat → `claude-sonnet-5`
2. **PR #81** `feat/session-namer` — `tools/session-namer.js`: auto-name + search/group/resume for Claude Code + agy sessions. SessionStart/Stop hooks wired globally.

**Global settings changes (not in git, already live):**
- `~/.claude/settings.json`: added `env.CAVEMAN_DEFAULT_MODE=full` + `SubagentStart` hook firing caveman-activate.js
- `~/.config/caveman/config.json`: `{"defaultMode":"full"}` — explicit user config
- Net effect: caveman mode `full` applies to main sessions + all `--bg` agents + in-session subagents (Agent tool)

**Pending:**
- Sam audit on PR #80 + #81 → merge to dev → merge to main
- `node tools/sync-agents.js` after PR #80 merges (to propagate spawn pattern fixes to `~/.claude/agents/`)
