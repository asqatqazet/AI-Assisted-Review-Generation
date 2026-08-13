# TS-13 adversarial review

1. **No SDK Leakage:**
   All network and provider errors are mapped cleanly onto `ModelGatewayError` with typed `ModelFailureCode`. No unhandled third-party exceptions escape the package boundary.

2. **Non-retryable Errors:**
   Auth and validation failures fail fast without retry to prevent wasted token budgets and obfuscated bugs.

3. **Per-provider Breaker Isolation:**
   Circuit breaker state is maintained per provider instance, ensuring a failure in Anthropic does not block OpenAI fallback requests.
