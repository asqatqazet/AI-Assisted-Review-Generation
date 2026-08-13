# TS-20 · Budget guard, rate limiting, observability

**Scope:** ops · **Size:** M · **TDD:** **required** (the guards) · **Depends on:** TS-17

## Story

As an operator, I need the system to protect my budget and tell me what it is doing, so that a runaway
tenant produces a 429 rather than an invoice, and a slow generation can be explained rather than guessed at.

## Context

Observability that only draws charts is decoration. The budget guard is observability that **acts** —
it reads accumulated cost and changes the system's behaviour. That distinction is the story.

## Acceptance criteria

**Budget guard (TDD, pure)**
- [ ] `evaluateBudget({ monthToDateCostMicros, budgetMicros, estimatedCostMicros })
      → { allow: true } | { allow: false, reason, retryAfterSeconds }`
- [ ] Checked **before** the model call, using an estimate; the actual cost is reconciled after
- [ ] BFF returns 429 with `Retry-After`; the survey renders `budget-exceeded` with the unaided
      write-and-copy path working
- [ ] Console shows budget state, with a warning at the tenant's own alert threshold
- [ ] Boundary tests: exactly at budget, one micro under, estimate crossing the line

**Rate limiting (TDD, pure)**
- [ ] Sliding window, per session and per IP, limits from platform settings
- [ ] 429 with a human-readable message and a countdown; no status codes surfaced to a customer

**Observability**
- [ ] One CloudWatch EMF metric line per generation, dimensioned
      `{tenantId, locationSlug, action, styleKey, variantKey, provider, groundingVerdict}` with values
      `{latencyMs, costMicros, inputTokens, outputTokens}`
- [ ] Emitted on rejected and failed generations too — the failures are the interesting data
- [ ] Structured JSON logs carrying a request id through BFF → service → provider call
- [ ] **Customer free text and draft content are redacted from logs.** It is user content
- [ ] Log retention set to 7 days

## Technical notes

- Estimate before, reconcile after. A guard that only checks *recorded* cost lets a single expensive call
  through after the budget is already gone.
- Per-IP limits behind CloudFront need the forwarded client address, not the edge address. Getting this
  wrong rate-limits every customer as one.
- Redaction is not optional and is easy to lose: log the generation *id*, never the draft. Add a test
  asserting no draft text appears in emitted log lines.

## Harness prompt

```
Read stories/TS-20-guards-and-observability.md and 01-SYSTEM-DESIGN.md §11 and §12.

TDD both guards — failing tests first as test(TS-20). Pure functions in packages/domain.

evaluateBudget runs BEFORE the model call using an estimate, and the actual cost is reconciled
afterwards. A guard that only checks recorded cost lets one expensive call through after the budget is
already gone. Test the boundaries: exactly at budget, one micro under, and an estimate that crosses the
line.

When denied, the BFF returns 429 with Retry-After and the survey shows budget-exceeded — with the
unaided write-and-copy path genuinely working. No billing or quota language reaches a customer.

Rate limiting is a sliding window per session and per IP, with limits from platform settings. Behind
CloudFront, use the forwarded client address rather than the edge address, or every customer is rate
limited as one.

Then observability: one EMF metric line per generation with the dimensions listed in the acceptance
criteria, emitted on rejected and failed generations too. Structured JSON logs carrying a request id
through the whole path.

Customer free text and draft content must be redacted from logs — log the generation id, never the
draft. Write a test asserting no draft text appears in any emitted log line.
```
