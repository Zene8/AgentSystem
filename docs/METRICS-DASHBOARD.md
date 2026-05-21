# Agent Performance Metrics Dashboard

**Last Updated:** 2026-05-21  
**Owner:** Friday (CTO)  
**Generated:** Weekly by Friday, posted to `.agents/memory/friday.md`

---

## Metrics Schema

| Metric | Definition | Target | Collection Point |
|---|---|---|---|
| `decisions_per_month` | Total agent decisions logged across all `.agents/memory/*.md` | Trending up (growing system) | Count memory log entries monthly |
| `escalation_pct` | % of decisions that required escalation to higher authority | < 15% | Flag `[ESCALATION]` tag in memory logs |
| `reversal_pct` | % of decisions that were reversed or undone | < 5% | Flag `[REVERSAL]` tag in memory logs |
| `execution_time_p50` | Median time from task assignment to PR open (hours) | < 2h | GitHub PR timestamps vs issue open time |
| `execution_time_p95` | 95th percentile task execution time | < 8h | GitHub PR timestamps vs issue open time |
| `coverage_pct` | % of code with automated test coverage | > 80% | CI test coverage report |
| `bug_escape_rate` | Bugs found in prod per sprint (post-merge issues) | < 2/sprint | GitHub issues labeled `bug` opened after merge |
| `security_incidents` | Security issues found post-merge | 0 | GitHub issues labeled `security` |
| `sync_success_rate` | % of weekly sync jobs completing successfully | > 99% | `.agents/sync.log` success/failure count |
| `sla_compliance_pct` | % of escalations resolved within defined SLA | > 95% | Escalation log timestamps |

---

## Weekly Report Template

**Friday generates and posts to `.agents/memory/friday.md` each week.**

```markdown
## Weekly Metrics Report — [YYYY-MM-DD]

### Decision Volume
- Decisions this week: [N]
- Decisions MTD: [N]
- YTD total: [N]

### Escalations
- Escalations this week: [N] ([%] of decisions)
- Escalation breakdown: Friday [N], Sam [N], Jarvis [N]
- SLA compliance: [%]

### Reversals
- Reversals this week: [N] ([%] of decisions)
- Root cause of reversals: [brief notes]

### Execution Time
- p50: [Xh]
- p95: [Xh]
- Slowest task: [issue #] — [reason]

### Quality
- Test coverage: [%]
- Bug escapes: [N]
- Security incidents: [N]

### Sync Health
- Sync jobs run: [N]
- Sync failures: [N] ([success rate %])

### Flags / Concerns
[Any metric outside target — brief description and owner]

### Next Week Focus
[Top 1-2 engineering priorities]
```

---

## Monthly Trend Dashboard

Track these in a shared spreadsheet (Google Sheets or equivalent) with one row per week:

| Week | decisions | escalation_pct | reversal_pct | p50_hrs | p95_hrs | coverage_pct | bugs | security | sync_rate |
|------|-----------|----------------|--------------|---------|---------|--------------|------|----------|-----------|
| 2026-W21 | _(baseline TBD)_ | — | — | — | — | — | — | — | — |

---

## Baseline Establishment (First Month)

Data collection begins 2026-05-21. First baseline report due 2026-06-20 (Friday's first monthly CTO review).

**Baseline targets:**
- Establish actual p50/p95 execution times from GitHub issue → PR timestamps
- Count all `[ESCALATION]` and `[REVERSAL]` tags in `.agents/memory/*.md` since system launch
- Run coverage check on all repos in scope

**Responsibility:** Friday runs baseline collection as part of the 2026-06-20 monthly review.

---

## Data Collection Points

The following are instrumented as part of the **Jarvis startup ritual** (step 7 of 8):

1. Scan `.agents/memory/*.md` for entries tagged `[ESCALATION]` or `[REVERSAL]` since last weekly report
2. Query GitHub for: issues closed this week, PRs merged this week, issues labeled `bug` opened after a merge
3. Read `.agents/sync.log` for success/failure counts this week
4. Compute elapsed time: issue created → PR merged for closed issues

**Format for memory file tagging:**
```
[ESCALATION] 2026-05-21 — Friday escalated Ultron's DB choice to Jarvis. Resolved: use PostgreSQL.
[REVERSAL] 2026-05-21 — Astra's component approach reversed after Sam flagged XSS risk. New approach: sanitize on server.
```
