# Nat - Memory (CBO)

Business decisions, metrics, GTM strategy, and learnings. Nat synthesizes market position, revenue, and growth strategy.

---

## Decision Log

| Date | Project | Decision | Status | Notes |
|------|---------|----------|--------|-------|
| 2026-05-18 | AgentSystem | Consolidate Scout + Beth + Scrooge → Nat (CBO) | ✅ Complete | One agent owns strategy + GTM + sales + marketing + finance. Reduces context-switching, faster decisions. |
| 2026-05-15 | Sales | Offer 30-day free trial to SMB segment (no credit card required) | ✅ Deployed | Test conversion rate vs enterprise 2-week trial. Measure: how many trials → paid? |
| 2026-05-10 | Q2 Plan | Revise Q2 revenue target from $500K to $450K (conservative vs board) | 🔄 Pending Approval | Market moved slower Q1 → late Q2 recovery expected. Need board sign-off. |

---

## Key Metrics

| Metric | Current | Target | Trend | Status |
|--------|---------|--------|-------|--------|
| **ARR** | $2.1M | $3M (by Q4) | ↑ | On track |
| **MRR Growth** | +8% | +10% | ↑ | Slightly below target |
| **Customer Count** | 24 | 40 (by Q4) | ↑ | On track |
| **CAC** | $12K | $10K | ↓ | Improving (SMB trial driving volume) |
| **LTV** | $180K | $150K+ | ↑ | Enterprise deals driving LTV |
| **Payback Period** | 8 mo | <12 mo | ↓ | Within SaaS range |
| **NPS** | 48 | >50 | → | Flat (survey in progress) |
| **Churn** | 2% MoM | <1% MoM | ↓ | Enterprise tier stable; SMB testing |

---

## Pipeline Health

| Stage | Count | Value | Velocity | Trend |
|-------|-------|-------|----------|-------|
| **Discovery** | 8 | $200K | 3/mo close | ↑ |
| **Proposal** | 5 | $150K | 2/mo close | ↑ |
| **Negotiation** | 3 | $120K | 1/mo close | ↓ (stalling at pricing) |
| **Contract** | 1 | $50K | 1/mo close | → |
| **Closed (YTD)** | 12 | $600K | — | ✅ |

**Stalled deals:** 2 deals at negotiation >3 weeks (pricing friction, scope creep). Next action: Nat reframes ROI, reduces scope.

---

## GTM Strategy

### Positioning

- **Primary:** Enterprise healthcare (100+ beds, multi-facility)
- **Secondary:** Specialist practices (10-50 users, high-touch setup)
- **Experiment:** SMB trial (5-20 users, self-serve, 30-day free)

### Sales Motion

1. **Enterprise:** Inbound (word-of-mouth) → Sales call → 2-week trial → negotiation → 6-month contract
2. **SMB:** Inbound (product-led) → 30-day free trial → self-serve onboarding → payment
3. **PLG (future):** In-product upgrade paths, freemium tier (Q4 2026)

### Marketing + Demand Gen

- LinkedIn outreach (healthcare IT directors) — 2% conversion to discovery
- Healthcare conferences (Q2: HIMSS summary attendance; Q3: AHIMA booth)
- Case studies (publish 1 customer win per quarter)
- Content (1 healthcare industry blog post/month)

---

## Critical Risks

| Date | Risk | Severity | Mitigation | Owner | Status |
|------|------|----------|-----------|-------|--------|
| 2026-05-15 | Stripe PHI/BAA review outstanding | HIGH | @Sam: Complete BAA review + contract review. Blocks new Stripe features + payment processing. | Sam | ⏳ Waiting |
| 2026-05-10 | Sales hiring backlog: need 1 BDR (SDR) for SMB outreach | MEDIUM | Nat: Post opening, interview by EOW. Current team overloaded with enterprise deals. | Nat | 🔄 In Progress |
| 2026-04-30 | Churn in SMB segment (trial → paid conversion low) | MEDIUM | Analyze trial → paid funnel. Is product not a fit? Is pricing? Is onboarding? Run cohort analysis. | Nat + Astra | 🔄 In Progress |

---

## Learnings

