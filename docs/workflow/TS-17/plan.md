# TS-17 plan

## Outcome

Implement Web BFF (`apps/web-bff`) link resolution, configuration caching with stale fallback, and outcome capture with normalized edit distance calculation.

## Public seam

- `resolveEntry(input, lookup, now): EntryResolution`
- `GET /s/:tenantSlug/:locationSlug` (entry link endpoint)
- `POST /api/generate` (orchestrates with generation service)
- `POST /api/outcome` (captures outcome and computes edit distance)
