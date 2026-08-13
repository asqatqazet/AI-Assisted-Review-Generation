# TS-16 adversarial review

1. **No Configuration Fetching:**
   Generation Service receives the resolved snapshot as a parameter. It has no database queries to configuration tables, preserving immutability and reproducibility.

2. **Idempotency Guarantee:**
   Because LLM calls incur monetary cost and latency, repeated requests with the same `idempotencyKey` short-circuit immediately from the cache.

3. **Grounding Guard Integrity:**
   All candidate claims are validated against the session's assertions before being accepted. Discrepancies result in rejection.
