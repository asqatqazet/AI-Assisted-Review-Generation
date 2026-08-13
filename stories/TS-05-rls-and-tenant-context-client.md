# TS-05 · RLS policies + tenant-context client

**Scope:** data · **Size:** M · **TDD:** not applicable (TS-06 is the test story) · **Depends on:** TS-04

## Story

As the system, I need tenant isolation enforced by the database engine, so that a missing `WHERE`
clause anywhere in the application cannot leak another tenant's data.

## Context

Pool-model tenancy with isolation pushed down to Postgres. Application-level scoping is one forgotten
filter away from a breach; RLS makes the leak impossible rather than unlikely. This is the highest-stakes
story in the backlog — go slowly.

## Acceptance criteria

- [ ] Every `tenant_id`-bearing table has `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`
- [ ] Policy on each: `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` with a matching
      `WITH CHECK` so a mismatched insert is rejected, not just hidden
- [ ] `packages/db/src/tenant-context.ts` exports
      `withTenant<T>(tenantId, fn: (tx) => Promise<T>): Promise<T>`, opening a transaction and issuing
      `SET LOCAL app.tenant_id = $1` before `fn`
- [ ] This file is the **only** module permitted to import the raw Prisma client (enforced by TS-02)
- [ ] Two Postgres roles exist with disjoint grants:
      `context_svc` (no access to `generations`, `generation_outcomes`) and
      `generation_svc` (no access to `operators`; no write on `tenant_settings`, `prompt_versions`)
- [ ] Each service connects as its own role; connection strings differ per deployable
- [ ] Platform-scope tables (`platform_settings`, `providers`, `price_table`, `style_plugins`) are
      **not** RLS-protected and are documented as vendor-owned

## Technical notes

- `FORCE ROW LEVEL SECURITY` matters: without it the table owner bypasses policies, and in development
  you are usually connected as the owner. Omitting it is how an RLS setup passes review and fails in
  production.
- `current_setting('app.tenant_id', true)` — the `true` returns null instead of erroring when unset, so
  an unscoped query returns zero rows rather than throwing an opaque error. Choose this deliberately and
  write down why; TS-06 asserts the resulting behaviour.
- `SET LOCAL` is transaction-scoped. Any query outside `withTenant` has no tenant and therefore sees
  nothing — that is the desired failure mode.
- Prisma client extensions, not middleware. Middleware cannot guarantee the transaction boundary.

## Out of scope

The tests that prove all this (TS-06). Location-level scoping — locations live inside the tenant
boundary and are not a security boundary.

## Harness prompt

```
Read stories/TS-05-rls-and-tenant-context-client.md and 01-SYSTEM-DESIGN.md §7.

Add row-level security to every tenant-scoped table: ENABLE and FORCE, a USING policy on
current_setting('app.tenant_id', true), and a matching WITH CHECK so a mismatched insert is rejected
rather than merely invisible. Explain in a migration comment why FORCE is there — without it the owner
bypasses the policy, which is exactly the connection used in development.

Then write packages/db/src/tenant-context.ts exporting withTenant(tenantId, fn), which opens a
transaction and issues SET LOCAL app.tenant_id before running fn. Use a Prisma client extension, not
middleware — middleware cannot guarantee the transaction boundary. This file is the only module allowed
to import the raw Prisma client.

Finally, create the context_svc and generation_svc Postgres roles with disjoint grants per §7, and wire
each service to its own connection string.

Platform-scope tables are vendor-owned and deliberately not RLS-protected. Document that.

Write no tests in this story. TS-06 is the test story and it must be able to fail against this work.
```
