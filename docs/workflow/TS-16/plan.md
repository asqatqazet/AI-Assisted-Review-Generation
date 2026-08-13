# TS-16 plan

## Outcome

Build Generation Service in `apps/generation-service` as a thin execution-plane orchestration microservice that receives the resolved snapshot, drives model generation through resilient gateways, validates output with the Grounding Guard and Policy Engine, handles idempotency, and records lineage.

## Public seam

- `POST /generate` accepting `GenerationRequest` with `ResolvedConfigSnapshot`
- `GenerationOrchestrator`
- `createGenerationApp`
