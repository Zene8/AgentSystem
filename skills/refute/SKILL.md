---
name: refute
description: >
  Adversarial skeptic pass on a finding, plan, or conclusion — construct the
  strongest counter-case and default to "refuted" when uncertain. Triggers
  on "poke holes in this", "steelman the opposite", "red-team this plan",
  "refute", "play devil's advocate", before accepting a root-cause or
  committing to an architecture decision.
---

## Procedure

1. **State the claim under test** in one sentence, exactly as its proponent would defend it.
2. **Build the strongest counter-case**, not a strawman. Consider:
   - What evidence was NOT checked that could contradict this?
   - What's the most plausible alternative explanation / design?
   - What would have to be true for the claim to be false, and is there any reason to think it is?
3. **Actively look for disconfirming evidence** — re-read logs, re-run the failing case, check an edge case the original claim didn't cover. Do not just reason in the abstract; if a command can settle it, run the command.
4. **Verdict, biased toward skepticism**:
   - `REFUTED` — found concrete evidence against the claim
   - `WEAKENED` — found a real gap or untested edge case, claim may still hold but confidence should drop
   - `HOLDS` — only issue verdict `HOLDS` if you actively tried to break it and failed; "I didn't find a problem" without trying is not `HOLDS`
   - If genuinely uncertain after a real attempt, default to `WEAKENED`, not `HOLDS`.
5. Report the counter-case and verdict together — never a verdict alone.
