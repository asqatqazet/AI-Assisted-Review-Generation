# TS-15 review

## Behavioral evidence

- `GET /context/:tenantId/:locationId` returns `ResolvedConfigSnapshot` with strong ETag matching the snapshot SHA-256 hash.
- Repeated reads produce identical ETags; `If-None-Match` requests return `304 Not Modified`.
- Tenant settings mutation bumps revisions and alters subsequent snapshot ETags.
- Role gates reject unauthorized mutation requests (e.g. `location_manager` cannot modify platform settings).
- Provisioning produces clean first-run state with zero fact options so survey renders `not-configured`.
- Service has zero imports from `packages/llm` (control plane isolation).
