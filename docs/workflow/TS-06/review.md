# TS-06 review

## Behavioral evidence

- `tenancy-isolation.test.ts` proves that queries executed within `withTenant(A)` retrieve only Tenant A's data without needing explicit application WHERE filters, and unscoped queries return zero rows.
- `rls-coverage.test.ts` scans the schema and migration to prove that all 29 tenant-scoped models have `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- `role-grants.test.ts` verifies that `context_svc` and `generation_svc` have disjoint privileges that enforce the control-plane and execution-plane separation.
