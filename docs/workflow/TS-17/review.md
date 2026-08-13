# TS-17 review

## Behavioral evidence

- `resolveEntry` cleanly distinguishes unknown-tenant, unknown-location, malformed-token, expired-token, already-consumed-token, requires-verification, and valid resolution without leaking entity existence.
- `tableRef` is validated against `/^[\w .-]{1,12}$/` and treated as display-only.
- Config snapshot is cached by ETag, with 304 handling and graceful fallback to stale cached snapshots when Context Service is unavailable.
- Outcome capture computes normalized Levenshtein edit distance with the disclosure line stripped.
- `apps/web-bff` has zero database dependencies (enforced by fitness function).
