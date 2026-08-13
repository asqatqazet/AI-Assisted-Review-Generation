# TS-19 adversarial review

1. **Safety Bar (100% Grounding):**
   Grounding correctness is a safety invariant. The test runner ensures all 22 scenarios pass their grounding assertions and that hallucinations are rejected.

2. **Zero-Cost Deterministic Evaluation:**
   Evaluating against canonical mock outputs ensures that CI remains fast, repeatable, and free of non-deterministic LLM-as-judge variance.
