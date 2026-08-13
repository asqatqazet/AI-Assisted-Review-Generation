# TS-12 plan

## Confirmed public seam

`@review/llm` exposes one provider seam:

```ts
interface ModelGateway {
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelRun>;
}
```

Tests and callers cross that interface. Provider-native streaming, SDK objects, raw bytes, Action
semantics, Review Session semantics, prompts, grounding, policy, pricing, and persistence stay outside
the interface.

## Vertical slices

1. Return one complete caller-scripted `ModelRun` with usage and provider receipt.
2. Normalize every supported failure category as `ModelGatewayError`.
3. Fail with typed unavailability when the script is exhausted.
4. Apply caller-scripted latency.
5. Honor cancellation before and during a call.
6. Preserve retry hints and attempt evidence on failures.

Each slice was committed red before its minimum green implementation.
