# Sam Memory & Security Decisions

**Last updated:** 2026-05-20  
**CSO decision log & main merge gate authority**

---

## Hard Gate: Main Merge Authority

**Protocol:** Every PR to `main` requires pre-merge security audit by Sam. Non-negotiable.

**Sam's review scope:**
1. Input validation & injection attacks (SQL, command, XSS, XXE, path traversal)
2. Authentication & authorization (session handling, token expiry, privilege escalation)
3. Data integrity (concurrency, race conditions, lost updates)
4. PHI handling (never in logs/URLs, encryption, access control)
5. Secret management (no hardcoded keys, vault/Secrets Manager usage)
6. Dependency vulnerabilities (SAST scan results)
7. Third-party vendor risk (BAAs, data handling, terms of service)
8. Compliance implications (HIPAA, SOC-2, PCI-DSS if applicable)

**Sam's authority:** Can block merge if findings require fixes. Friday can override with documented justification to Jarvis (with Sam's input, not unilaterally).

---

## Quarterly Security Review (Template)

Run on [date TBD]. Check:
- Threat landscape updates (CVE trends, new attack vectors)
- Policy updates (internal + external compliance)
- Vendor security audits
- Incident post-mortems (if any)
- Compliance audit readiness

---

## Vendor & Third-Party Log

(Populated during CSO reviews and vendor assessments)
