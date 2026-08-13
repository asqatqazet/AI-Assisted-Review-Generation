# TS-15 · Context Service — control plane

**Scope:** service · **Size:** M · **TDD:** not applicable · **Depends on:** TS-05, TS-07

## Story

As the control plane, I need to own all configuration across three scopes and serve immutable versioned
snapshots, so that the execution plane never reads configuration and configuration changes are
observable as version changes.

## Context

Low traffic, high read, cacheable, strongly consistent. That shape is why it is a Lambda and why its
snapshot is ETag'd — see `01-SYSTEM-DESIGN.md` §10.

## Acceptance criteria

- [ ] Hono app in `apps/context-service`, packaged for Lambda + Function URL
- [ ] `GET /context/:tenantId/:locationId` returns a `ResolvedConfigSnapshot` with a strong `ETag`
      equal to the snapshot's content hash; `If-None-Match` returns 304
- [ ] Write endpoints for all three scopes, each validating the caller's role against the scope
- [ ] Saving tenant context increments `contextVersion`; drafts already written keep their version
- [ ] Connects as the `context_svc` Postgres role only; **has no LLM client dependency at all** —
      enforced by TS-02
- [ ] Every read and write goes through `withTenant`; platform-scope operations use an explicit
      platform path that is role-gated
- [ ] Tenant provisioning copies the platform policy template, creating one location and no keywords —
      so a fresh tenant's survey correctly renders `not-configured`
- [ ] Integration tests against testcontainers cover: snapshot shape, ETag stability across identical
      reads, 304 on match, version increment on write, role rejection on a scope the caller cannot hold

## Technical notes

- ETag stability is the whole cost argument. If the snapshot hash moves without configuration changing
  (TS-07), every generation re-fetches and the cache is decorative. Test it here, not just in the domain.
- The service must not import anything from `packages/llm`. That absence is the boundary; verify the
  fitness function actually catches an attempt.
- Provisioning producing a deliberately empty tenant is a small thing that demonstrates you thought about
  the first-run state rather than only the seeded one.

## Harness prompt

```
Read stories/TS-15-context-service.md and 01-SYSTEM-DESIGN.md §6 and §9.

Build apps/context-service as a Hono app packaged for Lambda with a Function URL.

The read endpoint returns the resolved config snapshot with a strong ETag equal to its content hash, and
honours If-None-Match with a 304. Write an integration test proving the ETag is stable across identical
reads — if the hash moves without configuration changing, the BFF cache is decorative and the cost story
collapses.

Write endpoints cover all three scopes and validate the caller's role against the scope being written.
Saving tenant context increments contextVersion, and drafts already written keep the version they were
composed against.

This service connects as the context_svc Postgres role and has no LLM client dependency whatsoever. That
absence is the control-plane boundary. After building it, deliberately add an import from packages/llm,
confirm dependency-cruiser rejects it, and remove it.

Tenant provisioning copies the platform policy template and creates one location with no keywords, so a
freshly provisioned tenant's survey correctly shows not-configured.
```
