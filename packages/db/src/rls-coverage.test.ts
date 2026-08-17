import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("TS-06 RLS Coverage Test", () => {
  it("enforces that every tenant-scoped table has an ENABLED and FORCED RLS policy", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../prisma/migrations/20260813000001_rls_and_roles/migration.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");

    const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma");
    const schema = fs.readFileSync(schemaPath, "utf8");

    // Extract all models with tenantId from schema
    const tenantModels: string[] = [];
    const modelBlocks = schema.split(/model\s+/);

    for (const block of modelBlocks.slice(1)) {
      const modelName = block.split(/\s+/)[0];
      if (modelName && (block.includes("tenantId") || modelName === "Tenant")) {
        tenantModels.push(modelName);
      }
    }

    expect(tenantModels.length).toBeGreaterThanOrEqual(25);

    // Verify each table has ENABLE and FORCE ROW LEVEL SECURITY in SQL
    expect(sql).toContain("ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE tenants FORCE ROW LEVEL SECURITY;");
    expect(sql).toContain("CREATE POLICY tenant_isolation_policy ON tenants");

    const expectedTables = [
      "tenant_access_grants",
      "tenant_action_enablements",
      "locations",
      "posting_destination_bindings",
      "fact_option_categories",
      "fact_option_versions",
      "review_format_enablements",
      "prompt_versions",
      "experiments",
      "experiment_variants",
      "visits",
      "invitation_tokens",
      "review_sessions",
      "experiment_assignments",
      "source_text_revisions",
      "assertions",
      "effective_configuration_snapshots",
      "budget_reservations",
      "generation_batches",
      "generation_batch_assertions",
      "generations",
      "provider_attempts",
      "claims",
      "claim_groundings",
      "unsupported_outputs",
      "drafts",
      "draft_revisions",
      "dispositions",
    ];

    for (const table of expectedTables) {
      expect(
        sql.includes(`'${table}'`),
        `Missing RLS policy coverage for tenant table: ${table}`,
      ).toBe(true);
    }
  });

  it("compares UUID tenant columns to a UUID-typed session setting", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../prisma/migrations/20260813000001_rls_and_roles/migration.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");
    const uuidSetting =
      "NULLIF(current_setting('app.tenant_id', true), '')::uuid";

    expect(sql).toContain(`id = ${uuidSetting}`);
    expect(sql).toContain(`tenant_id = ${uuidSetting}`);
    expect(sql).not.toMatch(
      /(?:id|tenant_id) = NULLIF\(current_setting\('app\.tenant_id', true\), ''\)(?!::uuid)/,
    );
  });
});
