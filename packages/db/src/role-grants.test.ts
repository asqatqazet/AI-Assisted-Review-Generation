import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("TS-06 Role Grants Test", () => {
  it("enforces disjoint grants between context_svc and generation_svc", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../prisma/migrations/20260813000001_rls_and_roles/migration.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    // 1. Roles are created
    expect(sql).toContain("CREATE ROLE context_svc");
    expect(sql).toContain("CREATE ROLE generation_svc");

    // 2. context_svc has grants for control plane
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON.*tenants.*TO context_svc;/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON.*locations.*TO context_svc;/);

    // 3. context_svc does NOT have access to generation results or claims
    expect(sql).not.toMatch(/GRANT.*ON.*generations.*TO context_svc;/);
    expect(sql).not.toMatch(/GRANT.*ON.*claims.*TO context_svc;/);

    // 4. generation_svc has grants for execution plane
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON.*generations.*TO generation_svc;/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON.*claims.*TO generation_svc;/);

    // 5. generation_svc does NOT have access to operators or write on tenants
    expect(sql).not.toMatch(/GRANT.*ON.*operators.*TO generation_svc;/);
    expect(sql).not.toMatch(/GRANT.*INSERT.*ON.*tenants.*TO generation_svc;/);

    // 6. generation_svc receives resolved configuration as a value and has no
    // database grant that could become a second configuration-reader path.
    expect(sql).not.toMatch(
      /GRANT\s+SELECT\s+ON[^;]*(?:platform_settings|providers|provider_models|price_rates|review_format_versions|effective_configuration_snapshots)[^;]*TO generation_svc;/,
    );

    // 7. Context is the only admission/reservation writer; Generation receives
    // the resulting permit and snapshot through its function parameters.
    expect(sql).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON[^;]*budget_reservations[^;]*generation_batches[^;]*generation_batch_assertions[^;]*TO context_svc;/,
    );
    expect(sql).not.toMatch(
      /GRANT[^;]*ON[^;]*(?:budget_reservations|generation_batches|generation_batch_assertions)[^;]*TO generation_svc;/,
    );

    // 8. Deployment supplies database credentials out of band; migrations do
    // not commit passwords or password-shaped placeholders.
    expect(sql).not.toMatch(/CREATE ROLE[^;]*PASSWORD/i);
    expect(sql).not.toContain("context_svc_secret");
    expect(sql).not.toContain("generation_svc_secret");
  });

  it("seals new Console and reviewer versions behind disjoint login roles while retaining the rollback bridge", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../prisma/migrations/20260823000019_operator_capability_rls/migration.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/CREATE ROLE context_runtime_svc WITH LOGIN NOINHERIT/u);
    expect(sql).toMatch(/CREATE ROLE console_control_svc WITH LOGIN NOINHERIT/u);
    expect(sql).toContain(
      "ALTER ROLE context_svc LOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;",
    );
    expect(sql).toContain(
      "the historical shared login remains only for the bounded rollback bridge",
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION review_operator_has_tenant_capability\(uuid, text\)\s+TO context_runtime_svc, console_control_svc, context_svc;/u,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION review_operator_has_tenant_capability_privileged\(uuid, text\)\s+TO console_control_svc, context_svc;/u,
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION review_operator_has_tenant_capability_privileged\(uuid, text\) TO context_runtime_svc;/u,
    );
    expect(sql).not.toMatch(
      /GRANT[^;]*(?:operators|tenant_access_grants|platform_access_grants)[^;]*TO context_runtime_svc;/u,
    );
    expect(sql).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON[^;]*(?:review_sessions|entry_challenges)[^;]*TO context_runtime_svc;/u,
    );
    expect(sql).toContain(
      "current_user IN ('context_runtime_svc', 'context_svc')",
    );
  });

  it("keeps FORCE RLS usable by the exact migration owner without widening a service role", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../prisma/migrations/20260823000019_operator_capability_rls/migration.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("migration_owner_maintenance_policy");
    expect(sql).toMatch(/class\.relowner\s*=\s*role\.oid/u);
    expect(sql).toMatch(/role\.rolname\s*=\s*current_user/u);
    expect(sql).toMatch(
      /CREATE POLICY migration_owner_maintenance_policy ON %I FOR ALL TO %I/u,
    );
    expect(sql).not.toMatch(
      /CREATE POLICY migration_owner_maintenance_policy[^;]*TO PUBLIC/u,
    );
  });
});
