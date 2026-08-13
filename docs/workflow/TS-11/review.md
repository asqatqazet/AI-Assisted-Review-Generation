# TS-11 review

## Behavioral evidence

- Weighted rendezvous assignment is deterministic, respects configured weights, never selects a
  zero-weight variant, and does not move a Review Session from one existing variant to another when a
  proportionally weighted new variant is introduced.
- Variant weights must be integer percentages totaling exactly 100. Duplicate and empty keys fail.
- Provider Attempt cost uses integer arithmetic, a half-open effective interval, and one immutable
  Price Rate. Missing, mismatched, overlapping, invalid, and overflowing rates fail closed.
- Draft edit distance normalises Unicode and whitespace, handles empty bodies explicitly, caps both
  bodies at 4,000 code points, and excludes typed disclosure annotations.

## Review-stage refactor

The three calculations remain independent modules behind one sealed Domain entrypoint. No shared
utility abstraction was introduced: their hashing, monetary, and text-normalisation rules have
different reasons to change.

