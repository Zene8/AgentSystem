# Memory & Routing Redesign — Research + Design Doc

**Author:** Friday (CTO), Jarvis oversight · **Date:** 2026-06-03 · **Status:** Design — no code yet
**Scope:** Two independent workstreams — (A) agent memory system, (B) lightweight routing.

---

## 0. TL;DR — the reframe

The starting premise was "memory is inefficient by design: collection, retention, and retrieval are all broken — rebuild it." **The evidence contradicts that.** The cognitive architecture already exists and is good. The failures are **wiring and usage**, not design. Rebuilding would violate your own rule (*"don't rebuild things that already exist"*).

**Empirical anchor.** Same "who am I" lookup, two ways:

| Path | Tokens |
|------|--------|
| Jarvis subagent (what actually happened) | **47,129** |
| `graph-query personal-brain "who am I identity"` (the path that should run) | **~110** (427 chars) |

~400×. The efficient retrieval returned exactly the right nodes (`solo-founder-developer`, `subscriptions`, `primary-repos`, `communication-style`, `architecture-delegation`). The machinery works. It is not being invoked.

**The real problem is three unwired connections + one stale data store**, detailed below.

---

## 1. Current-state audit

### 1.1 What already exists and is good (`tools/graph/graph-lib.js`)

| Human-memory faculty | Implementation | Where |
|---|---|---|
| Relevance ranking | BM25 (k1=1.5, b=0.75) | `graph-query.js:28-44` |
| Forgetting curve | Ebbinghaus decay, 30-day half-life, hub nodes decay slower (degree-centrality) | `graph-lib.js:98-106` |
| Associative recall | Spreading activation, 3-hop, lateral inhibition (top-7/hop) | `graph-lib.js:233-298` |
| Confidence / belief | Bayesian posterior with Laplace smoothing | `graph-lib.js:111-131` |
| Importance | `computeSalience()` — incident severity, duration, first-solve | `graph-lib.js:176-183` |
| Context-aware ranking | Mode weight profiles (debugging/architecture/routine/incident) | `graph-lib.js:18-24` |
| Priming | `--primed` adds bonus to neighbors of active nodes | `graph-query.js` |

This is a credible cognitive model — it independently implements the things the human-memory literature says matter (§2).

### 1.2 What is WIRED vs ORPHANED

**Wired (invoked by an agent def, cron, or tool):** `graph-lib`, `graph-query` (`--hot-stub` in agent startups), `graph-init`, `memory-lookup`, `memory-search`, `memory-decay` (cron), `memory-stale` (cron), `compute-trust-scores` (cron), `personal-brain-split` (cron), `known-repos`.

**Orphaned (exists, nothing calls it):** `graph-weight`, **`graph-consolidate`** (the episodic→semantic distiller — never scheduled), `memory-embed`, `memory-reinforce`, **`sona-append`** (the write-back tool — no hook calls it), **`decision-log`**, **`task-scratchpad`**, `agent-brain-seed` (manual only).

### 1.3 The four concrete defects

1. **Retrieval not invoked + a path bug.** The efficient query exists but agents `ls`+`read` flat files instead. Worse: Jarvis's own startup command (`jarvis.md:79,128,132`) queries `--brain-path=~/agent-memory/nexus` → looks for `nexus/graph.json`. The graph is actually at `nexus/personal-brain/graph.json`. **The documented command errors every time.**

2. **Personal brain was never populated as a graph.** `personal-brain-split.js` existed but the `nodes/` directory did not exist until it was run manually today (→ 37 nodes, 31 edges). The "Monday 8am" cron in `scheduled-tasks.yml:25-33` is on a **`self-hosted` runner that has not been executing** (nodes absent despite the schedule). So even the wired consolidation isn't actually running.

3. **No automatic write-back.** `sona-append.js`, `decision-log.js`, `task-scratchpad.js` are all orphaned. Nothing captures facts *during* a session. That is why "the breakdown of me isn't detailed" — collection is manual, and `user-brain.md` was last hand-edited 2026-05-27.

4. **No episodic→semantic consolidation in the cycle.** `graph-consolidate.js` (distills outcome clusters → `reasoning-bank.md`) is orphaned. No importance score is written at encode time (`computeSalience` is never called during writes). No per-project read scoping — queries cross-contaminate across repos.

---

## 2. Human memory — model & transferable principles

Sources are cited inline; full list in §6. Load-bearing claims anchored to primary papers.

