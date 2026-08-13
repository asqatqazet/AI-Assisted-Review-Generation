# TS-16 review

## Behavioral evidence

- `POST /generate` executes the complete pipeline: action binding, prompt composition, provider invocation, candidate parsing, grounding guard verification, policy application, cost calculation, and metric emission.
- Snapshot is provided directly in the request payload; the service has no code path to read configuration from database tables.
- Idempotency replay returns identical cached results without re-calling the provider or re-billing.
- Derived actions capture `sourceGenerationId` preserving audit lineage.
- Grounding Guard strictly checks semantic identity and evidence bounds.
