---
name: trap-check
description: >
  Pull known domain traps from sona-patterns.md and the standing trap list
  (PowerShell 5.1 syntax, LASTEXITCODE, gh CLI quirks, Windows path escaping)
  before starting a task, and inject them as hard constraints. Triggers on
  "trap check", "what traps apply here", "before I start", "check known
  gotchas", at the start of any task touching shell scripts, CI, or a
  previously-bitten area.
---

## Procedure

1. Identify the domain of the upcoming task (e.g. "PowerShell scripting", "gh CLI automation", "session-namer.js", "git worktrees").
2. Query prior patterns, deterministically:
   ```bash
   node ~/dev/AgentSystem/tools/graph/graph-query.js agentsystem <domain-keywords>
   ```
   and grep the SONA pattern log directly for keyword hits:
   ```bash
   grep -i "<domain-keywords>" ~/agent-memory/nexus/sona-patterns.md
   ```
3. Always check this standing trap list regardless of domain match:
   - **PowerShell 5.1**: no `&&`/`||` — use `A; if ($?) { B }`; no ternary/`??`/`?.`; `2>&1` on native exes wraps stderr and flips `$?` to false even on exit 0 — don't redirect stderr, it's already captured.
   - **LASTEXITCODE**: PowerShell doesn't reset it automatically; check immediately after the command you care about, before any other cmdlet runs.
   - **gh CLI**: `gh pr view` / `gh issue view` fail outside a repo with a remote; wrap in try/catch or check exit code, never assume success.
   - **Git Bash on Windows**: forward slashes only; `\r\n` vs `\n` in written files can break shebangs; quote paths with spaces.
   - **Self-hosted runner SPOF (#115)**: `agent-dispatch.yml`/`sam-audit.yml` silently no-op if the runner is offline — no error, no retry.
4. Output the applicable traps as a short bulleted constraint list before proceeding — do not just silently "keep them in mind."
