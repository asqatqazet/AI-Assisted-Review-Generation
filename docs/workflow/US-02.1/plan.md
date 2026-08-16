# US-02.1 plan

## Confirmed seams

1. The public BFF HTTP interface `GET /s/:tenantSlug/:locationSlug` is observed only through status,
   headers and public body.
2. `ContextPort.prepareEntry` is the BFF-owned remote seam. Tests use an in-memory adapter at that
   external deployable boundary; they do not mock BFF modules or inspect Context storage.
3. Browser-capability generation is injected as the randomness boundary. The production adapter must
   produce an opaque high-entropy value; tests use a stable literal.

The first tracer bullet covers only a prepared link. Uniform unavailable projections, prefetch safety,
source throttling and the Context persistence/concurrency behavior follow as separate red-green slices.
