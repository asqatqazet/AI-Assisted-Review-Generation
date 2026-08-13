# TS-17 · BFF: link resolution, orchestration, outcome capture

**Scope:** service · **Size:** L · **TDD:** **required** (link resolution) · **Depends on:** TS-15, TS-16

## Story

As a customer arriving from a QR code or an invitation, I need the link alone to establish which
business, which venue and which visit this is, so that the survey knows its context without asking me
anything a link could have carried.

## Context

The link is the entry model and the first place tenancy becomes real:
`/s/<tenantSlug>/<locationSlug>?v=<visitToken>&t=<tableRef>`. This story also owns the config cache, the
experiment assignment and outcome capture — everything that orchestrates but owns no domain logic.

## Acceptance criteria

**Link resolution (TDD, pure resolver + thin handler)**
- [ ] `resolveEntry({ tenantSlug, locationSlug, visitToken, tableRef }) → EntryResolution`
- [ ] Distinguishes: unknown tenant, unknown location, malformed token, expired token, **already-consumed
      token**, and valid — as distinct outcomes, all rendered without disclosing which tenants or venues
      exist
- [ ] `tableRef` validated against `/^[\w .-]{1,12}$/` and treated as display-only, never trusted
- [ ] A token is consumed by a uniquely-constrained `consumed_at` write, not by session state
- [ ] An `open-qr` venue never requires a token; an `invite` venue without one falls through to the
      verification state rather than failing

**Orchestration**
- [ ] Fetches the config snapshot from Context Service, cached by ETag; a 304 serves from cache
- [ ] On cache miss with Context Service unavailable, serves the last good snapshot and logs the staleness
- [ ] Assigns the experiment variant **here**, not in the execution plane
- [ ] Calls Generation Service and streams through to the browser
- [ ] Never imports `packages/db` — enforced by TS-02

**Outcome capture**
- [ ] `POST /api/outcome` records `accepted | edited | discarded` with `submittedText` where present
- [ ] Computes normalised edit distance (TS-11), stripping the disclosure line first
- [ ] `discarded` is captured via `sendBeacon` on navigation away

## Technical notes

- **Consumed-token semantics decide the anti-abuse story.** A unique constraint on the consumption write
  means two concurrent requests cannot both succeed. Session state cannot promise that.
- Experiment assignment belongs here because the execution plane must stay ignorant of experiment config —
  it receives a resolved prompt version, not an experiment.
- The stale-snapshot fallback is the seventh rung of the degradation ladder (`§11`). Serving stale config
  beats failing a generation, but the staleness must be logged and visible.

## Harness prompt

```
Read stories/TS-17-bff-and-entry-link.md and 01-SYSTEM-DESIGN.md §9 and §11, plus DECISIONS.md items
60-66 from the prototype folder.

TDD the entry resolver — failing tests first as test(TS-17). Keep it a pure function with a thin handler
around it.

resolveEntry must distinguish unknown tenant, unknown location, malformed token, expired token,
already-consumed token, and valid, as six distinct outcomes. All of them render without disclosing which
tenants or venues exist. tableRef is display-only and validated against a tight pattern; never trust it.

A visit token is consumed by a uniquely-constrained consumed_at write, not by session state — two
concurrent requests must not both succeed, and session state cannot promise that. Write the concurrent
test.

Then orchestration: fetch the config snapshot from Context Service with ETag caching, honour 304, and if
Context Service is unavailable on a miss, serve the last good snapshot and log the staleness rather than
failing the generation. Assign the experiment variant here — the execution plane receives a resolved
prompt version and must stay ignorant of experiment config.

Then outcome capture, computing normalised edit distance with the disclosure line stripped first, and
capturing discards via sendBeacon.

This app must not import packages/db. Confirm the fitness function catches an attempt.
```
