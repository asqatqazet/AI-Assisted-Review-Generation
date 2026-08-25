import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { derivePromptVersionHash } from "@review/domain/experiment";
import { describe, expect, it } from "vitest";

import { STUDENT_STRICT_ZERO_PROMPT_APPROVAL } from "./deployment/prompt-release-content-policy.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const workspaceRoot = path.resolve(__dirname, "../../..");
const prisma = path.join(
  workspaceRoot,
  "packages/db/node_modules/.bin/prisma",
);
const schema = path.join(workspaceRoot, "packages/db/prisma/schema.prisma");
const studentSeed = path.join(workspaceRoot, "infra/aws/seed-student.sql");
const releaseSha = "1234567890abcdef1234567890abcdef12345678";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

interface PromptFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly key: string;
  readonly hash: string;
  readonly body: string;
  readonly variables: readonly string[];
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalJson(entry as JsonValue)}`,
    )
    .join(",")}}`;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function strictEvaluationSql(
  prompt: PromptFixture,
  evaluationId: string,
  evaluatedAt: string,
): string {
  const suiteManifestHash = sha256("strict-zero-content-policy-suite-v1");
  const report = {
    schemaVersion: 1,
    evaluatorReleaseSha: releaseSha,
    evaluatedAt,
    promptVersion: {
      id: prompt.id,
      tenantId: prompt.tenantId,
      action: "GENERATE",
      key: prompt.key,
      hash: prompt.hash,
      body: prompt.body,
      variables: prompt.variables,
    },
    suite: {
      kind: "deterministic-compose-request-grounding-gate",
      name: "strict-zero-content-policy-suite",
      manifestHash: suiteManifestHash,
      providerBehaviorMeasured: false,
      cases: [
        {
          id: `case-${evaluationId}`,
          scenarioHash: sha256(`scenario-${evaluationId}`),
          composedRequestHash: sha256(`request-${evaluationId}`),
          passed: true,
        },
      ],
    },
  } as const;
  const canonical = canonicalJson(report);
  return `
    INSERT INTO prompt_evaluation_results (
      id, tenant_id, prompt_version_id, prompt_version_hash, report_hash,
      evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
      suite_name, suite_manifest_hash, report_document, report_canonical
    ) VALUES (
      '${evaluationId}', '${prompt.tenantId}', '${prompt.id}', '${prompt.hash}',
      '${sha256(canonical)}', 1, 1, '${releaseSha}', '${evaluatedAt}'::timestamptz,
      'strict-zero-content-policy-suite', '${suiteManifestHash}',
      ${literal(canonical)}::jsonb, ${literal(canonical)}
    );
  `;
}

