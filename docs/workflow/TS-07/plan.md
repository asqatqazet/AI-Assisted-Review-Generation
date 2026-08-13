# TS-07 plan

## Outcome

Build one immutable, self-bound Effective Configuration Snapshot from the three-scope resolver and all
execution-relevant versioned catalogue inputs.

## Public seam

- `buildConfigSnapshot(input)` resolves Platform → Tenant → Location and returns a deeply frozen
  snapshot with `snapshotId`, `schemaVersion`, Tenant, Location, values, provenance, and referenced
  Review Format, Prompt, Provider, and Price Rate identities.
- `canonicalizeConfigSnapshotPayload(snapshot)` exposes the deterministic canonical representation for
  persistence and signature/audit adapters.

The implementation remains pure Domain code with no filesystem, network, database, Web Crypto, or
Node API.

