---
name: cost-review
description: >
  Weekly spend review by category using session-cost.js — trend line plus
  one concrete recommendation. Triggers on "cost review", "how much are we
  spending", "weekly spend", "cost-review", "/cost-review".
---

## Procedure

1. **Pull the numbers**, deterministically, no estimation:
   ```bash
   node ~/dev/AgentSystem/tools/session-cost.js --week
   node ~/dev/AgentSystem/tools/session-cost.js --top
   ```
2. **Categorize** the top sessions by agent name (Jarvis/Friday/Sam/etc.) and by repo (from session names) — sum cost per category from the raw output, don't guess proportions.
3. **Trend** — compare this week's total to the prior week if available (`--week` run against last week's log window, or diff against a saved snapshot in `~/agent-memory/nexus/` if one exists); note direction (up/down/flat) and the biggest mover.
4. **One recommendation** — pick the single highest-leverage change (e.g. "route routine renames to a haiku-tier worker instead of opus," "the top 3 sessions are all one repo's swarm fan-out — consider the 3-module swarm-sizing rule"). Exactly one, not a wishlist.
5. Report: total spend, top 3 cost drivers, trend direction, and the one recommendation. Keep it to a short paragraph plus the raw numbers — don't editorialize beyond the one recommendation.
