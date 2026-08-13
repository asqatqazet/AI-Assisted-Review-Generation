# TS-14 · Style manifest system + contract test kit

**Scope:** plugins · **Size:** L · **TDD:** **required** (schema + loader) · **Depends on:** TS-03

## Story

As an operator who wants a new review format, I need styles to be manifests loaded at runtime, so that
adding one is configuration rather than a deployment.

## Context

The assignment requires "new review styles addable via plugins — not hardcoded". The differentiator is
demonstrating it: adding a style live during the demo, with no deploy, is worth more than any
description of the architecture.

## Acceptance criteria

**Schema & loader**
- [ ] `StyleManifest` Zod schema: `key`, `version`, `displayName`, locale-mapped `description`/`sample`,
      `constraints { minChars, maxChars, paragraphs, emojiPolicy, secondPerson }`, `supportedActions[]`,
      `targetPlatform`, `locale`, `promptFragments { styleGuide, fewShot[] }`, optional pure `postProcess`
- [ ] Loader reads manifests from the database (platform catalogue) and validates on load
- [ ] Invalid manifest is rejected with a message naming the **first offending field per rule**; a
      duplicate `key` is rejected as such
- [ ] A manifest whose `locale` matches neither `"any"` nor the tenant cannot be enabled, and the
      enablement path states the reason
- [ ] Three built-in styles: `concise-blurb`, `detailed-narrative`, `social-short`, with genuinely
      different constraints and different `supportedActions` — the 140-character style must not support
      Expand

**Contract test kit**
- [ ] Exported from the package so any manifest gets, for free: schema validity, constraint compliance,
      grounded output against `FakeProvider`, determinism, and `postProcess` purity
- [ ] The three built-ins pass it; a deliberately broken manifest fails it

**Documentation**
- [ ] `docs/AUTHORING-A-STYLE.md` — a 10-minute tutorial ending in a working style

## Technical notes

- `postProcess` must be pure and must not be able to add text. Run it *before* the grounding guard so
  anything it introduces is still checked, and say so in a comment — a post-processor that runs after the
  guard is a hole in the safety model.
- `maxChars` is enforced by dropping whole claims, never by truncating mid-sentence. A truncated fact is
  a distorted fact.
- Manifests are versioned and immutable; enabling a style pins its version, so an old generation still
  resolves the manifest it was written against.

## Definition of done — extra

`DEMO.md` includes adding a fourth style live from a manifest paste.

## Harness prompt

```
Read stories/TS-14-style-plugin-system.md and DECISIONS.md items 39-42 and 67-69 from the prototype folder.

TDD the schema and loader — failing tests first as test(TS-14).

Build the StyleManifest Zod schema and a loader that reads manifests from the platform catalogue and
validates on load. Rejection messages must name the first offending field per rule, and a duplicate key
must be rejected as a duplicate rather than as a generic validation failure. A manifest whose locale
matches neither "any" nor the tenant cannot be enabled, and the enablement path must state why.

Ship three built-in styles with genuinely different constraints and different supportedActions. The
140-character social style must not support Expand — that gate is the proof that capability is
manifest-declared rather than conditional logic.

Export a contract test kit from the package so any manifest gets schema validity, constraint compliance,
grounded output against FakeProvider, determinism and postProcess purity for free.

postProcess runs BEFORE the grounding guard, so anything it introduces is still checked. Put that in a
comment — a post-processor running after the guard would be a hole in the safety model.

maxChars is enforced by dropping whole claims, never by truncating text mid-fact.

Then write docs/AUTHORING-A-STYLE.md as a ten-minute tutorial that ends with a working style.
```
