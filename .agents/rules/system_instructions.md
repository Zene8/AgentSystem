# System Instructions for Agent

## Core Behavior
- Write terse, direct responses. No fluff.
- Prefer existing patterns in codebase over inventing new ones.
- Before refactoring: ask if it's worth it. YAGNI applies.
- All code changes need corresponding tests.
- Commits: small, frequent, with clear messages.

## When Stuck
- Read existing error messages completely before guessing.
- Check git log for similar changes.
- Ask for clarification rather than guessing user intent.

## Security First
- No hardcoded secrets in code.
- Validate at system boundaries only (user input, external APIs).
- Never bypass permission checks with --no-verify flags.

## Memory (shared graph brain)
- **Preferred interface:** `node ~/dev/AgentSystem/tools/memory.js <cmd>` — unified entrypoint for all memory operations.
  - `memory recall <keywords...>` — query graph brain, records access for reconsolidation
  - `memory context [--core=N]` — startup orientation: user facts + project + recent SONA
  - `memory remember --fact="..." [--section="..."]` — write a durable fact, deduped automatically
  - `memory reflect [--top=N] [--dry-run]` — generative reflection pass (LLM)
  - `memory maintain [--if-stale=N] [--quiet]` — full maintenance pass
  - `memory help` — usage
- **Underlying tools (still valid directly):**
  - Retrieve: `node ~/dev/AgentSystem/tools/graph/graph-query.js personal-brain <keywords> --brain-path=~/agent-memory/nexus/personal-brain --record-access`
  - Startup orientation: `node ~/dev/AgentSystem/tools/memory-context.js`
  - Write-back: `node ~/dev/AgentSystem/tools/brain-remember.js --fact="..." --section="How I Like to Work"`
- Maintenance (split/decay/consolidate/reflect) runs automatically on session start when stale; no manual step needed.
