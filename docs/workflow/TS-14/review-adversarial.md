# TS-14 adversarial review

1. **Package placement:**
   ADR-004 folded `packages/plugins` into `packages/contracts` and `packages/domain`. Review formats are versioned data interpreted by the generation pipeline, not arbitrary executable code.

2. **Post-processor Safety Boundary:**
   Any formatting post-processing must execute *before* the grounding guard. Running after the grounding guard would bypass hallucination checks and compromise safety.

3. **Truncation vs Claim Dropping:**
   Enforcing `maxChars` by character slicing distorts propositions. Dropping entire claims preserves semantic integrity.
