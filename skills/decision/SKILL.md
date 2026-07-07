---
name: decision
description: >
  Record a decision with rationale and rejected alternatives via
  tools/decision-log.js (and the repo graph). Triggers on "log this
  decision", "record why we chose X", "decision", after any architecture or
  cross-cutting choice that a later task might contradict or need to cite.
---

## Procedure

1. **Write the decision** — one line: what was chosen.
2. **Write the rationale** — why, in terms a future agent can act on (not just "seemed best").
3. **Note rejected alternatives** — what else was considered and why it lost; this is what prevents relitigating the same choice later.
4. Record it:
   ```bash
   node tools/decision-log.js --write \
     --title="<short decision title>" \
     --decision="<what was decided>" \
     --rationale="<why, and what was rejected and why>" \
     --agent=<YourAgentName>
   ```
5. Before recording, always check for a conflicting prior decision:
   ```bash
   node tools/decision-log.js --search --query="<keywords>"
   ```
   If a matching decision already exists and contradicts the new one, surface the conflict to the user rather than silently overwriting — decisions are appended, not edited.
6. If the decision affects the shared repo graph (e.g. a new architectural edge between modules), also run `node tools/graph/graph-weight.js visit agentsystem <source> <target>` so future graph queries surface it.