| Faculty | How it works in humans | Transferable principle |
|---|---|---|
| **Tiers** | Working (~4 chunks, Cowan [6]), episodic (events), semantic (facts), procedural (skills) — distinct stores [1][4] | Keep separate tiers: bounded working set + episodic log + semantic facts + procedural playbooks |
| **Encoding** | Attention + salience gate what sticks; arousal tags priority items, *impairs* low-priority ones [8][9][12] | Score each event for importance/goal-relevance **at write time**; don't store everything equally |
| **Consolidation** | Sleep replays episodes, abstracts gist, transfers episodic→semantic ("semantization") [13][14][15] | Run an offline "sleep" pass that distills recurring episodes into semantic facts |
| **Reconsolidation** | Recalled memories become labile and are re-saved — they change on retrieval [14][17] | Rewrite/refine entries on access, not append-only freezing |
| **Retrieval** | Cue-dependent; spreading activation; **need-probability** = frequency × recency × pattern (Anderson & Schooler [25][26]) | Rank by relevance × associative links × need-probability — not similarity alone |
| **Forgetting** | Ebbinghaus power-law curve [23][24]; adaptive — discards low-need items so recall stays cheap; spacing effect strengthens on review | Decay low-need memories (prune for relevance, not just age); strengthen on each access |

**The single most transferable idea — need-probability (Anderson & Schooler [25][26]):** encoding strength, retrieval rank, and forgetting are all downstream of one estimate — *"how likely is this to be needed again?"* — computed from importance at write time + frequency/recency at access. Get that score right and the other behaviors largely follow. The graph already has the inputs (visit_count, decay, confidence); it does not yet combine them into an explicit need score at encode.

---

## 3. Best agent-memory systems — patterns to steal

