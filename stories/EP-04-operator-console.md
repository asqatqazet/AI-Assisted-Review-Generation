# EP-04 Operator Console — implementation record

- **Status:** Control plane implemented end to end except the PostgreSQL adapter behind `ConsoleStore`
- **Date:** 2026-08-18
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

## Not implemented

`ConsoleStore` (`apps/context-service/src/console/store.port.ts`) has no
PostgreSQL implementation yet. The service, transport and UI are complete and
tested against the in-memory store used by the service tests.

Two things block a responsible implementation:

1. **No database in the authoring environment.** `AGENTS.md` requires real
   Postgres for persistence behavior; a persistence adapter whose required test
   cannot be executed would be unverified code behind a green gate.
2. **Two schema gaps.** `prisma/schema.prisma` has no versioned business-context
   table (ADM-CFG-01 needs one), and `PromptVersion` carries no `version`,
   `status` or `evaluationScore` column (ADM-AI-01 needs all three). Both need a
   migration plus RLS policies, which also need a database to verify.

Everything else — including the alert conditions, analytics grain and lineage —
maps onto existing tables.