async function runSql(connectionUrl: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync(
    psql,
    [
      connectionUrl,
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

describeDatabase.sequential("strict-$0 Prompt content approval", () => {
  it("rejects perfect deterministic evidence for arbitrary content and permits the reviewed hash", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const databaseName = `strict_zero_prompt_${randomUUID().replaceAll("-", "")}`;
    const scratchUrl = new URL(databaseUrl);
    scratchUrl.pathname = `/${databaseName}`;
    scratchUrl.searchParams.delete("schema");

    await runSql(databaseUrl, `CREATE DATABASE "${databaseName}"`);
    try {
      await execFileAsync(prisma, ["migrate", "deploy", "--schema", schema], {
        cwd: workspaceRoot,
        env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
        maxBuffer: 4 * 1024 * 1024,
      });
      await execFileAsync(
        prisma,
        ["db", "execute", "--file", studentSeed, "--schema", schema],
        {
          cwd: workspaceRoot,
          env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
          maxBuffer: 4 * 1024 * 1024,
        },
      );

      const crossTenantId = randomUUID();
      const crossTenantLocationId = randomUUID();
      const arbitraryId = randomUUID();
      const arbitraryBody = "Arbitrary wording with no provider-quality review.";
      const arbitraryPrompt: PromptFixture = {
        id: arbitraryId,
        tenantId: crossTenantId,
        key: `review.generate.arbitrary.${arbitraryId}`,
        hash: derivePromptVersionHash({
          key: `review.generate.arbitrary.${arbitraryId}`,
          commandKind: "generate",
          body: arbitraryBody,
          variables: [],
        }),
        body: arbitraryBody,
        variables: [],
      };
      const secondArbitraryId = randomUUID();
      const secondArbitraryBody = "Second unreviewed Prompt wording.";
      const secondArbitraryPrompt: PromptFixture = {
        id: secondArbitraryId,
        tenantId: crossTenantId,
        key: `review.generate.arbitrary.${secondArbitraryId}`,
        hash: derivePromptVersionHash({
          key: `review.generate.arbitrary.${secondArbitraryId}`,
          commandKind: "generate",
          body: secondArbitraryBody,
          variables: [],
        }),
        body: secondArbitraryBody,
        variables: [],
      };
      const arbitraryEvaluationId = randomUUID();
      await runSql(
        scratchUrl.toString(),
        `
          INSERT INTO tenants (id, slug, name, locale, default_entry_mode_key)
          VALUES (
            '${crossTenantId}', 'strict-zero-${crossTenantId}',
            'Unapproved strict-zero Tenant', 'en-GB', 'open-qr'
          );
          INSERT INTO locations (id, tenant_id, slug, name)
          VALUES (
            '${crossTenantLocationId}', '${crossTenantId}', 'main',
            'Unapproved Location'
          );
          INSERT INTO prompt_versions (
            id, tenant_id, prompt_key, action, content_hash, body, variables,
            version, status
          ) VALUES
            (
              '${arbitraryPrompt.id}', '${arbitraryPrompt.tenantId}',
              ${literal(arbitraryPrompt.key)}, 'GENERATE', '${arbitraryPrompt.hash}',
              ${literal(arbitraryPrompt.body)}, ARRAY[]::text[], 1, 'DRAFT'
            ),
            (
              '${secondArbitraryPrompt.id}', '${secondArbitraryPrompt.tenantId}',
              ${literal(secondArbitraryPrompt.key)}, 'GENERATE',
              '${secondArbitraryPrompt.hash}',
              ${literal(secondArbitraryPrompt.body)}, ARRAY[]::text[], 2, 'DRAFT'
            );
          ${strictEvaluationSql(
            arbitraryPrompt,
            arbitraryEvaluationId,
            "2026-08-24T06:00:00.000Z",
          )}
        `,
      );

      await expect(
        runSql(
          scratchUrl.toString(),
          `
            INSERT INTO prompt_candidacy_decisions (
              tenant_id, prompt_version_id, prompt_version_hash, decision,
              evaluation_result_id, reason
            ) VALUES (
              '${arbitraryPrompt.tenantId}', '${arbitraryPrompt.id}',
              '${arbitraryPrompt.hash}', 'CANDIDATE',
              '${arbitraryEvaluationId}', 'Perfect deterministic report.'
            );
          `,
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED"),
      });
      await expect(
        runSql(
          scratchUrl.toString(),
          `
            INSERT INTO prompt_deployments (
              tenant_id, action, prompt_version_id, revision
            ) VALUES (
              '${arbitraryPrompt.tenantId}', 'GENERATE',
              '${arbitraryPrompt.id}', 1
            );
          `,
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED"),
      });
      const experimentId = randomUUID();
      await runSql(
        scratchUrl.toString(),
        `
          INSERT INTO experiments (id, tenant_id, key, action, status)
          VALUES (
            '${experimentId}', '${crossTenantId}',
            'strict-zero-${experimentId}', 'GENERATE', 'DRAFT'
          );
          INSERT INTO experiment_variants (
            tenant_id, experiment_id, prompt_version_id, key,
            weight_basis_points
          ) VALUES
            (
              '${crossTenantId}', '${experimentId}',
              '${arbitraryPrompt.id}', 'A', 5000
            ),
            (
              '${crossTenantId}', '${experimentId}',
              '${secondArbitraryPrompt.id}', 'B', 5000
            );
        `,
      );
      await expect(
        runSql(
          scratchUrl.toString(),
          `UPDATE experiments SET status = 'RUNNING'
           WHERE id = '${experimentId}'::uuid;`,
        ),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED"),
      });

      const approvedPrompt: PromptFixture = {
        id: STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionId,
        tenantId: STUDENT_STRICT_ZERO_PROMPT_APPROVAL.tenantId,
        key: "review.generate.release",
        hash: STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionHash,
        body: "Use only supplied Assertions.",
        variables: ["locale", "tone"],
      };
      const approvedEvaluationId = randomUUID();
      await runSql(
        scratchUrl.toString(),
        `
          ${strictEvaluationSql(
            approvedPrompt,
            approvedEvaluationId,
            "2026-08-24T06:01:00.000Z",
          )}
          INSERT INTO prompt_candidacy_decisions (
            tenant_id, prompt_version_id, prompt_version_hash, decision,
            evaluation_result_id, reason
          ) VALUES (
            '${approvedPrompt.tenantId}', '${approvedPrompt.id}',
            '${approvedPrompt.hash}', 'CANDIDATE',
            '${approvedEvaluationId}', 'Reviewed immutable strict-$0 Prompt.'
          );
          INSERT INTO prompt_deployments (
            tenant_id, action, prompt_version_id, revision
          ) VALUES (
            '${approvedPrompt.tenantId}', 'GENERATE', '${approvedPrompt.id}', 1
          );
        `,
      );
      await expect(
        runSql(
          scratchUrl.toString(),
          `SELECT count(*) FROM prompt_deployments
           WHERE tenant_id = '${approvedPrompt.tenantId}'::uuid
             AND prompt_version_id = '${approvedPrompt.id}'::uuid;`,
        ),
      ).resolves.toBe("1");
    } finally {
      await runSql(databaseUrl, `DROP DATABASE "${databaseName}" WITH (FORCE)`);
    }
  });
});
