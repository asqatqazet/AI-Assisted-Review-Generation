import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(
  here,
  "../prisma/migrations/20260824000029_platform_configuration_publication/migration.sql",
);

describe("Platform Configuration Draft database boundary", () => {
  it("uses Platform-owned tables instead of widening Tenant configuration_drafts", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    expect(migration).toContain("CREATE TABLE platform_configuration_drafts");
    expect(migration).toContain("CREATE TABLE platform_configuration_publications");
    expect(migration).not.toMatch(/ALTER TABLE configuration_drafts/u);
  });

  it("forces RLS and excludes every non-Console service role", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    for (const table of [
      "platform_configuration_drafts",
      "platform_configuration_publications",
    ]) {
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toMatch(
      /REVOKE ALL ON platform_configuration_drafts, platform_configuration_publications\s+FROM PUBLIC, context_runtime_svc, generation_svc/u,
    );
  });

  it("derives and rechecks the complete capability union from staged changes", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    expect(migration).toContain("platform_configuration_required_capabilities");
    expect(migration).toContain("'platform:admin'");
    expect(migration).toContain("'provider:manage'");
    expect(migration).toContain("review_operator_has_all_platform_capabilities");
    expect(migration).toMatch(
      /SELECT 'platform:admin'::text AS capability[\s\S]*WHEN 'set-provider-routing' THEN 'provider:manage'[\s\S]*WHEN 'publish-price-rate' THEN 'provider:manage'/u,
    );
  });

  it("lets Platform publication read deployed Prompts without exposing Drafts", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    expect(migration).toMatch(
      /CREATE POLICY operator_or_service_read_policy ON prompt_deployments[\s\S]*review_operator_has_platform_capability\('platform:admin'\)/u,
    );
    expect(migration).toMatch(
      /CREATE POLICY operator_or_service_read_policy ON prompt_versions[\s\S]*review_operator_has_platform_capability\('platform:admin'\)[\s\S]*EXISTS \([\s\S]*FROM prompt_deployments AS deployed[\s\S]*deployed\.prompt_version_id = prompt_versions\.id/u,
    );
  });

  it("makes publication evidence append-only and idempotent by Draft identity", () => {
    const migration = fs.readFileSync(migrationPath, "utf8");
    expect(migration).toMatch(
      /UNIQUE \(draft_id, draft_revision\)/u,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER platform_configuration_publications_append_only[\s\S]*BEFORE UPDATE OR DELETE ON platform_configuration_publications/u,
    );
    expect(migration).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON platform_configuration_publications/u,
    );
  });
});
