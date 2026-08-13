# TS-05 adversarial review

1. **FORCE ROW LEVEL SECURITY:**
   Without `FORCE`, PostgreSQL table owners bypass RLS. In development environments where the application connects as the database owner, `FORCE` is essential to prevent bypass.

2. **`current_setting('app.tenant_id', true)` Safe Default:**
   Passing `true` returns NULL when the setting is unset rather than throwing an internal error, ensuring queries outside a tenant session fail closed and return 0 rows.

3. **Disjoint Service Grants:**
   The control plane cannot read generation results or claims, and the execution plane cannot access operator accounts or modify tenant configuration directly.
