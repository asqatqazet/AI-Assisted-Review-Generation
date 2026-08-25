import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { derivePromptVersionHash } from "../../packages/domain/src/experiment/index.js";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const seed = fs.readFileSync(path.join(here, "seed-student.sql"), "utf8");
const deploymentWorkflow = fs.readFileSync(
  path.join(here, "../../.github/workflows/deploy-student.yml"),
  "utf8",
);
const gitignore = fs.readFileSync(path.join(here, "../../.gitignore"), "utf8");

describe("canonical student seed", () => {
  it("keeps the default AWS seed base-only and evaluates before qualification", () => {
    expect(seed).not.toContain("INSERT INTO prompt_evaluation_results");
    expect(seed).not.toContain("INSERT INTO prompt_candidacy_decisions");
    expect(seed).not.toContain("INSERT INTO prompt_deployments");
    expect(seed).not.toContain("INSERT INTO effective_configuration_snapshots");
    expect(seed).not.toContain("0000000000000000000000000000000000000000");

    const baseSeed = deploymentWorkflow.indexOf("infra/aws/seed-student.sql");
    const evaluation = deploymentWorkflow.indexOf("pnpm eval:prompt");
    const qualification = deploymentWorkflow.indexOf(
      "scripts/qualify-student-release.ts",
    );
    expect(baseSeed).toBeGreaterThan(0);
    expect(evaluation).toBeGreaterThan(baseSeed);
    expect(qualification).toBeGreaterThan(evaluation);
    expect(gitignore.split("\n")).toContain("release/");
  });

  it("seeds the exact immutable Prompt that the release evaluator must qualify", () => {
    const prompt = {
      key: "review.generate.release",
      commandKind: "generate" as const,
      body: "Use only supplied Assertions.",
      variables: ["locale", "tone"],
    };
    const hash = derivePromptVersionHash(prompt);

    expect(hash).toBe(
      "sha256:faf385e0cafc00a1b456dbedaa29828486d5fc2f2da8cb16a6debf871ae4fbeb",
    );
    expect(seed).toContain("'00000000-0000-4000-8000-000000000136'");
    expect(seed).toContain(`'${hash}'`);
    expect(seed).toContain("'review.generate.release'");
  });

  it("enables only the currently executable production Action", () => {
    expect(seed).toContain("'GENERATE', true");
    expect(seed).toContain("'PARAPHRASE', false");
    expect(seed).toContain("'REGENERATE', false");
    expect(seed).toContain("'CONDENSE', false");
    expect(seed).toContain("'REFORMAT', false");
    expect(seed).toContain("'EXPAND', false");
    expect(seed).toContain("'REVISE_WORDING', false");
  });

  it("seeds explicit sparse Tenant settings so a Platform publication preserves open QR", () => {
    const tenantInsertStart = seed.indexOf("INSERT INTO tenants (");
    const tenantInsertEnd = seed.indexOf("INSERT INTO locations", tenantInsertStart);
    const tenantInsert = seed.slice(tenantInsertStart, tenantInsertEnd);

    expect(tenantInsert).toContain("configuration_values");
    expect(tenantInsert).toContain('"locale":"de-DE"');
    expect(tenantInsert).toContain('"entryMode":"open-qr"');
    expect(tenantInsert).toContain('"requireVerifiedExperience":false');
    expect(tenantInsert).toContain('"requireDisclosure":false');
    expect(tenantInsert).toContain("configuration_values = EXCLUDED.configuration_values");
  });

  it("archives the disposable Location and never mutates an immutable snapshot", () => {
    expect(seed).toMatch(/DELETE FROM locations[\s\S]*slug = 'fsdfdsfsdfsd'/u);
    expect(seed).toContain("name = 'Archived test Location'");
    expect(seed).toContain("slug = 'archived-' || replace(id::text, '-', '')");
    expect(seed).not.toMatch(/UPDATE effective_configuration_snapshots/u);
  });
});