| System | One key idea | Relevance to us |
|---|---|---|
| **MemGPT / Letta** [arXiv 2310.08560] | Self-editing memory blocks with hard char budgets; agent curates an always-in-context summary via tool calls | Gives agents a hot-path write tool — fills our write-back gap |
| **mem0** [arXiv 2504.19413] | Every new fact reconciled vs neighbors → **ADD / UPDATE / DELETE / NOOP** before writing | Prevents contradiction buildup; our `memory-reinforce` is the half-built version |
| **Generative Agents** [arXiv 2304.03442] | Retrieval = **recency × importance × relevance**; periodic **reflection** abstracts episodes into insights | The reference salience model; we have recency+relevance, missing importance-at-write + reflection |
| **A-MEM** [arXiv 2502.12110] | **Memory evolution** — new writes retroactively update linked old notes | Our graph edges approximate this; evolution step is missing |
| **Zep / Graphiti** [arXiv 2501.13956] | **Bi-temporal edges** — supersede facts (invalidate, don't delete); reason about what was true *when* | Upgrade path for conflict resolution that preserves history |
| **Claude memory tool** [docs.claude.com] | File-directory memory + **context editing** evicts stale in-context junk while model spills durable state to files | Native pattern; pairs with our file-based nodes |
| **LangMem / LangGraph** | Explicit semantic/episodic/procedural split; **hot-path + background** dual write modes | Names the tiering and the two-speed write-back we should adopt |

**Recurring patterns across all of them:**
1. **Dual write-back** — cheap hot-path capture during the turn + heavier async/background processing.
2. **Consolidation pass** — reconcile new facts against neighbors, abstract episodic→semantic, *supersede don't delete*.
3. **Importance/salience at encode** — Generative Agents' explicit score is the cleanest.
4. **Layered scoping** — `session → user → agent/project → global`; session ephemeral, user/global durable.

**Verdict:** every pattern the best systems add sits *on top of* primitives we already have. This confirms wire-up, not rebuild.

---

## 4. Proposed architecture — Memory (Workstream A)

Reuse all of `graph-lib`. Add the four missing connectors.

### A1. Encode — automatic write-back (fills gap #3)
- **Hot path:** a `Stop`/`SubagentStop` hook calls `sona-append.js` (already built, orphaned) to capture `{task, files, outcome, agent}` at task end. Plus wire `decision-log.js` for architectural decisions.
- **Importance at write:** call `computeSalience()` (already in `graph-lib.js:176`) during encode and persist the score on the node — so retrieval can use a true `need-probability` term (§2).
- Borrowed from: MemGPT hot-path, Generative Agents importance-at-write.

### A2. Consolidate — the "sleep" cycle (fills gaps #2, #4)
- **Fix the runner first** — the `self-hosted` cron in `scheduled-tasks.yml` isn't running; until it does, no scheduled memory work happens. Either register the runner reliably or move these to a local Windows Task Scheduler job.
- **Add `graph-consolidate.js` to the cycle** (currently orphaned): cluster recent episodic outcomes → promote to semantic nodes in `reasoning-bank.md`.
- **Add a reconciliation step** (mem0 ADD/UPDATE/DELETE/NOOP) using the existing `memory-reinforce.js` Bayesian update + dedupe by keyword overlap.
- Borrowed from: Generative Agents reflection, mem0 reconciliation, human systems-consolidation.

### A3. Retrieve — actually invoke it (fills gap #1)
- **Fix the `--brain-path` bug** in `jarvis.md` (and any agent that copied it): `…/nexus/personal-brain`, not `…/nexus`.
- Make `graph-query --hot-stub` (+ keyword query) the **standard** identity/context load — not `ls`+`read`. ~110 tokens vs 47k.
- Add the `need-probability` term (recency × frequency × importance) to the composite so ranking matches §2.

### A4. Scope — three-layer read (fills gap #4)
- Standard startup loads, merged: **global user brain** (who Nathan is) + **active-project brain** (this repo's graph) + **recent episodic** (last N session outcomes).
- Borrowed from: mem0 `user_id/agent_id/run_id`, LangMem namespaces. The per-repo and per-agent graphs already exist; this just composes them at query time with project awareness.

---

## 5. Proposed architecture — Lightweight Router (Workstream B)

**Decision:** lightweight router + keep Jarvis. **Independent of memory work — do not couple them.**

**Harness facts (authoritative):**
- There is **no** way to make a subagent the literal default entry that intercepts the first message. "Jarvis is the default entry agent" is unenforceable prose.
- `SessionStart` / `UserPromptSubmit` hooks can only **inject context** — they cannot reroute or rewrite the prompt.
- Subagents do **not** inherit MCP servers or the parent context by default; cost comes from the agent's own `mcpServers` list + tools + its exploration. The 47k was Jarvis loading 4 MCP servers + a 9-step startup ritual for a trivial question.

**Recommended design (combine two cheap mechanisms):**
1. **`UserPromptSubmit` hook** — fast local classifier (regex/keyword on the prompt) injects a routing hint: trivial/identity/lookup → "answer inline from `graph-query`"; domain work → Friday/etc.; genuine cross-domain/CEO → Jarvis. ~0 token cost.
2. **Jarvis def + a `router` discipline** — rewrite Jarvis's "default entry" prose into "invoke only for genuine cross-domain/CEO work; trivial questions answered inline." Optionally a Haiku-tier `router` subagent (no MCPs, Read/Grep/Glob only) for nuanced cases (~2-3k tokens, still ~15× cheaper than 47k).
3. **Make Jarvis cheap on trivial paths** — don't load 4 MCP servers and run the 9-step ritual to answer "who am I." Gate the startup ritual behind actual orchestration tasks.

Target: trivial query **47k → ~1-2k tokens**.

---

## 6. Phased plan (no code until approved)

**Workstream B (router) — small, do first, unblocks the token bleed:**
- B1. Fix `--brain-path` bug in `jarvis.md`. *(verify: query returns nodes, not "No graph")*
- B2. `UserPromptSubmit` classifier hook + rewrite Jarvis entry prose. *(verify: "who am I" answers <2k tokens)*

**Workstream A (memory) — wire up, in order:**
- A0. Fix/replace the self-hosted cron so scheduled jobs actually run. *(verify: nodes regenerate on schedule)*
- A1. `Stop`-hook write-back via `sona-append` + `decision-log`; persist `computeSalience` at encode. *(verify: a session writes an episodic node)*
- A2. Add `graph-consolidate` + reconciliation to the weekly cycle. *(verify: reasoning-bank grows from real outcomes)*
- A3. Add `need-probability` term to composite; make `graph-query` the standard load. *(verify: ranking surfaces recent+important first)*
- A4. Three-layer scoped read at startup. *(verify: project query doesn't return unrelated-repo nodes)*

**Explicitly NOT doing:** rebuilding `graph-lib`, replacing BM25/decay/spreading-activation, adopting a new framework, or adding npm deps (per your zero-dep rule).

---

## 7. Sources

**Human memory:** Cowan 4-chunk [PMC2864034]; Miller 7±2; Anderson & Schooler, *Reflections of the Environment in Memory* [users.cs.northwestern.edu/~paritosh/papers/KIP/AndersonSchooler1991…]; Schooler & Anderson, *Adaptive Nature of Memory* [act-r.psy.cmu.edu]; Ebbinghaus forgetting curve [en.wikipedia.org/wiki/Forgetting_curve]; Wixted & Ebbesen power-law [PLOS ONE 10.1371/journal.pone.0120644]; systems consolidation & sleep [PMC3278619; Cell Neuron S0896-6273(15)00761-8; S0896-6273(23)00201-5]; reconsolidation [PMC2680680]; spreading activation [PMC5664228; bioRxiv 778563]; emotion/arousal encoding [PNAS 0506308103; eNeuro 0108-18.2019].

**Agent systems:** MemGPT [arXiv 2310.08560; letta.com/blog/memory-blocks]; mem0 [arXiv 2504.19413; docs.mem0.ai]; Generative Agents [arXiv 2304.03442; ACM 3586183.3606763]; A-MEM [arXiv 2502.12110]; Zep/Graphiti [arXiv 2501.13956; neo4j.com/blog/developer/graphiti-knowledge-graph-memory]; Claude memory tool & context management [docs.claude.com/en/docs/agents-and-tools/tool-use/memory-tool; anthropic.com/news/context-management]; LangMem/LangGraph [rywalker.com/research/langmem].

**Harness:** Claude Code hooks [code.claude.com/docs/en/hooks-guide]; subagents [code.claude.com/docs/en/sub-agents].

**Internal:** `tools/graph/graph-lib.js`, `graph-query.js`; `tools/personal-brain-split.js`; `tools/sona-append.js`, `decision-log.js`, `graph-consolidate.js` (orphaned); `.github/workflows/scheduled-tasks.yml`; `.agents/agents/jarvis.md`.
