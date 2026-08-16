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
});
