# TS-06 adversarial review

1. **Automated Schema Invariant Enforcement:**
   `rls-coverage.test.ts` automatically guards against future schema additions that might forget to define RLS policies or omit `FORCE ROW LEVEL SECURITY`.

2. **Defense in Depth:**
   Even if an application developer forgets a `tenant_id` filter in a database query, PostgreSQL RLS transparently prevents data from other tenants from being returned.

3. **Insertion Safety:**
   `WITH CHECK` ensures that an authenticated tenant cannot insert records attributed to a different tenant.
