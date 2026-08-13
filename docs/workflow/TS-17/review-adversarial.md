# TS-17 adversarial review

1. **Information Leakage Prevention:**
   Invalid entry attempts return unified user-facing guidance ("Please scan a valid venue QR code...") regardless of whether the tenant or location exists, mitigating enumeration attacks.

2. **Untrusted `tableRef` Sanitization:**
   Client-provided table markers are strictly sanitized against alphanumeric regex and never trusted as cryptographic or tenancy tokens.

3. **Stale Cache Resilience:**
   If Context Service suffers an outage, the BFF serves the last known good snapshot for the tenant/location and marks the response as stale, maintaining customer availability.
