# EP-04 Operator Console — implementation record

- **Status:** Control plane implemented end to end and persisted; execution-plane views await their own reader
- **Date:** 2026-08-19
- **Relates to:** `stories/EPICS.md` EP-04, and the prototype states in `prototypes/Admin.dc.html`

## What the Console is

One React surface rendering every Tenant entirely from data. The 23 prototype
states resolve to 19 Console views and 25 commands, all carried over the
existing BFF -> Context Lambda seam as a single `console-request` operation.

```text
browser ──GET  /api/v1/console/views/:view?tenantId&locationId&…──┐
         └POST /api/v1/console/commands?tenantId&locationId ──────┤
                                                                  ▼
                                   web-bff  (session -> identity only)
                                                                  │
                              console-request { identity, scope, request }
                                                                  ▼
                              context-service console service
                              ├── resolve current Access Grants
                              ├── authorize the requested scope
                              └── ConsoleStore  (persistence seam)
```

The BFF never asserts scope. It forwards the OIDC identity and the *requested*
scope; Context re-resolves Grants and decides. A denial — unknown id, another
Tenant's id, or a missing capability — is the same `not-found`, rendered as the
same 404 body, so nothing leaks across a Tenant boundary.

## Where each rule lives

| Rule | Module |
|---|---|
| Role, capabilities, scope authorization | `packages/domain/src/console/access.ts` |
| Inheritance, override, reset-deletes-the-row | `packages/domain/src/console/inheritance.ts` |
| Running experiments immutable, price versioning, next published version | `packages/domain/src/console/authoring.ts` |
| Production QR from the real survey URL | `packages/domain/src/console/qr-code.ts` |
| View/command scope and capability policy | `apps/context-service/src/console/scope.ts` |
| Projections and manifest rule validation | `apps/context-service/src/console/projections.ts`, `manifest-rules.ts` |
| Transport, uniform not-found, origin check | `apps/web-bff/src/console-routes.ts` |
| Scope in the URL, capability navigation, views | `apps/web-bff/src/frontend/console/` |

## Deliberate deviations from the epic brief

- Routes are under `/console`, not `/admin`. The operator OIDC flow already
  validates `returnTo` against `/console`, and changing it would move an
  accepted security boundary for cosmetic reasons.
- Contracts are the repo's zod DTOs in `@review/contracts/console` rather than a
  separate OpenAPI document. They are the single shared definition — the BFF
  parses with them and the frontend infers its types from the same schemas, so
  no DTO is duplicated by hand.
- Canonical domain language is used in code (Review Format, Fact Option,
  Assertion); the prototype's `styles` / `keywords` names survive only as wire
  and route names, per `AGENTS.md`.

## Plane split

`context_svc` has no grant on `generations`, `claims`, `drafts`, `dispositions`
or `provider_attempts` — those belong to `generation_svc`, and
`.dependency-cruiser.cjs` stops the control-plane module reaching them. The
Console store is therefore split along the boundary the database already
enforces rather than by widening a role:

| Served by `ConsoleControlPlaneStore` (PostgreSQL, context-service) | Needs `ConsoleExecutionStore` |
|---|---|
| bootstrap, locations, tenant and location settings, distribution, destinations, business context, fact options, review formats, actions, prompts, experiment definitions, platform accounts/providers/catalogue/settings | overview totals, analytics rows, Generation detail and lineage, bench runs, experiment outcome counts |

Until that reader exists the execution-plane views answer with the same
not-found projection as an unauthorized scope, and experiment variants report
`metricsAvailable: false` rather than presenting unknown counts as zero.

Month-to-date spend is an exception that lands in the control plane:
`budget_reservations.actual_cost_micros` is settled through the paid-work
protocol and is readable by `context_svc`, so account spend against budget is
real rather than deferred.

## Migration 20260819000011

- `tenant_context_versions` — versioned business context. `context_svc` gets
  `SELECT, INSERT` and no `UPDATE`/`DELETE`, so immutability is a grant, not a
  convention.
- `prompt_versions.version` / `.status` / `.evaluation_score` / `.created_by` —
  legible version history alongside the existing content hash.
- `provider_models.routing_priority` / `.fallback_priority` — explicit routing
  instead of two booleans on the provider.
- The platform-scope writes an authorized operator performs.

## Not implemented## Not implemented

`ConsoleExecutionStore` has no implementation. It belongs to the generation
service, which already holds the `generation_svc` role and the execution-plane
Prisma client, and would reach the Console over its own port rather than
through Context.

The PostgreSQL control-plane adapter is covered by
`packages/db/src/control-plane/console-store.integration.test.ts`, which runs
against the Postgres service in CI and skips without `DATABASE_URL`.
