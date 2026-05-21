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
