# Unified Memory Onboarding — Auto-Classify + Immediate Link — Design Spec
**Date:** 2026-07-02
**Status:** Approved

## Problem

`/onboard-memory` (`tools/memory-onboard.js`) can already take a pasted block of text, LLM-extract
discrete facts (`memory-capture.js`), and write them — but only ever into the **personal brain**
(`brain-remember.js`'s `remember()` is hardcoded to `user-brain.md` → `personal-brain-split.js` →
`personal-brain/nodes/*.md`). There is no way to onboard a paste that's actually about a repo
(e.g. "AgentSystem always branches from dev") or about a specific agent's learned pattern
(e.g. "Friday should always check trust score before spawning Ultron") — it all lands in the
personal brain regardless of subject.

Two further gaps found auditing this path (2026-07-02 session):
1. **`wikilink-sync.js`** — the step that writes the visible `connections: [[nodeA]]` backlinks
   between related node files — already accepts an arbitrary `--brain-path=` (not hardcoded, as
   first assumed during design; verified in code before writing this spec). It is simply never
   *invoked* except from the weekly `memory-maintenance.js --reflect` cron (Monday 08:00, Windows
   Task Scheduler). A fresh paste today chunks into nodes immediately (`personal-brain-split`
   already runs synchronously inside `remember()`) but shows no links between those chunks until
   next Monday — this is a wiring gap (nobody calls it sooner), not a missing feature.
2. **Repo brains are mostly uninitialized.** `known-repos.json` claims `bootstrap_complete: true`
   for `agentsystem` (and others), but `~/agent-memory/nexus/agentsystem/` does not exist on disk.
   The repo-brain tier is registered but non-functional until `graph-init.js` is actually run.

## Non-goals

- No input-side chunking/map-reduce over the pasted text itself. Confirmed with user: typical
  pastes are small-medium (a message, a doc, <5k words) — one LLM extraction call over the whole
  blob is sufficient, matching today's behavior. Large-transcript windowing is out of scope.
- `--fact=` mode is unchanged: still a direct, LLM-free write to personal-brain. Auto-classify
  only applies to the "paste a wall of text" paths (`--text=`, `--session=`, stdin) — `--fact=`'s
  entire purpose is a fast manual write with no extraction step, and classifying a single
  hand-authored fact would add LLM latency to the one mode designed to avoid it.
- No changes to `graph-lib.js` primitives (BM25, decay, spreading activation, salience, Bayesian
  confidence, reconciliation logic) — all reused as-is per `docs/memory-and-routing-redesign.md`'s
  "wire up, don't rebuild" verdict.

## Design

### Routing decision (why full auto-classify, approach A)

Three approaches were weighed for the new classify step:

- **A — single combined LLM call** (chosen): extend the extraction prompt to output
  `{fact, tier, target}` tuples directly, given the known-repo list + agent roster as context.
  One LLM call total, same cost/latency as today.
- **B — two-pass** (extract, then classify each fact): safer isolation, doubles LLM calls.
- **C — heuristic-first, LLM-fallback**: regex-match repo/agent names, zero added LLM calls,
  but misses facts that don't literally name their target.

Chosen **A** because every LLM call in this pipeline (`memory-capture.js`, `memory-onboard.js`,
`memory-reconcile.js`) already shells out to `claude -p "..."` — the user's existing Claude Code
plan, not a metered API key. There is no cost-avoidance reason to prefer C, and A is the smallest
diff (extends an existing prompt/parser pair) with the least new surface area.

### Components

**`tools/memory-classify.js`** (new, mirrors `memory-capture.js`'s shape):
- `buildClassifyPrompt(text, { repos, agents })` — `repos` from `known-repos.js` (slug list),
  `agents` a fixed roster (`jarvis, friday, sam, nat, ultron, pym, leo, astra, wanda, threepio,
  r2d2`). Prompt instructs the LLM to emit one JSON object per line:
  `{"fact": "...", "tier": "personal"|"repo"|"agent", "target": "<slug-or-name>"}`
  (`target` empty string when `tier` is `personal`). Unknown/hallucinated `target` values are
  handled by the parser, not the prompt (see Error handling).
- `parseClassifiedFacts(raw)` — parses line-by-line, skips malformed lines (same tolerance as
  existing `parseCaptureFacts`), coerces any `target` not present in the supplied repo/agent
  lists back to `tier: 'personal'`.

**`tools/brain-remember.js`** — `remember()` signature grows to
`remember({ fact, section, tier = 'personal', target = '' })`:
- `tier: 'personal'` (default) — **unchanged code path**: append to `user-brain.md` under
  `section`, then `splitPersonalBrain()`. Zero regression risk — this is exactly today's behavior.
- `tier: 'repo'` — operates on `~/agent-memory/nexus/<target>/`.
  - If `graph.json` doesn't exist there yet, first call `graph-init.js <target> <path>` (path
    resolved from `known-repos.json`) — this auto-fixes the `agentsystem`-style gap as a side
    effect of first use, no manual bootstrap step required.
  - Repo brains have no markdown source-of-truth file (`graph-init.js` builds them from git/file
    scanning, not from a hand-edited `.md`) — so onboarded facts write directly via `addNode`/
    `addEdge` (`graph-lib.js`), tagged `source: manual-onboard` in frontmatter so they're visibly
    distinct from git-derived nodes.
