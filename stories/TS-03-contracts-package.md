# TS-03 · Contracts package from the prototype fixtures

**Scope:** contracts · **Size:** M · **TDD:** not applicable · **Depends on:** TS-01

## Story

As every other package in this system, I need one authoritative set of wire types, so that the
prototype's interaction contract survives into the implementation instead of being reinterpreted.

## Context

The prototypes' `FIXTURES` block was written as a contract proposal and its field names are
load-bearing. Lifting it into Zod is the handoff — it converts three hours of prototyping into the
type system, and it makes the "prototype → implementation delta" section of `REVIEW.md` a real
comparison rather than a claim.

## Acceptance criteria

- [ ] `packages/contracts` exports Zod schemas and inferred types for:
  - `Tenant`, `Location`, `PlatformSettings`, `EffectivePolicy`
  - `Keyword`, `KeywordCategory`
  - `StyleManifest` (incl. `constraints`, `supportedActions`, `targetPlatform`, `locale`,
    locale-mapped `description`/`sample`)
  - `GenerationAction` (the seven), `ActionCatalogEntry`
  - `ResolvedConfigSnapshot`, `GenerateRequest`, `GenerateResult`, `Claim`, `RemovedClaim`
  - `GenerationRecord`, `GenerationOutcome`
  - `PromptVersion`, `Experiment`, `AnalyticsRow`
- [ ] Field names match the prototype fixtures exactly; any deviation is listed in
      `docs/workflow/TS-03/delta.md` with a reason
- [ ] `Claim` encodes the three-way provenance: `sourceKeywordId | sourceSpan | null`, with `null`
      documented as *unsupported, must be stripped*
- [ ] `GenerateRequest` carries `ResolvedConfigSnapshot` as a **field**, not a reference to fetch
- [ ] The package imports nothing but `zod` (enforced by TS-02)
- [ ] Schemas are exported alongside their inferred types; no hand-written interface duplicates a schema

## Technical notes

- Discriminate `GenerateRequest` on `action`. Generate requires `assertedKeywordIds`; Paraphrase
  requires `sourceText`; Restyle/Condense/Expand require `sourceGenerationId`; Refine requires both a
  source and an `instruction`. A discriminated union makes the wrong request unrepresentable — do that
  rather than making every field optional.
- `costMicros` everywhere. Never floats for money.
- `locale` is `"en-GB" | "de-DE" | "any"` for now. Widen when a third tenant exists, not before.

## Out of scope

Persistence types (TS-04 owns Prisma). Validation of manifests at load (TS-14).

## Harness prompt

```
Read stories/TS-03-contracts-package.md, 01-SYSTEM-DESIGN.md §5 and §8, and the FIXTURES block at the
top of the prototype Survey and Admin surfaces.

Build packages/contracts as Zod schemas plus inferred types for everything listed in the acceptance
criteria. Field names must match the prototype fixtures exactly — they are the interaction contract and
were written to be lifted.

Make GenerateRequest a discriminated union on action, so that a Paraphrase request without sourceText,
or a Restyle without sourceGenerationId, does not typecheck. I would rather the wrong request be
unrepresentable than validated at runtime.

Where you must deviate from a fixture field name, list it in docs/workflow/TS-03/delta.md with the
reason. Do not silently rename anything.

This package imports zod and nothing else.
```
