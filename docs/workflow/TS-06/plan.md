# TS-06 plan

## Outcome

Establish the Tenancy Invariant Test Suite to verify multi-tenant isolation, RLS coverage across all tenant-scoped tables, and disjoint service role grants.

## Public seam

- `packages/db/src/tenancy-isolation.test.ts`
- `packages/db/src/rls-coverage.test.ts`
- `packages/db/src/role-grants.test.ts`
