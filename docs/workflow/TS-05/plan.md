# TS-05 plan

## Outcome

Add PostgreSQL Row-Level Security (RLS) policies (`ENABLE` and `FORCE ROW LEVEL SECURITY`) and disjoint service roles (`context_svc`, `generation_svc`) across all tenant-scoped tables, and provide `withTenant` in `packages/db/src/tenant-context.ts`.

## Public seam

- Migration `20260813000001_rls_and_roles/migration.sql`
- `packages/db/src/tenant-context.ts`: `withTenant(tenantId, fn)`
- Roles: `context_svc`, `generation_svc`
