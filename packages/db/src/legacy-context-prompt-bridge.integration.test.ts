import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { derivePromptVersionHash } from "@review/domain/experiment";
import { beforeEach, describe, expect, it } from "vitest";

import { databaseUrlForTestRole } from "./test-support/database-role-url.js";
import { resetIntegrationDatabase } from "./test-support/reset-integration-database.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const releaseSha = "1234567890abcdef1234567890abcdef12345678";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function runSql(connectionUrl: string, statement: string): Promise<string> {
  const { stdout } = await execFileAsync(psql, [
    connectionUrl,
    "-X",
    "-q",
    "-A",
    "-t",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ]);
  return stdout.trim();
}

function legacyUrl(): string {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  return databaseUrlForTestRole({ databaseUrl, role: "context_svc" });
}

describeDatabase("legacy Context Prompt rollback bridge", () => {
  beforeEach(async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required");
    }
    await resetIntegrationDatabase({ databaseUrl, psql });
  });

  it("reads only its bounded Tenant deployment and cannot use an empty or crossed Tenant GUC", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required");
    }
    const tenantId = "00000000-0000-4000-8000-000000000101";
    const otherTenantId = randomUUID();
    const promptVersionId = "00000000-0000-4000-8000-000000000136";
    const evaluationId = randomUUID();
    const promptKey = "review.generate.release";
    const promptBody = "Use only supplied Assertions.";
    const promptHash = derivePromptVersionHash({
      key: promptKey,
      commandKind: "generate",
      body: promptBody,
      variables: ["locale", "tone"],
    });
    const evaluatedAt = "2026-08-24T00:00:00.000Z";
    const suiteName = "legacy-context-prompt-bridge-v1";
    const suiteManifestHash = sha256(suiteName);
    const report = canonicalJson({
      schemaVersion: 1,
      evaluatorReleaseSha: releaseSha,
      evaluatedAt,
      promptVersion: {
        id: promptVersionId,
        tenantId,
        action: "GENERATE",
        key: promptKey,
        hash: promptHash,
        body: promptBody,
        variables: ["locale", "tone"],
      },
      suite: {
        kind: "deterministic-compose-request-grounding-gate",
        name: suiteName,
        manifestHash: suiteManifestHash,
        providerBehaviorMeasured: false,
        cases: [
          {
            id: `legacy-${tenantId}`,
            scenarioHash: sha256(`scenario:${tenantId}`),
            composedRequestHash: sha256(`request:${tenantId}`),
            passed: true,
          },
        ],
      },
    });

    await runSql(
      databaseUrl,
      `
        INSERT INTO entry_mode_definitions (key, semantics)
        VALUES ('invite', '{}'::jsonb)
        ON CONFLICT (key) DO NOTHING;
        INSERT INTO tenants (id, slug, name, locale, default_entry_mode_key)
        VALUES
          ('${tenantId}', 'legacy-${tenantId}', 'Legacy Context Tenant', 'en-GB', 'invite'),
          ('${otherTenantId}', 'legacy-${otherTenantId}', 'Other Tenant', 'en-GB', 'invite');
        INSERT INTO prompt_versions (
          id, tenant_id, prompt_key, action, content_hash, body, variables,
          version, status
        ) VALUES (
          '${promptVersionId}', '${tenantId}', ${literal(promptKey)}, 'GENERATE',
          '${promptHash}', ${literal(promptBody)}, ARRAY['locale','tone']::text[], 3, 'DRAFT'
        );
        INSERT INTO prompt_evaluation_results (
          id, tenant_id, prompt_version_id, prompt_version_hash, report_hash,
          evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
          suite_name, suite_manifest_hash, report_document, report_canonical
        ) VALUES (
          '${evaluationId}', '${tenantId}', '${promptVersionId}', '${promptHash}',
          '${sha256(report)}', 1, 1, '${releaseSha}', '${evaluatedAt}'::timestamptz,
          ${literal(suiteName)}, '${suiteManifestHash}', ${literal(report)}::jsonb,
          ${literal(report)}
        );
        INSERT INTO prompt_candidacy_decisions (
          tenant_id, prompt_version_id, prompt_version_hash, decision,
          evaluation_result_id, reason
        ) VALUES (
          '${tenantId}', '${promptVersionId}', '${promptHash}', 'CANDIDATE',
          '${evaluationId}', 'Legacy rollback bridge fixture.'
        );
        INSERT INTO prompt_deployments (
          tenant_id, action, prompt_version_id, revision
        ) VALUES ('${tenantId}', 'GENERATE', '${promptVersionId}', 1);
      `,
    );

    const boundedCounts = async (tenantGuc: string): Promise<string> =>
      await runSql(
        legacyUrl(),
        `
          BEGIN;
          SELECT set_config('app.operator_id', '', true);
          SELECT set_config('app.tenant_id', '${tenantGuc}', true);
          SELECT
            (SELECT count(*) FROM prompt_versions)::text || '|' ||
            (SELECT count(*) FROM prompt_deployments)::text;
          ROLLBACK;
        `,
      );

    await expect(boundedCounts(tenantId)).resolves.toMatch(/1\|1$/u);
    await expect(boundedCounts(otherTenantId)).resolves.toMatch(/0\|0$/u);
    await expect(
      runSql(
        legacyUrl(),
        `
          BEGIN;
          SELECT set_config('app.operator_id', '', true);
          SELECT set_config('app.tenant_id', '', true);
          SELECT
            (SELECT count(*) FROM prompt_versions)::text || '|' ||
            (SELECT count(*) FROM prompt_deployments)::text;
          ROLLBACK;
        `,
      ),
    ).resolves.toMatch(/0\|0$/u);
  });
});
