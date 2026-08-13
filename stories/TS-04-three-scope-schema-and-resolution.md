# TS-04 · Three-scope schema + effective-config resolution

**Scope:** data + domain · **Size:** L · **TDD:** **required** (the resolver) · **Depends on:** TS-03

## Story

As an operator changing a setting, I need the system to know which scope owns it and how it resolves,
so that I can see the blast radius of my change and a venue can differ from its brand without
duplicating its configuration.

## Context

This is the story that makes multi-tenancy structural rather than a column. Platform → tenant →
location, with overrides that store only what changed. The console's scope badges are rendered from the
resolver's provenance output, so the resolver is a product feature, not plumbing.

## Acceptance criteria

**Schema**
- [ ] Prisma schema for all three scopes per `01-SYSTEM-DESIGN.md` §8
- [ ] `keyword_categories` is a **table**, not an enum — a dental practice and a German restaurant
      cannot share one taxonomy
- [ ] `locations.overrides` is `jsonb` holding only overridden keys
- [ ] `keywords.location_id` is nullable: null = tenant-wide, set = venue addition
- [ ] Migrations run clean from empty; `pnpm db:reset` documented

**Resolver (pure, TDD)**
- [ ] `resolveEffectiveConfig({ platform, tenant, location }) → { value, provenance }` in
      `packages/domain`
- [ ] `provenance[field]` returns `"platform" | "tenant" | "location"` for every resolved field
- [ ] Reset semantics: deleting an override restores the tenant value **and a later tenant change still
      propagates** — proven by a test that changes the tenant after the reset
- [ ] Keyword resolution merges tenant set + location additions, preserving `sortOrder` within scope
- [ ] Unknown override keys are rejected, not silently ignored
- [ ] ≥15 tests including: no overrides, partial overrides, override equal to parent value, reset,
      inheritance after a parent change

## Technical notes

- **Write the resolver tests first.** This is the story where TDD is most obviously worth it: the
  semantics are subtle and the console renders its output directly.
- "Override equal to parent value" is the interesting case — it must still be recorded as an override,
  because a later parent change must not silently move it.
- Do not model locations as sub-tenants. They share the tenant's isolation boundary; they are a scope,
  not a security boundary.

## Out of scope

RLS (TS-05). The snapshot's version hash (TS-07).

## Harness prompt

```
Read stories/TS-04-three-scope-schema-and-resolution.md and 01-SYSTEM-DESIGN.md §3, §4 and §8.

Two parts.

First, the pure resolver in packages/domain — and do this with TDD, failing tests committed first as
test(TS-04). resolveEffectiveConfig takes platform defaults, tenant config and location overrides and
returns both the resolved value and, for every field, which scope supplied it. The console renders that
provenance as scope badges, so it is a product output rather than a debugging aid.

Two semantics I care about and want tested explicitly: an override whose value equals its parent is
still an override, and resetting an override must delete it rather than copy the parent value down —
so a later parent change still propagates. Write the test that changes the tenant after a reset.

Second, the Prisma schema for all three scopes. keyword_categories is a table, not an enum: a dental
practice and a German restaurant cannot share one taxonomy, and this is recorded in SPEC.md as a schema
revision the second tenant forced.

Do not add RLS yet — that is TS-05.
```
