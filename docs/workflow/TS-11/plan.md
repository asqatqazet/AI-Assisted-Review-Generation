# TS-11 plan

## Outcome

Provide three pure calculations behind the quality and cost loop without turning recomputation into a
false lifecycle guarantee.

## Public seam

- `assignVariant(reviewSessionId, experimentKey, variants)` chooses an initial candidate. The caller
  persists that choice as the Experiment Assignment.
- `costProviderAttempt(input)` resolves exactly one immutable, provider-qualified Price Rate at the
  billing instant and returns its identity with integer-micro cost.
- `normalisedEditDistance(originalRevision, submittedRevision)` compares Draft bodies while typed
  system annotations remain structurally excluded.

