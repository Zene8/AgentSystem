# AgentSystem

## Agent Management
- Edit: `.agents/agents/<name>.md`
- Sync to all CLIs: `node tools/sync-agents.js`
- Verify: check `.agents/sync.log` for ERROR lines

## Agent Roster
Jarvis (CEO/orchestrator), Friday (CTO/engineering), Sam (CSO/security — hard gate on main merges), Nat (CBO/business), Ultron (backend), Pym (database), Leo (DevOps), Astra (frontend), Wanda (design), Threepio (docs/comms), r2d2 (general technical fallback). Definitions: `.agents/agents/<name>.md`.

## Memory
Root: `~/agent-memory/nexus/` — shared across Claude, Gemini, Antigravity
- Write fact: `node tools/brain-remember.js --fact="..." [--tier=agent --target=<name>]`
- Query: `node tools/graph/graph-query.js <brain> <keywords>`
