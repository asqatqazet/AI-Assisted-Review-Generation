# TS-19 · Golden-set evaluation gate

**Scope:** quality · **Size:** M · **TDD:** not applicable · **Depends on:** TS-09, TS-18

## Story

As the person responsible for what this system writes, I need every prompt version scored against a
fixed set of scenarios before it can reach a customer, so that a regression is caught in CI rather than
in production.

## Context

This closes the quality loop: **offline evaluation gates a prompt into an experiment; the online A/B
then measures acceptance and edit distance.** It is the piece that distinguishes an AI-product builder
from a full-stack developer who called an API.

Deterministic checks only — no LLM-as-judge. At four-day pace, a judge is unaffordable and its variance
would make the gate meaningless.

## Acceptance criteria

- [ ] `evals/golden/*.json`: 20–30 scenarios spanning **both tenants**, all three styles, and all seven
      actions, each with asserted inputs and expectations
- [ ] Scenarios include the adversarial cases from TS-09: an invented discount, an unnamed staff member,
      an Expand that tries to add a claim
- [ ] A runner executes every scenario against `FakeProvider` and scores, deterministically:
  - grounding verdict is `pass` for scenarios expecting it — **required at 100 %**
  - output length within the style's `constraints`
  - output schema valid
  - required style markers (no emoji in `concise-blurb`, paragraph count in `detailed-narrative`)
  - banned terms absent
  - claim provenance present on every claim
- [ ] Runs in CI as a **non-blocking** job that posts a score summary to the job output
- [ ] Writes the result back so TS-18's promotion gate can read it
- [ ] Adding a scenario requires no code change

## Technical notes

- Non-blocking in CI, blocking at promotion. That split is deliberate: a failing eval should not stop an
  unrelated merge, but it must stop a prompt reaching customers.
- Run against `FakeProvider` so CI is free and deterministic. A tagged variant may run against a real
  provider locally; do not put that in CI.
- The 100 % grounding requirement is not a quality bar, it is a safety bar. A prompt that produces one
  ungrounded claim in thirty scenarios is not 97 % safe.

## Definition of done — extra

`REVIEW.md` shows the CI job summary. It is the most concrete quality evidence in the repository.

## Harness prompt

```
Read stories/TS-19-golden-set-eval-gate.md and 01-SYSTEM-DESIGN.md §12.

Build the golden-set evaluation harness.

Write 20-30 scenarios in evals/golden/ spanning both tenants, all three styles and all seven actions.
Include the adversarial cases from TS-09 — an invented discount, a staff member never mentioned, an
Expand that tries to add a claim.

The runner executes every scenario against FakeProvider and scores deterministically: grounding verdict,
length within the style's constraints, schema validity, required style markers, banned terms absent, and
claim provenance present. No LLM-as-judge — its variance would make the gate meaningless and it costs
money on every CI run.

Wire it into CI as a non-blocking job that posts a score summary, and write the result somewhere TS-18's
promotion gate can read it. Non-blocking in CI but blocking at promotion is the intended split: a failing
eval should not stop an unrelated merge, but it must stop a prompt reaching customers.

Grounding must pass at 100%. That is a safety bar, not a quality bar — a prompt producing one ungrounded
claim in thirty scenarios is not 97% safe.

Adding a scenario must require no code change.
```
