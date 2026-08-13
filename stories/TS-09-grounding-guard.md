# TS-09 · Grounding guard — seven actions

**Scope:** domain · **Size:** L · **TDD:** **required** · **Depends on:** TS-03

## Story

As the product's central safety mechanism, I need every claim in every generated draft traced to
something the customer actually asserted, so that the system arranges facts rather than inventing them.

## Context

**This is the product.** Everything else is delivery. It is also the story that makes the submission
legally shippable — without it, this is a fake-review generator, which no customer can deploy and no
reviewer should be impressed by.

Build this before the plugin system and before the console.

## Acceptance criteria

- [ ] `evaluateGrounding(input) → GroundingResult` in `packages/domain`, pure, no I/O, **no model call**
- [ ] Input: `{ action, claims[], assertions?, sourceText?, sourceClaims?, instruction?, bannedTerms[] }`
- [ ] Output: `{ verdict: "pass" | "stripped" | "rejected", draft?, claims[], removedClaims[] }` where
      each removed claim carries a human-readable `reason`
- [ ] The seven predicates from `01-SYSTEM-DESIGN.md` §5 are implemented and each has its own tests:

| Action | Predicate |
|---|---|
| Generate | every claim traces to an asserted keyword id or a span of the free text |
| Paraphrase | every claim traces to a span of `sourceText` |
| Regenerate | the originating action's predicate |
| Restyle / Condense / Expand | `claims' ⊆ sourceClaims` — **strict subset, no additions** |
| Refine | `claims' ⊆ sourceClaims ∪ {instruction}` |

- [ ] Banned terms are removed through the **same path** with the same visible reason — a policy removal
      is never silent either
- [ ] When removal empties the draft, verdict is `rejected` with a null draft; this is a normal pipeline
      outcome, not an error
- [ ] Restore-by-typing appends the typed text as a claim with `sourceSpan: "restored-by-typing"`; the
      removed wording is never returned to the caller and cannot be recovered from the result
- [ ] ≥25 tests, including adversarial: an invented discount, a named staff member never mentioned, a
      price never entered, a claim contradicting a negative-polarity keyword, an Expand that adds a
      claim, a Refine claiming something the instruction did not say, an empty claims array, and a claim
      whose `sourceKeywordId` refers to a keyword not in the assertion set

## Technical notes

- **Deterministic, not model-based.** A guard that can hallucinate is not a guard. If the harness
  proposes an LLM-as-judge here, refuse — see `02-ARCHITECTURE-DIALOGUE.md` §3 Q1.
- Span matching for Paraphrase: normalise whitespace and case, then require the claim to be a
  substring-or-near-match of the source. Record the character range. Do not attempt semantic matching;
  a false positive here is a fabricated review.
- The `reason` strings surface directly to the customer in `results-grounding-stripped`. Write them as
  product copy, not as error codes.
- Expand is the sharp case: the model *will* try to add a claim. The prototype demonstrates exactly this.
  Make sure a test asserts the attempt is caught rather than assuming it will not happen.

## Definition of done — extra

`REVIEW.md` cites this file by path under the product pillar. `DEMO.md` shows the strip happening live.

## Harness prompt

```
Read stories/TS-09-grounding-guard.md, 01-SYSTEM-DESIGN.md §5, and DECISIONS.md items 13-26 from the
prototype folder.

This is the product's central mechanism. TDD it properly — failing tests first as test(TS-09), and write
the adversarial cases before the happy path.

evaluateGrounding is pure, in packages/domain, and makes NO model call. It is deterministic string and
span matching over the structured claims array. If you are tempted to propose an LLM-as-judge here, do
not: a guard that can hallucinate is not a guard, and I want the failure mode argued rather than
designed in.

Implement the seven predicates in the table in the acceptance criteria. Restyle, Condense and Expand
enforce a strict subset of the source claims — expansion adds words, not facts. Refine allows exactly
one addition, the instruction itself.

Banned terms remove through the same path with the same visible reason, so a policy removal is never
silent either. When removal empties the draft, return verdict "rejected" with a null draft — that is a
normal outcome, not an error.

The reason strings are shown to the customer. Write them as product copy.

At least 25 tests. Include: an invented discount, a staff member never mentioned, a price never entered,
a claim contradicting a negative keyword, an Expand that tries to add a claim, and a Refine claiming
more than its instruction said.
```
