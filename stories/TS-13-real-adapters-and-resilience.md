# TS-13 · Real adapters, contract suite, resilience

**Scope:** llm · **Size:** L · **TDD:** not applicable (contract-suite driven) · **Depends on:** TS-12

## Story

As a product whose upstream dependency is a third-party model API, I need providers to be swappable and
failures to be survivable, so that one provider's bad afternoon is not an outage.

## Context

The assignment asks for multi-provider behind an abstracted interface. The differentiator is not that
two adapters exist — it is that one shared contract suite runs against all of them, and that a provider
outage degrades rather than fails.

## Acceptance criteria

**Adapters**
- [ ] `AnthropicProvider` and `OpenAIProvider` implementing the TS-12 port
- [ ] Structured output enforced with Zod; **one** repair attempt feeding the validation error back,
      then a typed `SchemaViolation`
- [ ] Provider-native errors mapped onto the typed taxonomy — no raw SDK errors escape the package
- [ ] `AbortSignal` honoured, default timeout 45 s, overridable per style

**Contract suite**
- [ ] One suite in `packages/llm/__tests__/provider-contract.ts` parameterised over every registered
      provider including the fake
- [ ] Asserts: schema conformance, `maxOutputTokens` respected, `AbortSignal` propagation, typed errors,
      streaming chunk ordering
- [ ] Network-touching cases are tagged and skipped in CI; the fake runs always
- [ ] A registry guard test enumerates `*-provider.ts` and **fails** if any adapter is absent from the
      capability matrix or the contract suite — proven by adding a dummy adapter, watching it fail, and
      removing it

**Resilience**
- [ ] Per-provider circuit breaker: opens after N consecutive failures, half-open probe, closes on success
- [ ] Failover primary → fallback on `Overloaded`, `Timeout` and 5xx; `fallbackUsed` recorded
- [ ] Retry with jitter on transient errors; no retry on `InvalidRequest`
- [ ] Tests drive all of this through `FakeProvider` scripted failures — no live outage required

## Technical notes

- Do not retry `InvalidRequest`. Retrying a deterministic failure burns budget and hides the bug.
- The breaker is per provider, not global; opening Anthropic must not stop OpenAI.
- Keys come from SSM Parameter Store. `.env.example` documents the names; no key is ever committed.
- The registry guard is the story's real defensive value: it is what stops a future agent adding a third
  provider without wiring it into the tests.

## Harness prompt

```
Read stories/TS-13-real-adapters-and-resilience.md and 01-SYSTEM-DESIGN.md §11.

Implement AnthropicProvider and OpenAIProvider against the TS-12 port. Enforce structured output with
Zod, allow exactly one repair attempt that feeds the validation error back, then fail with a typed
SchemaViolation. Map every provider-native error onto the typed taxonomy — no raw SDK error may escape
this package.

Write ONE contract suite parameterised over every registered provider, fake included. Tag the
network-touching cases so CI skips them and the fake always runs.

Add a registry guard test that enumerates the adapter files and fails if one is missing from the
capability matrix or the contract suite. Prove it works: add a dummy adapter, watch it fail, remove it,
and record that in docs/workflow/TS-13/verify.md.

Then resilience: a per-provider circuit breaker, failover to the fallback on Overloaded, Timeout and
5xx, retry with jitter on transient errors, and no retry at all on InvalidRequest. Drive every one of
these tests through FakeProvider scripted failures.

Provider keys come from SSM Parameter Store. Nothing is committed.
```
