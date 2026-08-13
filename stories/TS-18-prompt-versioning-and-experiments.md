# TS-18 · Prompt versioning + experiments

**Scope:** quality · **Size:** M · **TDD:** **required** · **Depends on:** TS-11, TS-15

## Story

As an operator improving output quality, I need prompts to be immutable versioned artifacts that can be
run head to head, so that "this prompt is better" is a measurement rather than an opinion.

## Context

Prompts are per **action** — Generate and Paraphrase have genuinely different jobs and cannot share a
version line. Immutability is what makes an old generation still explicable.

## Acceptance criteria

**Versioning**
- [ ] `version_hash = sha256(canonical(body + variables))`; content-addressed
- [ ] "Editing" inserts a new row at status `draft`; nothing mutates, and the source version stays listed
      and addressable
- [ ] An old generation resolves its original prompt body, not the current one — tested
- [ ] Status lifecycle `draft → candidate → in-experiment → retired`, with illegal transitions rejected

**Experiments**
- [ ] Scoped to a tenant and an action; variants reference prompt version hashes with weights
- [ ] Weights must total 100; a set that does not is rejected rather than normalised silently
- [ ] A running experiment can only be **stopped**, never edited; creating a second on the same action
      while one runs is blocked with the reason stated
- [ ] Assignment uses TS-11 bucketing; the assigned `variantKey` is persisted on the generation
- [ ] Stopping an experiment leaves historical generations attributed to their variant

**Promotion gate**
- [ ] A prompt version cannot be attached to a running experiment unless its latest evaluation passed
      grounding at 100 % (TS-19 supplies the evaluation; this story enforces the gate)
- [ ] The gate lives in the domain layer with its own test, not in the console

## Technical notes

- Canonicalise before hashing, same discipline as TS-07. A whitespace change producing a new version is
  correct; a key-ordering change producing one is not.
- Put the promotion gate in the domain, not the UI. A gate that only exists in a form is not a gate — the
  bench and any future API would bypass it.
- Retired versions are never deleted. Deleting one orphans the generations that reference it, and
  reproducibility (`I3`) is the property that makes this system auditable.

## Harness prompt

```
Read stories/TS-18-prompt-versioning-and-experiments.md and 01-SYSTEM-DESIGN.md §12.

TDD this, failing tests first as test(TS-18).

Prompt versions are content-addressed and immutable, and they are per action — Generate and Paraphrase
cannot share a version line. Editing inserts a new row at status draft; the source version stays listed
and addressable. Write the test proving an old generation resolves its original body rather than the
current one.

Canonicalise before hashing with the same discipline as TS-07: a whitespace change should produce a new
version, a key-ordering change should not.

Experiments are scoped to a tenant and an action. Weights must total 100 or be rejected — never
normalise silently. A running experiment can only be stopped, and starting a second on the same action
while one runs is blocked with the reason stated. Stopping one must leave historical generations
attributed to their variant.

Then the promotion gate: a prompt version cannot enter a running experiment unless its latest evaluation
passed grounding at 100%. Put that gate in the domain layer with its own test — a gate that exists only
in a console form is bypassed by the bench and by any future API.

Never delete a retired version. Deleting one orphans the generations referencing it and breaks
reproducibility.
```
