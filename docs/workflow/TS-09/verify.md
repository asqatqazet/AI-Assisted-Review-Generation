# TS-09 verification

Two committed red/green slices exercise only the exported Domain behavior:

```text
coverage and evidence-integrity tests: 19 passed
command-postcondition tests: 13 passed
total: 32 passed
```

Adversarial cases include unclaimed connector prose, invented price/staff/discount, missing and stale
evidence, cross-session evidence, reversed Fact Option polarity, rating-as-fact, Expand additions and
drops, presentation-instruction-as-fact, source-revision swapping, and transitive-grounding swapping.

Repository-wide verification follows the concurrently integrated schema and TS-07 audit fixes.

