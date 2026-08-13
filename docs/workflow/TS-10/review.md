# TS-10 review

## Behavioral evidence

- Disclosure notices are generated dynamically using current Tenant name and localized text (`en-GB` and `de-DE` with fallback).
- Draft caps are enforced according to `maxReviewFormatsPerRequest`.
- Contradictory policy combinations (`open-qr` with `requireVerifiedExperience`) are rejected immediately with `ContradictoryPolicyError`.
- Action availability computes the strict intersection of Tenant-enabled and Format-supported commands while providing distinct explanations for exclusions.
- Banned terms are detected case-insensitively and returned as policy violations.
- Pure domain implementation with zero external I/O or side-effects.
