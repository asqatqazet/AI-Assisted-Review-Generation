# TS-16 · Generation Service — execution plane, streaming

**Scope:** service · **Size:** L · **TDD:** not applicable (domain is already tested) · **Depends on:** TS-08…TS-13

## Story

As the execution plane, I need to compose, call a model, ground the result and persist a reproducible
record, so that a customer receives a streamed draft that is never allowed to contain a fact they did
not assert.

## Context

This service is thin. Composition, grounding and policy are already pure and tested; its job is
orchestration, streaming, persistence and telemetry. If it grows business logic, that logic belongs in
`packages/domain` instead.

## Acceptance criteria

- [ ] Hono app in `apps/generation-service`, Lambda + Function URL with **response streaming**
      (`awslambda.streamifyResponse`)
- [ ] `POST /generate` accepts a `GenerateRequest` carrying the `ResolvedConfigSnapshot` as a field and
      **never fetches configuration**
- [ ] Pipeline order is exactly: resolve action binding → compose → provider (with breaker/failover) →
      structured output → **grounding guard** → policy → persist → emit metric
- [ ] Draft text streams to the caller; `claims`, `removedClaims` and `groundingVerdict` arrive in a
      **terminal event** — the guard cannot evaluate a partial output
- [ ] The persisted record carries everything needed for reproduction: `contextVersion`,
      `promptVersionHash`, `styleKey` + `styleVersion`, provider, model, params, `sourceGenerationId`,
      tokens, `costMicros`, `priceTableId`, `fallbackUsed`
- [ ] Derived actions store `sourceGenerationId`, forming an auditable lineage chain
- [ ] Idempotency: a repeated `idempotencyKey` returns the original record and does not re-bill
- [ ] Connects as `generation_svc` only; cannot read `operators` (proven in TS-06)
- [ ] Integration tests through `FakeProvider`: pass, stripped, rejected, failover, abort mid-stream,
      idempotent replay

## Technical notes

- **Q7 from `01-SYSTEM-DESIGN.md` §14 must be decided before this story starts.** Streamed text is
  provisional until grounding runs. Either present it as unchecked in progress, or buffer and reveal.
  Whichever you choose, the terminal event is the contract.
- Idempotency matters more than usual: a 30-second streaming call *will* be retried by impatient clients
  and flaky networks, and each retry is real money.
- Emit the EMF metric line even on a rejected or failed generation. The failures are the interesting data.

## Harness prompt

```
Read stories/TS-16-generation-service.md, 01-SYSTEM-DESIGN.md §5 and §9, and the ADR resolving open
question Q7. Do not start until that ADR exists.

Build apps/generation-service as a Hono app on Lambda with response streaming via streamifyResponse.

Keep it thin. Composition, grounding and policy are already pure and tested in packages/domain — this
service orchestrates, streams, persists and emits telemetry. If you find yourself writing business logic
here, it belongs in the domain package instead; tell me rather than adding it.

The pipeline order is fixed: bind action inputs, compose, call the provider through the breaker and
failover, parse structured output, run the grounding guard, apply policy, persist, emit the metric.

Draft text streams. Claims, removed claims and the grounding verdict arrive in a terminal event, because
the guard cannot evaluate a partial output.

The service receives the resolved config snapshot as a request field and must have no code path to fetch
configuration.

Persist everything needed to reproduce the generation from its id alone, including the price table row
used. Derived actions store sourceGenerationId so lineage is auditable.

Implement idempotency properly: a repeated idempotencyKey returns the original record without re-billing.
A thirty-second streaming call will be retried, and every retry is real money.

Integration tests through FakeProvider: pass, stripped, rejected, failover, abort mid-stream, and
idempotent replay.
```
