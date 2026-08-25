import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(
  here,
  "../prisma/migrations/20260824000023_prompt_quality_gate/migration.sql",
);
const candidacyMigrationPath = path.join(
  here,
  "../prisma/migrations/20260824000027_prompt_candidacy_decisions/migration.sql",
);
const draftActionMigrationPath = path.join(
  here,
  "../prisma/migrations/20260824000031_prompt_deployment_draft_action/migration.sql",
);

describe("Prompt evaluation and Experiment quality gate", () => {
  it("stores immutable, Tenant-scoped evaluation evidence", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE prompt_evaluation_results");
    expect(sql).toMatch(
      /CREATE TRIGGER prompt_evaluation_results_append_only[\s\S]*BEFORE UPDATE OR DELETE ON prompt_evaluation_results/u,
    );
    expect(sql).toMatch(
      /ALTER TABLE prompt_evaluation_results FORCE ROW LEVEL SECURITY/u,
    );
    expect(sql).toMatch(
      /GRANT SELECT ON prompt_evaluation_results TO console_control_svc/u,
    );
    expect(sql).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON prompt_evaluation_results FROM console_control_svc/u,
    );
  });

  it("makes Prompt deployment depend on latest passing evaluation evidence", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(
      /CREATE TRIGGER prompt_deployments_quality_gate[\s\S]*BEFORE INSERT OR UPDATE ON prompt_deployments/u,
    );
    expect(sql).toContain("PROMPT_DEPLOYMENT_QUALITY_GATE_REJECTED");
    expect(sql).toMatch(
      /latest_passed_cases\s*<>\s*latest_evaluated_cases/u,
    );
    expect(sql).toMatch(/latest_evaluated_cases\s*<=\s*0/u);
  });

  it("serializes one validated running Experiment per Tenant and Action", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(
      /CREATE UNIQUE INDEX experiments_one_running_per_tenant_action[\s\S]*WHERE status = 'RUNNING'/u,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER experiments_running_quality_gate[\s\S]*BEFORE INSERT OR UPDATE OF status ON experiments/u,
    );
    expect(sql).toContain("EXPERIMENT_VARIANTS_QUALITY_GATE_REJECTED");
  });

  it("requires an append-only Candidate decision instead of inferring lifecycle from evaluation", () => {
    const sql = fs.readFileSync(candidacyMigrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE prompt_candidacy_decisions");
    expect(sql).toMatch(
      /CREATE TRIGGER prompt_candidacy_decisions_append_only[\s\S]*BEFORE UPDATE OR DELETE ON prompt_candidacy_decisions/u,
    );
    expect(sql).toMatch(
      /CREATE FUNCTION prompt_is_effective_candidate[\s\S]*FROM public\.prompt_candidacy_decisions/u,
    );
    expect(sql).toMatch(
      /CREATE FUNCTION enforce_prompt_deployment_candidacy_gate[\s\S]*prompt_is_effective_candidate/u,
    );
    expect(sql).toMatch(
      /CREATE FUNCTION enforce_running_experiment_candidacy_gate[\s\S]*prompt_is_effective_candidate/u,
    );
  });

  it("backfills legacy staged Prompt deployments from a same-Tenant immutable Prompt", () => {
    const sql = fs.readFileSync(draftActionMigrationPath, "utf8");

    expect(sql).toMatch(
      /prompt\.tenant_id\s*=\s*draft\.tenant_id[\s\S]*prompt\.id\s*=\s*\(change\.value ->> 'promptVersionId'\)::uuid/u,
    );
    expect(sql).toContain("LEGACY_PROMPT_DEPLOYMENT_DRAFT_ORPHANED");
    expect(sql).toMatch(/jsonb_build_object\(\s*'action'/u);
    expect(sql).not.toMatch(/DELETE FROM configuration_drafts/u);
  });
});
