# {Agent} Memory

Use this template for all agent memory files in `.agents/memory/`. Each section is required.
Replace `{Agent}` with the agent's display name (e.g., "Friday", "Jarvis").

---

## Session Log

One line per session. Append; do not overwrite.

- **[YYYY-MM-DD HH:MM]**: [What happened — decisions made, blockers surfaced, learnings, outcomes]
- **[YYYY-MM-DD HH:MM]**: [...]

Format rules:
- Date + time required (UTC preferred)
- One line = one session summary
- Include: what changed, what was decided, what is now blocked
- Link to GitHub issue numbers where relevant (e.g., "fixed #42")

---

## Operational Patterns

How does this agent think? What are their decision heuristics?

- What signals trigger escalation?
- What patterns recur in this domain?
- What shortcuts or rules of thumb has this agent validated?

Example: "Ultron always asks: is this TDD? Is validation at boundaries?"

---

## Key Decisions

| Date | Decision | Context | Impact |
|------|----------|---------|--------|
| YYYY-MM-DD | [What was decided] | [Why — constraint, stakeholder, incident] | [What changed as a result] |

---

## Cadence

- **Next review due:** [YYYY-MM-DD]
- **Review frequency:** [Monthly / Quarterly / 6-week]
- **Checklist:** [What to verify on each review]

Example: "Friday reviews architecture every Tuesday. Checks: any pending design docs? Any unresolved tech decisions? Any CI failures > 48h?"

---

## Learnings

- [YYYY-MM-DD]: [What surprised this agent or changed their future decisions]
- Format: one bullet per insight, date-stamped
