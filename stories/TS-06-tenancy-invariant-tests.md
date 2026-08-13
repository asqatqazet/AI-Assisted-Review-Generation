# TS-06 · Tenancy invariant test suite

**Scope:** data · **Size:** M · **TDD:** **required** · **Depends on:** TS-05

## Story

As a reviewer with five minutes, I need one obviously-named test file that proves cross-tenant leakage
is impossible, so that the isolation claim is demonstrated rather than asserted.

## Context

This is the single artifact most likely to be opened first by an evaluator. It is worth more than any
screen in the console. Name it so it is found without searching.

## Acceptance criteria

**`packages/db/__tests__/tenancy-isolation.test.ts`** — testcontainers Postgres, real migrations:
- [ ] Seeds tenant A and tenant B with rows in **every** tenant-scoped table
- [ ] For each model: inside `withTenant(A)`, calls `findMany({})` with **no `where` clause** and
      asserts zero rows belong to B
- [ ] Asserts a query outside any tenant session returns zero rows
- [ ] Asserts an insert with a mismatched `tenant_id` is rejected by `WITH CHECK`
- [ ] Asserts an update that would move a row to another tenant is rejected
- [ ] Asserts a raw `$queryRaw` inside `withTenant(A)` is still constrained

**`packages/db/__tests__/rls-coverage.test.ts`**:
- [ ] Introspects `information_schema.columns` and `pg_policies`
- [ ] Fails if any table with a `tenant_id` column lacks an enabled, forced policy
- [ ] Lists offending tables by name in the failure message

**`packages/db/__tests__/role-grants.test.ts`**:
- [ ] Connecting as `generation_svc`, reading `operators` raises a permission error
- [ ] Connecting as `context_svc`, reading `generations` raises a permission error
- [ ] Each service role **can** reach its own tables

## Technical notes

- **Write these before TS-05 is finished if you can** — watching them fail against an unprotected schema
  is the strongest possible evidence they test something real. If TS-05 already landed, temporarily
  disable one policy, observe the failure, restore it, and record that in `docs/workflow/TS-06/verify.md`.
- The coverage test is the one that protects the future: it is what stops a later agent adding a table
  and forgetting the policy. Make its failure message name the table and the missing piece.
- Keep the container boot in a shared setup file. Three separate containers will make the suite slow
  enough that people stop running it.

## Definition of done — extra

`REVIEW.md` links this file by path. Cite it under the architecture pillar.

## Harness prompt

```
Read stories/TS-06-tenancy-invariant-tests.md.

Write three test files against a testcontainers Postgres running the real migrations.

tenancy-isolation.test.ts is the one that matters. Seed two tenants across every tenant-scoped table,
then inside withTenant(A) call findMany with NO where clause on each model and assert nothing belonging
to B comes back. Also assert: a query with no tenant session returns nothing; an insert with a
mismatched tenant_id is rejected by WITH CHECK; an update that would move a row across tenants is
rejected; and a raw $queryRaw inside a tenant session is still constrained.

rls-coverage.test.ts introspects pg_policies and information_schema and fails if any table carrying a
tenant_id column lacks an enabled and forced policy. Its failure message must name the offending tables
— this is the test that stops a future agent adding a table and forgetting.

role-grants.test.ts asserts generation_svc cannot read operators and context_svc cannot read
generations, and that each role can reach its own tables.

Before reporting done: temporarily disable one RLS policy, run the suite, capture the failure, restore
the policy. Paste that into docs/workflow/TS-06/verify.md. A test that has never been seen to fail is
not known to test anything.
```
