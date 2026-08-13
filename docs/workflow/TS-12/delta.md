# TS-12 authority delta

The accepted ADR and approved seam supersede three details in the original story.

| Original story detail | Implemented decision | Reason |
|---|---|---|
| Public `LlmProvider.generate` plus optional `stream` | One public `ModelGateway.generate` returning a buffered `ModelRun` | Candidate bytes cannot escape before grounding and policy validation. Provider-native streaming is an adapter implementation detail. |
| Error names `RateLimited`, `Overloaded`, `InvalidRequest`, `Timeout`, `SchemaViolation` | Discriminated codes `timeout`, `rate-limit`, `auth`, `content-filter`, `provider`, `unavailable`, `cancellation`, `invalid-output` on `ModelGatewayError` | These are the failure decisions the Generation module can act on without importing provider SDK types. `provider` and `unavailable` are deliberately distinct. |
| Fake infers the first Generate/each Expand from Action and Review Session state | Callers script the exact output or failure for each call | The LLM adapter must not know domain commands or sessions. A caller can script an unsupported proposition in the JSON output without teaching the fake grounding semantics. |

`FakeModelGateway` replaces the compatibility name `FakeProvider` because the implemented adapter
satisfies the canonical `ModelGateway` seam. No alias was added.
