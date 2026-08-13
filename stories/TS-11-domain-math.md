# TS-11 · Bucketing, cost accounting, edit distance

**Scope:** domain · **Size:** M · **TDD:** **required** · **Depends on:** TS-03

## Story

As the quality loop, I need stable experiment assignment, exact cost, and a measure of how much the
customer rewrote us, so that the system can tell which prompt is actually better rather than which one
is faster.

## Context

Three small pure functions that carry disproportionate weight. Edit distance in particular is the metric
almost nobody instruments and the one that actually measures output quality.

## Acceptance criteria

**Bucketing**
- [ ] `assignVariant(sessionId, experimentKey, variants[]) → variantKey`, deterministic
- [ ] Same inputs → same variant, always (test over 1 000 repeated calls)
- [ ] Distribution over 10 000 synthetic session ids lands within ±2 % of configured weights
- [ ] Edge cases: single variant, zero-weight variant (never assigned), weights not summing to 100
      (rejected, not normalised silently)
- [ ] Adding a variant does not reassign existing sessions to a *different existing* variant

**Cost**
- [ ] `computeCostMicros({ provider, model, inputTokens, outputTokens, priceRow }) → number`
- [ ] Integer micros throughout; no floating-point money anywhere
- [ ] Resolves against the price row in effect at generation time, not the current one
- [ ] Unknown model raises rather than defaulting to zero — a silent zero is how cost tracking dies

**Edit distance**
- [ ] `normalisedEditDistance(original, submitted) → number` in `[0, 1]`
- [ ] Levenshtein over normalised text (collapse whitespace, strip the disclosure line before comparing)
- [ ] Identical → 0; complete rewrite → ~1; empty submission handled explicitly
- [ ] Documented as feeding `generation_outcomes.edit_distance`

## Technical notes

- Bucketing: hash `sessionId + ":" + experimentKey` and map into the cumulative weight range. Including
  the experiment key means a session in two experiments is not correlated across them.
- The "adding a variant does not reshuffle" property is worth its test — naive modulo bucketing violates
  it and the resulting data corruption is invisible until you try to read the results.
- **Strip the disclosure line before computing edit distance.** Otherwise a tenant with disclosure on
  shows systematically higher edit distance for a reason that has nothing to do with draft quality. This
  is the kind of detail that separates a real metric from a plausible one.
- Levenshtein on long drafts is O(n·m); cap at a few thousand characters and note the truncation.

## Harness prompt

```
Read stories/TS-11-domain-math.md.

TDD all three, failing tests first as test(TS-11). Pure, in packages/domain.

assignVariant must be deterministic and weight-respecting. Test stability over 1000 repeated calls and
distribution over 10,000 synthetic session ids within ±2% of the configured weights. Also test that
adding a new variant does not move existing sessions between existing variants — naive modulo bucketing
breaks this and the data corruption is invisible until you read the results.

computeCostMicros works in integer micros against the price row in effect at generation time. An unknown
model must raise, never default to zero.

normalisedEditDistance is Levenshtein over normalised text, returning 0 to 1. Strip the disclosure line
before comparing — otherwise every tenant with disclosure enabled shows inflated edit distance for a
reason unrelated to draft quality. Cap the input length and document the truncation.
```
