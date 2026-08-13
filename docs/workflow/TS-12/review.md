# TS-12 review

## Interface depth

One `generate` method hides provider selection details, eventual SDK adaptation, buffering, error
normalization, cancellation, and invocation evidence. `ModelRequest`, `ModelRun`, and their JSON value
types belong to `llm`; the package imports neither `domain` nor `contracts`.

Every successful run carries input/output token usage and a provider receipt. Typed failures may carry
the same attempt evidence plus a retry delay. This lets the Generation module journal what the
provider actually reported without seeing SDK errors or raw stream chunks.

## Fake semantics

`FakeModelGateway` copies a caller-owned step list, consumes one step per started call, and assigns the
step before applying latency. Concurrent calls therefore retain invocation order even if a later call
settles sooner. A pre-aborted call consumes no step; cancellation after a call starts consumes the
assigned step, matching a provider attempt.

The fake performs no network access and contains no Action, Assertion, Review Session, grounding, or
policy branching. Unsupported candidate output is ordinary caller-scripted JSON, so the real
grounding module remains the only authority that classifies it.

## Remaining scope

Provider SDK adapters, provider-native streaming, buffering/decoding of those streams, timeouts,
breakers, and resilience policy belong to TS-13. They must preserve this interface rather than add a
public streaming path.
