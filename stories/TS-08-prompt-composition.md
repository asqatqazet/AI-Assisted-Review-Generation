# TS-08 · Prompt composition

**Scope:** domain · **Size:** M · **TDD:** **required** · **Depends on:** TS-07, TS-14

## Story

As the generation pipeline, I need one pure function that turns configuration, a style manifest, a
prompt version and the customer's inputs into model messages, so that composition is testable without a
network and identical inputs always compose identically.

## Context

Seven actions, one composer. The action determines which inputs bind and which instructions apply; it
does not fork into seven code paths. If this function needs a `switch` with seven bodies, the pipeline
abstraction in `01-SYSTEM-DESIGN.md` §5 was wrong and should be revisited rather than worked around.

## Acceptance criteria

- [ ] `composePrompt(input) → { system, messages[], outputSchema }` in `packages/domain`, pure
- [ ] Input: `{ snapshot, style, promptVersion, action, assertions?, freeText?, sourceText?,
      sourceGeneration?, instruction?, targetLength? }`
- [ ] Output schema always demands `{ draft, claims[] }` where each claim carries its provenance
- [ ] Composition is **deterministic** — same inputs, byte-identical output. Snapshot-tested.
- [ ] Style manifest contributes `styleGuide`, few-shot examples and constraints; tenant contributes
      tone guidelines and banned terms; location contributes nothing directly (it is already resolved)
- [ ] Per-action binding is data-driven from the action catalogue, not seven branches
- [ ] Derived actions (Restyle, Condense, Expand, Refine) receive the source draft **and its claim set**,
      with an instruction that the claim set is a ceiling
- [ ] Locale from the snapshot selects the manifest's locale-mapped copy
- [ ] ≥14 tests: one per action, plus empty free text, banned terms present, a style with `emojiPolicy:
      none`, and a locale-mapped manifest

## Technical notes

- The output schema is what makes the grounding guard possible. Demand structured claims from the model
  rather than trying to extract them afterwards — post-hoc extraction is where grounding systems fail.
- For derived actions, put the ceiling in the *system* message, not the user turn. It is a constraint on
  the model's role, not a request.
- Snapshot tests are right here, but review the snapshots when they change. An auto-accepted snapshot
  diff is how a prompt regression ships.

## Out of scope

Calling the model (TS-16). Enforcing grounding (TS-09) — composition asks; the guard verifies.

## Harness prompt

```
Read stories/TS-08-prompt-composition.md, 01-SYSTEM-DESIGN.md §5, and the action table in the prototype
README.

TDD this, failing tests first as test(TS-08).

composePrompt is pure, in packages/domain. It takes the resolved snapshot, a style manifest, a prompt
version, the action and the action's bound inputs, and returns the system message, the message list and
the output schema. The schema always demands { draft, claims[] } with provenance on each claim.

Per-action behaviour must be driven by the action catalogue as data, not by a seven-branch switch. If
you find yourself writing seven bodies, stop and tell me — that means the one-pipeline abstraction is
wrong and I would rather know now than work around it.

For Restyle, Condense, Expand and Refine, the source draft's claim set is a ceiling. Put that constraint
in the system message, not the user turn — it is a constraint on the model's role.

Composition must be deterministic. Snapshot-test it, and do not auto-accept snapshot changes later.
```
