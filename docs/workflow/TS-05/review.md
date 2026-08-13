# TS-05 review

## Behavioral evidence

- Every table containing `tenant_id` (and the `tenants` root table) has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- `USING` and `WITH CHECK` clauses enforce isolation on reads, updates, and inserts using `current_setting('app.tenant_id', true)`.
- Disjoint PostgreSQL roles `context_svc` and `generation_svc` restrict access according to the control-plane and execution-plane boundary.
- Platform catalogue tables are vendor-owned and deliberately excluded from RLS.
