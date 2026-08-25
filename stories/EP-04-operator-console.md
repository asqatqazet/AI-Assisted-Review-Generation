# EP-04 Operator Console — implementation record

- **Status:** Control plane, execution read plane and FakeProvider Bench implemented; AWS release evidence pending
- **Date:** 2026-08-24
- **Relates to:** `stories/EPICS.md` EP-04 and `prototypes/Admin.dc.html`

## Implemented shape

The Console is one React surface whose navigation and scope come only from the
current Access Grants returned by Context. A crossed or unknown Tenant/Location
pair produces the same generic 404; the browser and BFF never infer authority.

```text
browser ── Console HTTP ──> web-bff (Cognito session -> identity)
                              │
                              ├── console-request ──> Context
                              │                       ├── current Access Grants
                              │                       └── ConsoleControlStore
                              │
                              ├── authorize-console-read ──> Context
                              │<── signed exact scope/query receipt
                              ├── console-read + receipt ──> Generation
                              │                              └── fixed execution projections
                              │
                              └── authorize-console-bench ─> Context
                               <─ signed canonical Fake workload
                                  console-bench ──> Generation shared pipeline
```

The BFF owns orchestration only. Context and Generation never call or import
one another. Generation receives complete immutable configuration and has no
configuration-reader path.

## Authority and database roles

The one Context deployable opens two sealed pools with disjoint roles:

| Role | May do | Must not do |
|---|---|---|
| `context_runtime_svc` | Reviewer entry, Review Session, admission and published snapshot reads | Operator/grant/configuration writes |
| `console_control_svc` | Authorized Console configuration and Access Grant reads/writes | Operate without `app.operator_id`; read execution evidence |
| `generation_svc` | Execution fence, Generation/Draft evidence and fixed Console execution projections | Read mutable configuration or Access Grants |

RLS authorization joins only active Role Definitions with the required
capability. A missing operator context fails closed on Console connections; it
does not fall through to the reviewer runtime branch. A non-BYPASS migration
owner has only the maintenance visibility needed for invariant functions and
idempotent seed execution.

Overview, Analytics and Generation detail are served in Generation through
fixed `SECURITY DEFINER` projections. Context signs the exact Tenant set,
query, expiry and privileged-raw bit; Generation verifies it before any read.
`PUBLIC` has no execute grant and raw candidate/Unsupported Output remains
audit-gated.

## Configuration authoring and publication

- Tenant and Location settings use discriminated schemas with finite/range
  checks. `NaN`, a wrong value kind and an out-of-range policy value are
  rejected at the contract boundary.
- Save Draft, Cancel and Publish are distinct commands. Writes carry a strong
  canonical ETag through `If-Match`; a stale or absent precondition cannot
  overwrite another operator.
- Publish is one PostgreSQL transaction: compare-and-swap the Draft, increment
  revision, append audit evidence and materialize one immutable Effective
  Configuration Snapshot for every affected Location. An idempotent retry
  returns the same snapshot ids.
- Entry, Review Session and Generation admission resolve the published
  snapshot first. Unpublished Fact Option, Review Format, Action and policy
  edits remain invisible.
- Prompt authoring and promotion are separate. Exactly one promoted Prompt per
  Tenant + Action is materialized using a server-derived canonical hash.
- Provider routing moves primary atomically. A unique index and deferred
  invariant require exactly one primary route.

## Bench

Bench has a separate signed audience. Context resolves one published snapshot
and validates scope, source ownership, Action, Review Format, promoted Prompt,
Fact Options and Fake provider before signing. Generation reuses the shared
generation application module with a non-persistent, non-billable sink. Bench
cannot create a Generation, Provider Attempt, Disposition or reservation.
Commands that require immutable source-Generation evidence fail closed until
that evidence is supplied; the current supported Bench commands are Generate
and Paraphrase.

## Authentication and logout

Cognito uses Authorization Code + PKCE. The BFF stores provider tokens only in
an encrypted HttpOnly session, refreshes near ID-token expiry, verifies the
refreshed issuer/audience/subject/email, retains rotated refresh tokens, calls
the Cognito revocation endpoint on logout and then sends the browser through
the Hosted UI logout endpoint. Clearing only the local cookie is not a logout.

The local composition uses an explicit development-only auth adapter with
Platform and Tenant-only identities. It is reachable only from
`apps/web-bff/dev.ts`, never from the production runtime, and must not be
internet-exposed.

## Provider mode

The public `student-low-quota` profile is physically FakeProvider-only.
`REVIEW_PROVIDER_MODE` is required by Context and Generation. Context rejects
a new or replayed paid route before reservation/capacity writes; Generation
also rejects before resolving credentials or a gateway. Deployment freezes
Generation before profile mutation and leaves it frozen on failure. OpenAI and
Gemini adapters require a separately funded and explicitly approved profile.

## Primary implementation seams

| Rule | Module |
|---|---|
| Role/capability/scope authorization | `packages/domain/src/console/access.ts`, `apps/context-service/src/console/scope.ts` |
| Draft/CAS/publish and Prompt promotion | `apps/context-service/src/console/console-service.ts`, `packages/db/src/control-plane/console-store.ts` |
| Uniform not-found and request binding | `apps/web-bff/src/console-routes.ts` |
| Signed execution-read authorization | `apps/context-service/src/console/console-read-authority.ts`, `apps/generation-service/src/console-read-verifier.ts` |
| Signed Bench authorization | `apps/context-service/src/console/console-bench-authorizer.ts`, `apps/generation-service/src/console-bench-handler.ts` |
| Capability-driven React surface | `apps/web-bff/src/frontend/console/` |

## Database changes and evidence

- `20260823000018_configuration_publication`: Draft/CAS/audit, Prompt
  deployment/promotion, canonical publication and provider-routing invariants.
- `20260823000019_operator_capability_rls`: separate runtime/control roles,
  active-role capability checks and non-BYPASS migration-owner support.
- `20260823000020_console_execution_projections`: fixed receipt-bound
  execution projections with no public execute grant.

Evidence includes a clean 22-migration replay, idempotent canonical seed,
direct-role PostgreSQL isolation tests, local browser composition with Platform
and Tenant-only identities, a generic crossed-scope 404, and visible release
SHA. The remaining work is external evidence: rotate exposed credentials,
protect GitHub Environment `student`, install the bounded AWS deployment role,
execute the candidate-to-live deployment and retain a rollback drill.
