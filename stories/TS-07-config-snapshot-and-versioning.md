# TS-07 · Config snapshot assembly + versioning

**Scope:** domain · **Size:** M · **TDD:** **required** · **Depends on:** TS-04

## Story

As the execution plane, I need configuration delivered to me as an immutable versioned value, so that I
never read config myself and every generation can name the exact configuration that produced it.

## Context

This is the mechanism that makes the control-plane / execution-plane boundary real. `GenerateRequest`
carries a `ResolvedConfigSnapshot` as a field; the generation service has neither credentials nor a code
path to fetch one. The boundary becomes a type signature backed by a Postgres grant.

## Acceptance criteria

- [ ] `buildConfigSnapshot({ platform, tenant, location, keywords, styles })` in `packages/domain`,
      pure, returning a `ResolvedConfigSnapshot`
- [ ] `version` is a **content hash** of the resolved payload — identical inputs produce an identical
      version, and any change produces a different one
- [ ] Hash is stable across key ordering and across array ordering where order is not semantic
      (a test must prove this; it is the usual source of spurious cache misses)
- [ ] Snapshot carries the merged keyword set (tenant + location additions), the enabled styles filtered
      by locale and by tenant enablement, the effective policy, and the field provenance from TS-04
- [ ] Snapshot is deep-frozen; mutation attempts throw in development
- [ ] `contextVersion` on a stored generation refers to this hash, and an old generation resolves to its
      original snapshot rather than the current one
- [ ] ≥12 tests including: identical inputs → identical hash, reordered keys → identical hash, one
      changed banned term → different hash, a location override → different hash from the tenant alone

## Technical notes

- Hash with `node:crypto` (the carve-out in TS-02 exists for this). Canonicalise before hashing: sort
  object keys recursively, and sort arrays whose order is not semantic. Keyword `sortOrder` **is**
  semantic — do not sort those away.
- Do not put timestamps or ids-of-convenience in the hashed payload. Anything that changes without the
  configuration changing will destroy your cache hit rate and you will not notice until the bill arrives.
- The snapshot is what the BFF caches with an ETag (TS-15/TS-17). Its stability is a cost decision as
  much as a correctness one.

## Out of scope

Serving it over HTTP (TS-15). Caching it (TS-17).

## Harness prompt

```
Read stories/TS-07-config-snapshot-and-versioning.md and 01-SYSTEM-DESIGN.md §3 and §6.

TDD this, failing tests first as test(TS-07).

buildConfigSnapshot is pure and lives in packages/domain. It merges platform, tenant and location
configuration through the TS-04 resolver, merges tenant keywords with location additions, filters styles
by tenant enablement and by locale, and returns an immutable snapshot whose version is a content hash of
the resolved payload.

The hash must be stable. Write the tests that prove it: identical inputs produce an identical hash;
reordering object keys does not change it; reordering a non-semantic array does not change it; changing
one banned term does; adding a location override does. Keyword sortOrder IS semantic — do not
canonicalise it away.

Nothing that changes without the configuration changing may enter the hashed payload. No timestamps, no
generated ids. An unstable hash destroys the cache hit rate silently and shows up as a cost problem
weeks later.

Deep-freeze the returned snapshot so a downstream mutation throws in development.
```
