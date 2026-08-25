import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../prisma/migrations/20260824000032_prompt_release_evidence_and_linearization/migration.sql",
);

describe("Prompt release evidence and publication linearization", () => {
  it("makes a complete canonical report mandatory for every new Evaluation Result", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    for (const column of [
      "suite_name",
      "suite_manifest_hash",
      "report_document",
      "report_canonical",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `ALTER TABLE prompt_evaluation_results[\\s\\S]*ADD COLUMN ${column}`,
          "u",
        ),
      );
    }
    expect(sql).toMatch(
      /ADD CONSTRAINT prompt_evaluation_results_complete_columns CHECK \([\s\S]*\) NOT VALID;/u,
    );
    expect(sql).not.toMatch(/DELETE FROM prompt_(?:evaluation_results|candidacy_decisions)/u);
    expect(sql).not.toContain("DISABLE TRIGGER");
    expect(sql).not.toContain("SET NOT NULL");
    expect(sql).toMatch(
      /CREATE TRIGGER prompt_evaluation_results_complete_evidence[\s\S]*BEFORE INSERT ON prompt_evaluation_results/u,
    );
    expect(sql).toMatch(/\^\[0-9a-f\]\{40\}\$/u);
    expect(sql).toContain("repeat('0', 40)");
    expect(sql).toMatch(
      /digest\(convert_to\(NEW\.report_canonical, 'UTF8'\), 'sha256'\)/u,
    );
    expect(sql).toMatch(
      /NEW\.report_document\s+IS DISTINCT FROM\s+parsed_report/u,
    );
    expect(sql).toContain("PROMPT_EVALUATION_EVIDENCE_INVALID");
  });

  it("allows strict re-evaluation candidacy while keeping retirement permanent", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain(
      "DROP CONSTRAINT prompt_candidacy_decisions_one_kind_per_prompt",
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX prompt_candidacy_decisions_candidate_evidence_unique[\s\S]*evaluation_result_id[\s\S]*WHERE decision = 'CANDIDATE'/u,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX prompt_candidacy_decisions_one_retirement_per_prompt[\s\S]*WHERE decision = 'RETIRED'/u,
    );
    expect(sql).toMatch(
      /NEW\.decision = 'CANDIDATE'[\s\S]*decision\.decision = 'RETIRED'/u,
    );
  });

  it("binds report Prompt, suite and case facts to their authoritative columns", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    for (const reportPath of [
      "promptVersion,id",
      "promptVersion,tenantId",
      "promptVersion,action",
      "promptVersion,key",
      "promptVersion,hash",
      "promptVersion,body",
      "promptVersion,variables",
      "suite,name",
      "suite,manifestHash",
      "suite,cases",
    ]) {
      expect(sql).toContain(`{${reportPath}}`);
    }
    expect(sql).toContain("jsonb_array_length(report_cases)");
    expect(sql).toMatch(/count\(\*\) FILTER[\s\S]*case_value -> 'passed' = 'true'::jsonb/u);
    expect(sql).toContain("prompt_evaluation_evidence_is_complete");
  });

  it("uses one ordered advisory-lock protocol for evidence, lifecycle and deployment", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("acquire_prompt_release_advisory_lock");
    expect(sql).toContain("pg_advisory_xact_lock_shared");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(
      /CREATE TRIGGER prompt_evaluation_results_00_release_lock[\s\S]*BEFORE INSERT ON prompt_evaluation_results/u,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER prompt_candidacy_decisions_00_release_lock[\s\S]*BEFORE INSERT ON prompt_candidacy_decisions/u,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER prompt_deployments_00_release_lock[\s\S]*BEFORE INSERT OR UPDATE ON prompt_deployments/u,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER experiments_running_00_prompt_release_lock[\s\S]*BEFORE INSERT OR UPDATE OF status ON experiments/u,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER experiment_variants_00_release_guard[\s\S]*BEFORE INSERT OR UPDATE OR DELETE ON experiment_variants/u,
    );
    const variantGuard = sql.slice(
      sql.indexOf("CREATE FUNCTION public.guard_experiment_variant_release_mutation"),
      sql.indexOf(
        "CREATE TRIGGER experiment_variants_00_release_guard",
      ),
    );
    expect(variantGuard).toContain("experiment.status = 'DRAFT'");
    expect(variantGuard).toContain(
      "ORDER BY lock_target.tenant_id, lock_target.experiment_id",
    );
    expect(variantGuard).toContain(
      "ORDER BY lock_target.tenant_id, lock_target.prompt_version_id",
    );
    expect(sql).toContain("EXPERIMENT_VARIANTS_IMMUTABLE_AFTER_DRAFT");
    expect(sql).toMatch(
      /ORDER BY lock_target\.tenant_id, lock_target\.prompt_version_id/u,
    );
  });

  it("exposes only the capability-checked Console publication-set lock", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(
      /CREATE FUNCTION public\.console_lock_prompt_release_set\(\s*requested_tenant_id uuid\s*\)/u,
    );
    expect(sql).toMatch(
      /ORDER BY deployment\.tenant_id, deployment\.prompt_version_id/u,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.console_lock_prompt_release_set\(uuid\)[\s\S]*FROM PUBLIC, context_svc, context_runtime_svc, generation_svc/u,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.console_lock_prompt_release_set\(uuid\)[\s\S]*TO console_control_svc/u,
    );
    expect(sql).toMatch(
      /review_operator_has_tenant_capability_privileged\([\s\S]*requested_tenant_id,[\s\S]*'tenant:configure'/u,
    );
    expect(sql).not.toMatch(
      /review_operator_has_tenant_capability_privileged\([\s\S]*requested_tenant_id,[\s\S]*'console:read'/u,
    );
  });

  it("orders latest eligible evidence deterministically in every release gate", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const deterministicLatest =
      /prompt_evaluation_evidence_is_complete\(evaluation\)[\s\S]{0,500}ORDER BY[\s\S]{0,200}evaluation\.evaluated_at DESC,[\s\S]{0,120}evaluation\.recorded_at DESC,[\s\S]{0,120}evaluation\.id DESC/gu;

    expect(sql.match(deterministicLatest)).toHaveLength(4);
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION enforce_prompt_deployment_quality_gate/u,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION enforce_prompt_candidacy_decision/u,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION enforce_running_experiment_quality_gate/u,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION prompt_is_effective_candidate/u,
    );
    expect(sql).toMatch(
      /prompt_is_effective_candidate[\s\S]*decision\.evaluation_result_id = latest\.id/u,
    );
  });
});
