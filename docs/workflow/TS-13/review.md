# TS-13 review

## Behavioral evidence

- OpenAI and Anthropic adapters normalize all native SDK and HTTP errors onto `ModelGatewayError`.
- `AbortSignal` cancellation is respected before and during calls.
- Per-provider circuit breaker opens on consecutive failures and resets upon cooldown.
- Transient errors (`rate-limit`, `unavailable`, `timeout`) retry with exponential backoff; deterministic errors (`auth`, `content-filter`, `invalid-output`) do not retry.
- Primary failure triggers automatic fallback with `metadata.fallbackUsed: true`.
- Parameterized contract suite tests all registered providers.
- Registry guard ensures any provider adapter is registered in the capability matrix.
