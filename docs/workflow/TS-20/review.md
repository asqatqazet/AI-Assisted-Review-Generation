# TS-20 review

## Behavioral evidence

- Budget evaluation checks before execution using estimated cost and halts runaway usage before budget breach occurs.
- Alert threshold triggers warning telemetry when accumulated month-to-date cost exceeds configured percentage.
- Sliding window rate limiter enforces per-session and per-client IP limits with accurate retry-after seconds calculation.
- Redaction guarantee: customer free text and generated review drafts are strictly redacted from emitted structured logs.
- CloudWatch EMF metrics are emitted for all attempts (success, rejected, failure) with cost, tokens, and latency dimensions.
