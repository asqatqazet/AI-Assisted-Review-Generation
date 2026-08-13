# TS-13 plan

## Outcome

Implement real model adapters (`AnthropicProvider`, `OpenAIProvider`), per-provider circuit breaker resilience, transient error retry, fallback failover, and a parameterized provider contract test suite and registry guard.

## Public seam

- `AnthropicProvider`, `OpenAIProvider`
- `CircuitBreaker`, `ResilientModelGateway`
- `PROVIDER_CAPABILITY_MATRIX`
- Contract test suite and registry guard