- `tier: 'agent'` — operates on the shared `~/agent-memory/nexus/agent-brain/`. `addNode` for the
  fact, `addEdge` linking it to the existing `agent-<target>` identity node (e.g. `agent-friday`).
- All three tiers reuse `memory-reconcile.js`'s ADD/UPDATE/DELETE/NOOP dedup (currently
  personal-only) and `computeSalience` stamping (currently personal-only) — extended to run
  regardless of tier, not reimplemented per tier.

**`tools/graph/wikilink-sync.js`** — no code change needed; it already accepts `--brain-path=<dir>`
(default `personal-brain` when omitted). The gap is purely that `remember()` never calls it.
`remember()` now invokes it as a function (import `applyWikilinkMap`/`buildWikilinkMap`
directly rather than shelling out, matching how `remember()` already calls `splitPersonalBrain()`
in-process), scoped to whichever graph root it just wrote to, immediately after every write —
removing the weekly-cron dependency for link visibility. The weekly `memory-maintenance.js
--reflect` cron keeps running as a safety net (idempotent, catches anything written outside
`remember()`, e.g. `graph-init.js`'s own git-derived nodes).

**`tools/memory-onboard.js`** — `extractAndRemember()` swaps `buildCapturePrompt`/
`parseCaptureFacts` for `buildClassifyPrompt`/`parseClassifiedFacts`, groups results by
`(tier, target)`, calls `remember()` once per group, and prints a per-tier summary instead of a
flat list.

**`.agents/commands/onboard-memory.md`** — no flag changes. Behavior note added: text/session/
stdin modes now route across all three tiers automatically; `--fact=` still writes personal-brain
only, unclassified.

### Data flow

```
paste/session/stdin text
        │
        ▼
buildClassifyPrompt(text, {repos, agents})  →  one `claude -p` call
        │
        ▼
parseClassifiedFacts(raw)  →  [{fact, tier, target}, ...]
        │
        ▼
group by (tier, target)
        │
        ├─ tier=personal            → remember() unchanged path
        ├─ tier=repo, target=slug   → ensure nexus/<slug>/ exists (auto graph-init) → addNode/addEdge
        └─ tier=agent, target=name  → addNode/addEdge into nexus/agent-brain/, linked to agent-<name>
        │
        ▼
per group: reconcile (dedup) → stamp salience → wikilink-sync that graph root (sync, not cron)
        │
        ▼
print summary: "written 3 → personal-brain, 2 → repo:agentsystem, 1 → agent:friday"
```

### Error handling

- LLM call fails (timeout/non-zero exit) → whole onboard fails loudly, nothing partially written
  (matches today's failure mode for `--text=`).
- LLM emits a `target` not in the supplied repo/agent lists → parser coerces to `tier: 'personal'`,
  CLI prints a warning line naming the rejected target so the miscategorization is visible, not
  silent.
- `tier: 'repo'` with a known slug whose registered path no longer exists on disk → skip that
  fact, print an explicit warning (`repo '<slug>' registered but path missing — skipped`), does
  not abort the rest of the batch.
- `wikilink-sync` failure on one tier's graph → non-fatal warning; the node/edge write already
  succeeded before the sync call (mirrors `stampSalience`'s existing non-fatal pattern).

### Testing

- `tools/memory-classify.test.js` (new): prompt includes the supplied repo/agent lists; parser
  handles well-formed JSON lines, skips malformed lines, coerces unknown targets to personal.
- `tools/brain-remember.test.js` (extend): tier routing dispatches to the correct graph root;
  repo auto-init runs exactly once (idempotent on a second call with the brain already present);
  agent tier correctly edges to the right `agent-<name>` node; `applyWikilinkMap` gets called with
  the non-default graph root for repo/agent tiers (not just the personal-brain default it already
  covers). No changes needed to `wikilink-sync.test.js` itself — `--brain-path=` already works and
  is already tested there; this only tests that `remember()` now actually calls it.
- Manual verification: paste one blob containing a personal preference + an AgentSystem-specific
  technical fact + a Friday-specific learned pattern → confirm three different `graph.json` files
  update, each new node carries a `connections:` backlink in the same run (not after the next
  Monday cron).

## Explicitly not doing

- Rebuilding any part of `graph-lib.js`.
- Input-side chunking for large pastes (out of scope per Non-goals).
- Changing `--fact=`'s LLM-free contract.
- A fourth memory tier or configurable tier list — personal/repo/agent is the complete set today.
