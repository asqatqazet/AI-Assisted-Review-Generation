# TS-03 review

## Behavioral evidence

- Generate is unrepresentable without a non-empty Assertion set, rating, Review Session, target Review
  Format Version, idempotency key, signed permit, and embedded snapshot value.
- A snapshot lookup id cannot replace the snapshot input.
- A canonical Claim cannot have null grounding.
- Unsupported model wording has a separate audit-only type.
- A Generation record captures exact snapshot, prompt, format, lineage, Provider Attempts, price rates,
  token quantities, currency, and cost.
- Public survey context is a separate allowlist and cannot accidentally serialize internal snapshot
  fields.

## Package discipline

Contracts import Zod and nothing from Domain. Wire DTOs and domain values will be mapped at deployable
seams rather than sharing types across evolution boundaries.

