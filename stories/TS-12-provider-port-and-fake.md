# TS-12 · Provider port + FakeProvider

**Scope:** llm · **Size:** M · **TDD:** **required** · **Depends on:** TS-03

## Story

As every test in this repository, I need a deterministic model provider, so that the entire domain and
service layer can be exercised without a network, without cost, and without flakiness.

## Context

`FakeProvider` is the highest-leverage file in the codebase. It is what makes TDD affordable on an
LLM product, what makes CI free, and what makes the console's bench cost nothing to demonstrate. Build
it before the real adapters.

## Acceptance criteria

- [ ] `LlmProvider` interface in `packages/llm`:
```ts
interface LlmProvider {
  readonly id: string
  readonly capabilities: {
    streaming: boolean; structuredOutput: boolean; maxOutputTokens: number
  }
  generate(req: LlmRequest, signal: AbortSignal): Promise<LlmResponse>
  stream?(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk>
}
```
- [ ] Typed error taxonomy: `RateLimited`, `Overloaded`, `InvalidRequest`, `Timeout`, `SchemaViolation`
      — every adapter maps its provider's errors onto these
- [ ] `FakeProvider` supports: scripted responses per call, injectable latency, injectable failure by
      type, deterministic token counts, and a scripted **unsupported claim** so grounding can be
      exercised end to end
- [ ] `FakeProvider` streams when asked, chunk by chunk, honouring `AbortSignal`
- [ ] Zero network access in `packages/llm` tests
- [ ] ≥10 tests covering the fake's own contract — a broken fake produces false confidence everywhere

## Technical notes

- The fake must be able to produce an ungrounded claim on demand. The prototype's `embellishments`
  fixture is the model for this: the first Generate of a session attempts one, and every Expand attempts
  one. That determinism is what makes the central interaction reachable by walking the flow.
- Return realistic token counts so cost accounting is exercised rather than stubbed.
- Keep the fake in `src`, not in a test folder — the console's bench uses it as a real, selectable
  provider at zero cost, and that is a product feature.

## Out of scope

Real adapters, breaker, failover (TS-13).

## Harness prompt

```
Read stories/TS-12-provider-port-and-fake.md.

Define the LlmProvider port and the typed error taxonomy in packages/llm, then implement FakeProvider.
TDD the fake — failing tests first as test(TS-12). It is used by every other suite, so a broken fake
produces false confidence everywhere.

The fake must support scripted responses, injectable latency, injectable failure by error type,
realistic token counts, and streaming that honours AbortSignal.

It must also be able to emit an ungrounded claim on demand, deterministically — the first Generate of a
session attempts one and every Expand attempts one. That is what makes the grounding interaction
reachable by walking the flow rather than only by loading a fixture.

Keep FakeProvider in src, not in a test folder. The console's bench offers it as a real selectable
provider at zero cost, which is a product feature rather than a testing convenience.

No network access anywhere in this package's tests.
```