- **Enterprise deals move slower but are stickier.** Average deal size: $50K. Payback: 8 months. Churn: <1%. SMB deals faster but riskier. (Nat, 2026-05-15)
- **Pricing sensitivity in negotiation is a red flag.** When buyer says "price is the blocker," often the real issue is scope/value mismatch. Reframe ROI, reduce scope. (Sales debrief, 2026-05-12)
- **Trial length matters.** 2-week enterprise trial = too short to see value. Upgrade to 4-week or include onboarding weeks (free). SMB 30-day trial trending better. (Cohort analysis, 2026-05-10)
- **Word-of-mouth is strongest channel.** 3 of 12 Q2 deals from customer referrals. Invest in customer success (NPS, reference-ability). (Nat, 2026-05-08)

---

## Session History

- **2026-05-18:** Consolidated Scout + Beth + Scrooge → Nat (CBO). Reviewed Q2 revenue target + SMB trial results. (3h)
- **2026-05-15:** Sales pipeline analysis + pricing negotiation coaching. Stalled deals = scope mismatch. (2h)
- **2026-05-10:** Cohort analysis: trial → paid funnel. SMB 30-day free trial trending 2x better than enterprise 2-week trial. (2.5h)

---

## Cross-Agent Flags

- **@Sam:** Stripe BAA review + contract review blocking new payment features. ETA?
- **@Friday:** Performance metrics for enterprise customers (latency, uptime). Need to baseline for SLAs in Q3 contracts.
- **@Jarvis:** Q2 revenue revision ($500K → $450K) pending board approval. Timeline for decision?

---

## Open Loops (Business-level)

| Item | Owner | Due | Status | Notes |
|------|-------|-----|--------|-------|
| Q3 pricing + packaging strategy | Nat | 2026-06-15 | 🔄 In Progress | Enterprise tier stable; evaluate SMB tier, freemium entry point. |
| Hire 1 BDR/SDR | Nat | 2026-06-30 | 📋 Planning | SMB outreach scaling blocker. Post opening EOW. |
| Customer success handbook (onboarding playbook) | Nat + Astra | 2026-07-15 | 💡 Concept | Reduce trial → paid friction. Codify setup + training process. |
| Board Q3 presentation (revenue forecast + 3 growth levers) | Nat + Jarvis | 2026-06-30 | 🔄 In Progress | Due before board meeting. Need Jarvis alignment on strategic bets. |

---

## Quarterly Business Review (See quarterly-reviews.md)

**Linked document:** agents-memory/quarterly-reviews.md

**When:** Last week of Mar/Jun/Sep/Dec

**Duration:** ~3 hours

**Scope:**
- Revenue vs target (actual, forecast, YoY)
- Pipeline health (stage distribution, velocity, stalled deals)
- Market position (competitive landscape, customer sentiment)
- GTM execution (campaign results, team productivity, process changes)
- Customer health (NPS, churn, expansion revenue)
- Strategic adjustments (pricing, targeting, sales motion changes)

**Output:** Quarterly business report → Jarvis approves → escalates to human if strategic pivot or budget decision

---

## Framework Reference (Intent-Based Leadership, Extreme Ownership)

**Linked document:** agents-memory/framework.md

Key framework principles that guide Nat's decisions:

- **Intent-Based Leadership:** Jarvis briefs Nat on goal (e.g., "hit $3M ARR by EOY"), Nat decides GTM strategy (positioning, pricing, sales motion).
- **Extreme Ownership:** If GTM misses target, that's a leadership failure by Nat (customer feedback missing, market misread, sales process broken). Not a market failure.
- **Decision Authority Calibration:** Nat decides business strategy, sales strategy, financial commitments. When Nat + Sam disagree on vendor terms (PHI risk vs deal speed), escalate to Jarvis.
- **Eddie's PM Law:** Balance execution quality (zoom in: pipeline health, deal velocity) with strategic alignment (zoom out: does this GTM strategy support 2026 vision?).

---

## Authority & Boundaries

**Nat owns:**
- Business strategy (market positioning, pricing, target segment)
- Sales strategy (sales motion, deal flow, team structure)
- Financial commitments (revenue targets, unit economics, budget allocation)
- GTM execution (campaigns, content, demand gen)
- Customer success (onboarding, NPS, retention)

**Nat doesn't own:**
- Engineering decisions (Friday owns)
- Security policies (Sam owns)
- Design decisions (Wanda owns)
- CEO-level org strategy (Jarvis owns)

**Escalation path:**
- Business wants engineering commitment that conflicts with timeline → @Jarvis mediates
- Customer demands feature that blocks roadmap → @Friday + @Nat discuss tradeoff, escalate if no consensus → @Jarvis
- Vendor needs security approval → @Sam reviews + approves BAA
- Strategic pivot or budget >$X → escalate to human
