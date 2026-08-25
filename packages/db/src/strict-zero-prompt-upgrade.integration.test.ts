import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { derivePromptVersionHash } from "@review/domain/experiment";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
const migrations = path.join(workspaceRoot, "packages/db/prisma/migrations");
const strictZeroMigration =
  "20260824000033_prompt_release_approved_hash_policy";
const approvedTenantId = "00000000-0000-4000-8000-000000000101";
const approvedPromptVersionId = "00000000-0000-4000-8000-000000000136";
const approvedPromptVersionHash =
  "sha256:faf385e0cafc00a1b456dbedaa29828486d5fc2f2da8cb16a6debf871ae4fbeb";
const evaluatorReleaseSha = "1234567890abcdef1234567890abcdef12345678";

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
  readonly version: number;
}

interface EvidenceCounts {
  readonly candidacyDecisions: number;
  readonly deployments: number;
  readonly evaluations: number;
  readonly experimentVariants: number;
  readonly experiments: number;
  readonly prompts: number;
  readonly snapshots: number;
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

function arbitraryPrompt(tenantId: string, version: number): PromptFixture {
  const id = randomUUID();
  const key = `upgrade-prompt-${id}`;
  const body = `Unreviewed provider wording ${version}.`;
  const variables = version === 1 ? ["locale"] : ["locale", "tone"];
  return {
    id,
    tenantId,
    key,
    hash: derivePromptVersionHash({
      key,
      commandKind: "generate",
      body,
      variables,
    }),
    body,
    variables,
    version,
  };
}

function strictEvaluationSql(
  prompt: PromptFixture,
  evaluationId: string,
  evaluatedAt: string,
): string {
  const suiteManifestHash = sha256("strict-zero-upgrade-suite-v1");
  const report = {
    schemaVersion: 1,
    evaluatorReleaseSha,
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
      name: "strict-zero-upgrade-suite",
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
      '${sha256(canonical)}', 1, 1, '${evaluatorReleaseSha}',
      '${evaluatedAt}'::timestamptz, 'strict-zero-upgrade-suite',
      '${suiteManifestHash}', ${literal(canonical)}::jsonb,
      ${literal(canonical)}
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

async function deployMigrations(
  connectionUrl: string,
  stagedSchema: string,
): Promise<void> {
  await execFileAsync(prisma, ["migrate", "deploy", "--schema", stagedSchema], {
    cwd: workspaceRoot,
    env: { ...process.env, DATABASE_URL: connectionUrl },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function insertTenant(
  connectionUrl: string,
  tenantId: string,
  locationId?: string,
): Promise<void> {
  await runSql(
    connectionUrl,
    `
      INSERT INTO tenants (id, slug, name, locale)
      VALUES (
        '${tenantId}', 'upgrade-${tenantId}', 'Upgrade boundary Tenant', 'en-GB'
      );
      ${
        locationId === undefined
          ? ""
          : `
            INSERT INTO locations (id, tenant_id, slug, name)
            VALUES (
              '${locationId}', '${tenantId}', 'location-${locationId}',
              'Upgrade boundary Location'
            );
          `
      }
    `,
  );
}

async function insertPromptEvidenceAndCandidate(
  connectionUrl: string,
  prompt: PromptFixture,
  evaluatedAt: string,
): Promise<string> {
  const evaluationId = randomUUID();
  await runSql(
    connectionUrl,
    `
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body, variables,
        version, status
      ) VALUES (
        '${prompt.id}', '${prompt.tenantId}', ${literal(prompt.key)},
        'GENERATE', '${prompt.hash}', ${literal(prompt.body)},
        ARRAY[${prompt.variables.map(literal).join(",")}]::text[],
        ${prompt.version}, 'DRAFT'
      );
      ${strictEvaluationSql(prompt, evaluationId, evaluatedAt)}
      INSERT INTO prompt_candidacy_decisions (
        tenant_id, prompt_version_id, prompt_version_hash, decision,
        evaluation_result_id, reason
      ) VALUES (
        '${prompt.tenantId}', '${prompt.id}', '${prompt.hash}', 'CANDIDATE',
        '${evaluationId}', 'Valid pre-33 deterministic evidence.'
      );
    `,
  );
  return evaluationId;
}

async function retirePromptCandidate(
  connectionUrl: string,
  prompt: PromptFixture,
): Promise<void> {
  await runSql(
    connectionUrl,
    `
      INSERT INTO prompt_candidacy_decisions (
        tenant_id, prompt_version_id, prompt_version_hash, decision, reason
      ) VALUES (
        '${prompt.tenantId}', '${prompt.id}', '${prompt.hash}', 'RETIRED',
        'Retired before the strict-zero upgrade.'
      );
    `,
  );
}

async function readEvidenceCounts(
  connectionUrl: string,
  tenantId: string,
): Promise<EvidenceCounts> {
  const raw = await runSql(
    connectionUrl,
    `
      SELECT json_build_object(
        'candidacyDecisions', (
          SELECT count(*) FROM prompt_candidacy_decisions
          WHERE tenant_id = '${tenantId}'::uuid
        ),
        'deployments', (
          SELECT count(*) FROM prompt_deployments
          WHERE tenant_id = '${tenantId}'::uuid
        ),
        'evaluations', (
          SELECT count(*) FROM prompt_evaluation_results
          WHERE tenant_id = '${tenantId}'::uuid
        ),
        'experimentVariants', (
          SELECT count(*) FROM experiment_variants
          WHERE tenant_id = '${tenantId}'::uuid
        ),
        'experiments', (
          SELECT count(*) FROM experiments
          WHERE tenant_id = '${tenantId}'::uuid
        ),
        'prompts', (
          SELECT count(*) FROM prompt_versions
          WHERE tenant_id = '${tenantId}'::uuid
        ),
        'snapshots', (
          SELECT count(*) FROM effective_configuration_snapshots
          WHERE tenant_id = '${tenantId}'::uuid
        )
      )::text;
    `,
  );
  return JSON.parse(raw) as EvidenceCounts;
}

describeDatabase.sequential("strict-$0 Prompt migration upgrade boundary", () => {
  let stagedRoot: string;
  let stagedSchema: string;
  let stagedMigrations: string;
  let templateDatabaseName: string;

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    stagedRoot = await mkdtemp(
      path.join(os.tmpdir(), "review-strict-zero-upgrade-"),
    );
    stagedSchema = path.join(stagedRoot, "schema.prisma");
    stagedMigrations = path.join(stagedRoot, "migrations");
    await cp(schema, stagedSchema);
    await cp(migrations, stagedMigrations, { recursive: true });

    const migrationEntries = await readdir(stagedMigrations, {
      withFileTypes: true,
    });
    for (const entry of migrationEntries) {
      if (entry.isDirectory() && entry.name >= strictZeroMigration) {
        await rm(path.join(stagedMigrations, entry.name), {
          recursive: true,
          force: true,
        });
      }
    }

    templateDatabaseName = `strict_zero_pre33_${randomUUID().replaceAll("-", "")}`;
    const templateUrl = new URL(databaseUrl);
    templateUrl.pathname = `/${templateDatabaseName}`;
    templateUrl.searchParams.delete("schema");
    await runSql(databaseUrl, `CREATE DATABASE "${templateDatabaseName}"`);
    await deployMigrations(templateUrl.toString(), stagedSchema);

    await cp(
      path.join(migrations, strictZeroMigration),
      path.join(stagedMigrations, strictZeroMigration),
      { recursive: true },
    );
  });

  afterAll(async () => {
    if (databaseUrl !== undefined && templateDatabaseName !== undefined) {
      await runSql(
        databaseUrl,
        `DROP DATABASE IF EXISTS "${templateDatabaseName}" WITH (FORCE)`,
      );
    }
    if (stagedRoot !== undefined) {
      await rm(stagedRoot, { recursive: true, force: true });
    }
  });

  async function withPre33Database(
    exercise: (connectionUrl: string) => Promise<void>,
  ): Promise<void> {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const scratchDatabaseName = `strict_zero_upgrade_${randomUUID().replaceAll("-", "")}`;
    const scratchUrl = new URL(databaseUrl);
    scratchUrl.pathname = `/${scratchDatabaseName}`;
    scratchUrl.searchParams.delete("schema");
    await runSql(
      databaseUrl,
      `CREATE DATABASE "${scratchDatabaseName}" TEMPLATE "${templateDatabaseName}"`,
    );
    try {
      await exercise(scratchUrl.toString());
    } finally {
      await runSql(
        databaseUrl,
        `DROP DATABASE IF EXISTS "${scratchDatabaseName}" WITH (FORCE)`,
      );
    }
  }

  async function expectUpgradeFailure(
    connectionUrl: string,
    tenantId: string,
    expectedCode: string,
  ): Promise<void> {
    const before = await readEvidenceCounts(connectionUrl, tenantId);
    await expect(
      deployMigrations(connectionUrl, stagedSchema),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(expectedCode),
    });
    await expect(readEvidenceCounts(connectionUrl, tenantId)).resolves.toEqual(
      before,
    );
    await expect(
      runSql(
        connectionUrl,
        `SELECT to_regprocedure(
          'public.strict_zero_prompt_content_is_approved(uuid,uuid,text,generation_action)'
        ) IS NULL;`,
      ),
    ).resolves.toBe("t");
  }

  it("rejects a non-retired non-student Candidate without deleting evidence", async () => {
    await withPre33Database(async (connectionUrl) => {
      const tenantId = randomUUID();
      const prompt = arbitraryPrompt(tenantId, 1);
      await insertTenant(connectionUrl, tenantId);
      await insertPromptEvidenceAndCandidate(
        connectionUrl,
        prompt,
        "2026-08-24T07:00:00.000Z",
      );

      await expectUpgradeFailure(
        connectionUrl,
        tenantId,
        "STRICT_ZERO_PROMPT_UPGRADE_CANDIDATE_NOT_APPROVED",
      );
    });
  });

  it("rejects a non-student Deployment without deleting evidence", async () => {
    await withPre33Database(async (connectionUrl) => {
      const tenantId = randomUUID();
      const prompt = arbitraryPrompt(tenantId, 1);
      await insertTenant(connectionUrl, tenantId);
      await insertPromptEvidenceAndCandidate(
        connectionUrl,
        prompt,
        "2026-08-24T07:01:00.000Z",
      );
      await runSql(
        connectionUrl,
        `
          INSERT INTO prompt_deployments (
            tenant_id, action, prompt_version_id, revision
          ) VALUES ('${tenantId}', 'GENERATE', '${prompt.id}', 1);
        `,
      );
      await retirePromptCandidate(connectionUrl, prompt);

      await expectUpgradeFailure(
        connectionUrl,
        tenantId,
        "STRICT_ZERO_PROMPT_UPGRADE_DEPLOYMENT_NOT_APPROVED",
      );
    });
  });

  it("rejects non-student RUNNING Experiment variants without deleting evidence", async () => {
    await withPre33Database(async (connectionUrl) => {
      const tenantId = randomUUID();
      const firstPrompt = arbitraryPrompt(tenantId, 1);
      const secondPrompt = arbitraryPrompt(tenantId, 2);
      const experimentId = randomUUID();
      await insertTenant(connectionUrl, tenantId);
      await insertPromptEvidenceAndCandidate(
        connectionUrl,
        firstPrompt,
        "2026-08-24T07:02:00.000Z",
      );
      await insertPromptEvidenceAndCandidate(
        connectionUrl,
        secondPrompt,
        "2026-08-24T07:03:00.000Z",
      );
      await runSql(
        connectionUrl,
        `
          INSERT INTO experiments (id, tenant_id, key, action, status)
          VALUES (
            '${experimentId}', '${tenantId}', 'upgrade-${experimentId}',
            'GENERATE', 'DRAFT'
          );
          INSERT INTO experiment_variants (
            tenant_id, experiment_id, prompt_version_id, key,
            weight_basis_points
          ) VALUES
            ('${tenantId}', '${experimentId}', '${firstPrompt.id}', 'control', 5000),
            ('${tenantId}', '${experimentId}', '${secondPrompt.id}', 'variant', 5000);
          UPDATE experiments
          SET status = 'RUNNING', started_at = clock_timestamp()
          WHERE id = '${experimentId}' AND tenant_id = '${tenantId}';
        `,
      );
      await retirePromptCandidate(connectionUrl, firstPrompt);
      await retirePromptCandidate(connectionUrl, secondPrompt);

      await expectUpgradeFailure(
        connectionUrl,
        tenantId,
        "STRICT_ZERO_PROMPT_UPGRADE_EXPERIMENT_NOT_APPROVED",
      );
    });
  });

  it("rejects the latest active non-student Location snapshot without deleting evidence", async () => {
    await withPre33Database(async (connectionUrl) => {
      const tenantId = randomUUID();
      const locationId = randomUUID();
      const snapshotId = randomUUID();
      const prompt = arbitraryPrompt(tenantId, 1);
      const payload = {
        tenantId,
        locationId,
        snapshotId,
        promptVersions: [
          {
            id: prompt.id,
            hash: prompt.hash,
            commandKind: "generate",
            key: prompt.key,
            body: prompt.body,
            variables: prompt.variables,
          },
        ],
      } as const;
      await insertTenant(connectionUrl, tenantId, locationId);
      await runSql(
        connectionUrl,
        `
          INSERT INTO prompt_versions (
            id, tenant_id, prompt_key, action, content_hash, body, variables,
            version, status
          ) VALUES (
            '${prompt.id}', '${tenantId}', ${literal(prompt.key)}, 'GENERATE',
            '${prompt.hash}', ${literal(prompt.body)},
            ARRAY[${prompt.variables.map(literal).join(",")}]::text[],
            ${prompt.version}, 'DRAFT'
          );
          INSERT INTO effective_configuration_snapshots (
            id, tenant_id, location_id, schema_version, content_hash, payload,
            provenance
          ) VALUES (
            '${snapshotId}', '${tenantId}', '${locationId}', 2,
            '${sha256(canonicalJson(payload))}',
            ${literal(JSON.stringify(payload))}::jsonb, '{}'::jsonb
          );
        `,
      );

      await expectUpgradeFailure(
        connectionUrl,
        tenantId,
        "STRICT_ZERO_PROMPT_UPGRADE_SNAPSHOT_NOT_APPROVED",
      );
    });
  });

  it("upgrades approved student executable state without rewriting evidence", async () => {
    await withPre33Database(async (connectionUrl) => {
      const locationId = "00000000-0000-4000-8000-000000000102";
      const snapshotId = randomUUID();
      const approvedPrompt: PromptFixture = {
        id: approvedPromptVersionId,
        tenantId: approvedTenantId,
        key: "review.generate.release",
        hash: approvedPromptVersionHash,
        body: "Use only supplied Assertions.",
        variables: ["locale", "tone"],
        version: 1,
      };
      const payload = {
        tenantId: approvedTenantId,
        locationId,
        snapshotId,
        promptVersions: [
          {
            id: approvedPrompt.id,
            hash: approvedPrompt.hash,
            commandKind: "generate",
            key: approvedPrompt.key,
            body: approvedPrompt.body,
            variables: approvedPrompt.variables,
          },
        ],
      } as const;
      await insertTenant(connectionUrl, approvedTenantId, locationId);
      await insertPromptEvidenceAndCandidate(
        connectionUrl,
        approvedPrompt,
        "2026-08-24T07:04:00.000Z",
      );
      await runSql(
        connectionUrl,
        `
          INSERT INTO prompt_deployments (
            tenant_id, action, prompt_version_id, revision
          ) VALUES (
            '${approvedTenantId}', 'GENERATE', '${approvedPrompt.id}', 1
          );
          INSERT INTO effective_configuration_snapshots (
            id, tenant_id, location_id, schema_version, content_hash, payload,
            provenance
          ) VALUES (
            '${snapshotId}', '${approvedTenantId}', '${locationId}', 2,
            '${sha256(canonicalJson(payload))}',
            ${literal(JSON.stringify(payload))}::jsonb, '{}'::jsonb
          );
        `,
      );
      const before = await readEvidenceCounts(connectionUrl, approvedTenantId);

      await expect(
        deployMigrations(connectionUrl, stagedSchema),
      ).resolves.toBeUndefined();
      await expect(
        readEvidenceCounts(connectionUrl, approvedTenantId),
      ).resolves.toEqual(before);
      await expect(
        runSql(
          connectionUrl,
          `SELECT count(*) FROM _prisma_migrations
           WHERE migration_name = '${strictZeroMigration}'
             AND finished_at IS NOT NULL;`,
        ),
      ).resolves.toBe("1");
    });
  });
});
