# TS-15 adversarial review

1. **ETag Invariant:**
   ETags are derived directly from the canonical SHA-256 snapshot hash. If configuration does not change, ETag remains byte-stable, preserving downstream caching and eliminating redundant roundtrips.

2. **Control-plane Package Boundary:**
   `apps/context-service` contains no LLM dependencies. This ensures that the control plane remains lightweight, cache-focused, and decoupled from model runtime latency.

3. **Role Gating:**
   Scope modifications strictly enforce role hierarchies: platform changes require `platform_admin`, tenant configuration requires `tenant_admin`, and location overrides require `location_manager` or above.
