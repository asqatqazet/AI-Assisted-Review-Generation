# US-02.2 plan

## Confirmed seams

1. The browser-facing command is `POST /api/v1/entry-challenges/:entryChallengeHandle/start`.
   Tests observe only its HTTP status, headers, public body and the call made across the Context
   deployable boundary.
2. `ContextPort.advanceEntry` is the BFF-owned remote seam. Its input contains the opaque Entry
   Challenge handle, browser capability, rating and selected Action; it never accepts Tenant or
   Location identity from the browser.
3. CSRF issuance and verification are one BFF cryptographic boundary, injected in tests as a
   deterministic adapter. Production binds the token to the browser capability and Entry Challenge
   handle; frontend code keeps it only in memory.
4. Context owns the atomic consume-and-create transaction. The first tracer bullet covers the direct
   admitted result and its clean Review Session redirect. Verification-required and concurrency
   outcomes follow as separate red-green slices.

## Public contract

- The request body is strict: `rating`, `action` and `csrfToken` only.
- A successful admission returns `303 /review/:reviewSessionHandle` with `private, no-store`.
- Invalid cookie, handle, origin, CSRF or Context result use a public non-enumerating disposition and
  never reveal Tenant, Location, token state or an existing Review Session.
