# TS-10 · Policy engine

**Scope:** domain · **Size:** S · **TDD:** **required** · **Depends on:** TS-07

## Story

As a tenant with its own compliance posture, I need my policy applied to every draft regardless of which
action produced it, so that disclosure, caps and verification are properties of the system rather than
of a particular screen.

## Context

Policy is where two tenants visibly differ: a dental practice requires a disclosure line and a verified
visit; a walk-in restaurant requires neither. Keeping it pure and central means the console, the survey
and the bench cannot drift apart.

## Acceptance criteria

- [ ] `applyPolicy({ draft, claims, policy, tenantName, locale }) → { draft, appended?, violations[] }`
      in `packages/domain`, pure
- [ ] Disclosure: when `requireDisclosure`, a disclosure line generated from the tenant name is appended
      **and included in the copied text**
- [ ] Draft cap: `canRequestDraft({ policy, draftsThisSession }) → { allowed, reason? }`
- [ ] Verification: `requiresVerification({ policy, entryMode, tokenPresent }) → boolean`, encoding that
      an `open-qr` venue can never require it
- [ ] Action availability: `availableActions({ tenantEnabled, styleSupported }) → action[]` — the
      intersection, with the excluded set and its reason returned for the UI to explain
- [ ] Locale selects disclosure copy; a missing locale falls back to the tenant default and records it
- [ ] ≥12 tests including both tenants' postures and the impossible combination
      (`open-qr` + `requireVerifiedExperience`), which must be rejected as a configuration error

## Technical notes

- The impossible combination is worth a test and a clear error: a walk-in venue cannot verify an
  appointment. Catching contradictory configuration at the domain level is cheaper than debugging it in
  the survey.
- Disclosure text is generated, not stored, so a tenant rename cannot leave stale copy on old drafts —
  but old *generations* keep the text they were written with. Both facts need a test.
- `availableActions` returning the *reason* for exclusion is what lets the survey say "not offered
  because this format is 140 characters" instead of silently hiding a button.

## Out of scope

Budget and rate limiting (TS-20) — those are runtime guards, not tenant policy.

## Harness prompt

```
Read stories/TS-10-policy-engine.md and 01-SYSTEM-DESIGN.md §3.

TDD this, failing tests first as test(TS-10). Pure functions in packages/domain, no I/O.

Cover: disclosure generation and inclusion in copied text; the draft cap; whether verification applies;
and the available-action set as the intersection of tenant-enabled and style-supported.

Two things I specifically want:

availableActions must return the excluded actions with a reason, so the survey can say why an action is
not offered rather than silently hiding it.

An open-qr venue that also sets requireVerifiedExperience is a contradictory configuration — a walk-in
venue has no appointment to verify. Reject it as a configuration error at the domain level with a clear
message, and test it.

Also test that disclosure text is generated from the current tenant name, but that an already-stored
generation keeps the text it was written with.
```
