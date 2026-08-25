import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { derivePromptVersionHash } from "@review/domain/experiment";
import { beforeEach, describe, expect, it } from "vitest";

import { STUDENT_STRICT_ZERO_PROMPT_APPROVAL } from "./deployment/prompt-release-content-policy.js";
import { resetIntegrationDatabase } from "./test-support/reset-integration-database.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

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

interface EvaluationFixture {
  readonly canonical: string;
  readonly reportHash: string;
  readonly suiteName: string;
  readonly suiteManifestHash: string;
  readonly releaseSha: string;
  readonly evaluatedAt: string;
  readonly evaluatedCases: number;
  readonly passedCases: number;
}

const RELEASE_SHA = "1234567890abcdef1234567890abcdef12345678";
const SUITE_NAME = "evals/golden@manifest-v1";

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

function evaluationFor(
  prompt: PromptFixture,
  evaluatedAt: string,
  passed: boolean,
  caseSuffix: string,
): EvaluationFixture {
  const suiteManifestHash = sha256("tracked-suite-manifest-v1");
  const report = {
    schemaVersion: 1,
    evaluatorReleaseSha: RELEASE_SHA,
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
      name: SUITE_NAME,
      manifestHash: suiteManifestHash,
      providerBehaviorMeasured: false,
      cases: [
        {
          id: `generate-${caseSuffix}`,
          scenarioHash: sha256(`scenario-${caseSuffix}`),
          composedRequestHash: sha256(`request-${caseSuffix}`),
          passed,
          ...(passed ? {} : { failureReason: "Expected grounding rejection." }),
        },
      ],
    },
  } as const;
  const canonical = canonicalJson(report);
  return {
    canonical,
    reportHash: sha256(canonical),
    suiteName: SUITE_NAME,
    suiteManifestHash,
    releaseSha: RELEASE_SHA,
    evaluatedAt,
    evaluatedCases: 1,
    passedCases: passed ? 1 : 0,
  };
}

function textArray(values: readonly string[]): string {
  return values.length === 0
    ? "ARRAY[]::text[]"
    : `ARRAY[${values.map(literal).join(",")}]::text[]`;
}

function evaluationValues(prompt: PromptFixture, evaluation: EvaluationFixture): string {
  return `
    '${prompt.tenantId}', '${prompt.id}', '${prompt.hash}',
    '${evaluation.reportHash}', ${evaluation.evaluatedCases},
    ${evaluation.passedCases}, '${evaluation.releaseSha}',
    '${evaluation.evaluatedAt}'::timestamptz,
    ${literal(evaluation.suiteName)}, '${evaluation.suiteManifestHash}',
    ${literal(evaluation.canonical)}::jsonb,
    ${literal(evaluation.canonical)}
  `;
}

async function runSql(
  statement: string,
  applicationName?: string,
): Promise<void> {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  await execFileAsync(
    psql,
    [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement],
    {
      env:
        applicationName === undefined
          ? process.env
          : { ...process.env, PGAPPNAME: applicationName },
    },
  );
}

async function scalar(statement: string): Promise<string> {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  const { stdout } = await execFileAsync(psql, [
    databaseUrl,
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

async function waitForMarker(
  child: ChildProcessWithoutNullStreams,
  marker: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes(marker)) {
        cleanup();
        resolve();
      }
    };
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `Prompt release lock holder exited before readiness (${String(code)}): ${stderr}`,
        ),
      );
    };
    const cleanup = () => {
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
  });
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`Prompt release lock holder failed (${String(code)}): ${stderr}`),
        );
      }
    });
  });
}

async function holdTransaction(
  applicationName: string,
  statement: string,
  marker: string,
) {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  const child = spawn(
    psql,
    [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1"],
    { env: { ...process.env, PGAPPNAME: applicationName } },
  );
  child.stdin.write(`BEGIN;\n${statement}\n\\echo ${marker}\n`);
  await waitForMarker(child, marker);
  return {
    async release(command: "COMMIT" | "ROLLBACK" = "COMMIT") {
      const exited = waitForExit(child);
      child.stdin.end(`${command};\n\\q\n`);
      await exited;
    },
  };
}

async function holdPublicationSet(tenantId: string) {
  return await holdTransaction(
    `prompt-release-holder-${tenantId}`,
    `SELECT public.console_lock_prompt_release_set('${tenantId}'::uuid);`,
    `PROMPT_RELEASE_LOCKED_${tenantId}`,
  );
}

async function holdDeploymentQualityGate(tenantId: string) {
  return await holdTransaction(
    `prompt-release-gate-holder-${tenantId}`,
    `UPDATE prompt_deployments
     SET revision = revision + 1
     WHERE tenant_id = '${tenantId}'::uuid AND action = 'GENERATE';`,
    `PROMPT_RELEASE_GATE_LOCKED_${tenantId}`,
  );
}

async function expectWaitingOnLock(
  applicationName: string,
  mutation: Promise<void>,
): Promise<void> {
  let settled = false;
  void mutation.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const waitEventType = await scalar(`
      SELECT coalesce(
        (
          SELECT wait_event_type
          FROM pg_stat_activity
          WHERE application_name = ${literal(applicationName)}
            AND pid <> pg_backend_pid()
          ORDER BY pid DESC
          LIMIT 1
        ),
        'missing'
      );
    `);
    if (waitEventType === "Lock") {
      return;
    }
    if (settled) {
      throw new Error("Mutation completed instead of waiting on the release lock");
    }
    await delay(25);
  }
  throw new Error("Mutation did not expose a PostgreSQL Lock wait event");
}

describeDatabase.sequential("Prompt release linearization", () => {
  beforeEach(async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required");
    }
    await resetIntegrationDatabase({ databaseUrl, psql });
  });

  it("blocks same-Tenant release changes, permits other Tenants, then exposes the committed change to recheck", async () => {
    const tenantId = STUDENT_STRICT_ZERO_PROMPT_APPROVAL.tenantId;
    const otherTenantId = randomUUID();
    const promptAId = STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionId;
    const promptBId = randomUUID();
    const promptCId = randomUUID();
    const promptA: PromptFixture = {
      id: promptAId,
      tenantId,
      key: "review.generate.release",
      hash: STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionHash,
      body: "Use only supplied Assertions.",
      variables: ["locale", "tone"],
      version: 1,
    };
    const promptB: PromptFixture = {
      id: promptBId,
      tenantId,
      key: `release.generate.b.${promptBId}`,
      hash: "",
      body: "Use only confirmed Assertions for release B.",
      variables: [],
      version: 2,
    };
    const promptC: PromptFixture = {
      id: promptCId,
      tenantId: otherTenantId,
      key: `release.generate.c.${promptCId}`,
      hash: "",
      body: "Use only confirmed Assertions for other Tenant C.",
      variables: [],
      version: 1,
    };
    const prompts = [promptA, promptB, promptC].map((prompt) =>
      prompt.hash.length > 0
        ? prompt
        : {
            ...prompt,
            hash: derivePromptVersionHash({
              key: prompt.key,
              commandKind: "generate",
              body: prompt.body,
              variables: prompt.variables,
            }),
          },
    );
    const [storedA, storedB, storedC] = prompts as [
      PromptFixture,
      PromptFixture,
      PromptFixture,
    ];
    const initialA = evaluationFor(
      storedA,
      "2026-08-24T04:00:00.000Z",
      true,
      `initial-a-${promptAId}`,
    );
    const initialC = evaluationFor(
      storedC,
      "2026-08-24T04:00:00.000Z",
      true,
      `initial-c-${promptCId}`,
    );

    await runSql(`
      INSERT INTO entry_mode_definitions (key, semantics)
      VALUES ('invite', '{}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO action_definitions (action, input_contract, status)
      VALUES ('GENERATE', '{}'::jsonb, 'ACTIVE')
      ON CONFLICT (action) DO NOTHING;
      INSERT INTO tenants (id, slug, name, locale, default_entry_mode_key)
      VALUES
        ('${tenantId}', 'prompt-release-${tenantId}', 'Prompt Release Tenant', 'en-GB', 'invite'),
        ('${otherTenantId}', 'prompt-release-${otherTenantId}', 'Other Prompt Release Tenant', 'en-GB', 'invite');
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body, variables,
        version, status
      ) VALUES
        ('${storedA.id}', '${storedA.tenantId}', ${literal(storedA.key)}, 'GENERATE', '${storedA.hash}', ${literal(storedA.body)}, ${textArray(storedA.variables)}, ${storedA.version}, 'DRAFT'),
        ('${storedB.id}', '${storedB.tenantId}', ${literal(storedB.key)}, 'GENERATE', '${storedB.hash}', ${literal(storedB.body)}, ${textArray(storedB.variables)}, ${storedB.version}, 'DRAFT'),
        ('${storedC.id}', '${storedC.tenantId}', ${literal(storedC.key)}, 'GENERATE', '${storedC.hash}', ${literal(storedC.body)}, ${textArray(storedC.variables)}, ${storedC.version}, 'DRAFT');
    `);

    await expect(
      runSql(`
        INSERT INTO prompt_evaluation_results (
          tenant_id, prompt_version_id, prompt_version_hash, report_hash,
          evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at
        ) VALUES (
          '${tenantId}', '${storedA.id}', '${storedA.hash}',
          '${sha256("legacy-summary")}', 1, 1, '${RELEASE_SHA}', now()
        );
      `),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("PROMPT_EVALUATION_EVIDENCE_INVALID"),
    });

    const initialAEvaluationId = randomUUID();
    await runSql(`
      INSERT INTO prompt_evaluation_results (
        id, tenant_id, prompt_version_id, prompt_version_hash, report_hash,
        evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
        suite_name, suite_manifest_hash, report_document, report_canonical
      ) VALUES (
        '${initialAEvaluationId}', ${evaluationValues(storedA, initialA)}
      );
      INSERT INTO prompt_candidacy_decisions (
        tenant_id, prompt_version_id, prompt_version_hash, decision,
        evaluation_result_id, reason
      ) VALUES (
        '${tenantId}', '${storedA.id}', '${storedA.hash}', 'CANDIDATE',
        '${initialAEvaluationId}', 'Approved strict zero Prompt.'
      );
      INSERT INTO prompt_deployments (
        tenant_id, action, prompt_version_id, revision
      ) VALUES ('${tenantId}', 'GENERATE', '${storedA.id}', 1);
    `);

    await expect(
      runSql(`
        INSERT INTO prompt_candidacy_decisions (
          tenant_id, prompt_version_id, prompt_version_hash, decision,
          reason
        ) VALUES (
          '${tenantId}', '${storedB.id}', '${storedB.hash}', 'CANDIDATE',
          'Unapproved Prompt must stay a Draft.'
        );
      `),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED"),
    });

    await runSql(`
      INSERT INTO prompt_evaluation_results (
        tenant_id, prompt_version_id, prompt_version_hash, report_hash,
        evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
        suite_name, suite_manifest_hash, report_document, report_canonical
      ) VALUES (${evaluationValues(storedC, initialC)});
    `);

    const crossTenantFailed = evaluationFor(
      storedC,
      "2026-08-24T05:00:00.000Z",
      false,
      `failed-c-${promptCId}`,
    );
    const crossTenantHolder = await holdPublicationSet(tenantId);
    await expect(
      runSql(
        `
          SET statement_timeout = '2s';
          INSERT INTO prompt_evaluation_results (
            tenant_id, prompt_version_id, prompt_version_hash, report_hash,
            evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
            suite_name, suite_manifest_hash, report_document, report_canonical
          ) VALUES (${evaluationValues(storedC, crossTenantFailed)});
        `,
        `prompt-release-cross-tenant-${otherTenantId}`,
      ),
    ).resolves.toBeUndefined();
    await crossTenantHolder.release("ROLLBACK");

    const sameTenantPassed = evaluationFor(
      storedA,
      "2026-08-24T04:30:00.000Z",
      true,
      `passed-a-${promptAId}`,
    );
    const sameTenantEvaluationId = randomUUID();
    const sameTenantHolder = await holdPublicationSet(tenantId);
    const sameTenantApplication = `prompt-release-same-tenant-${tenantId}`;
    const sameTenantMutation = runSql(
      `
        SET statement_timeout = '5s';
        INSERT INTO prompt_evaluation_results (
          id, tenant_id, prompt_version_id, prompt_version_hash, report_hash,
          evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
          suite_name, suite_manifest_hash, report_document, report_canonical
        ) VALUES (
          '${sameTenantEvaluationId}',
          ${evaluationValues(storedA, sameTenantPassed)}
        );
      `,
      sameTenantApplication,
    );
    await expectWaitingOnLock(sameTenantApplication, sameTenantMutation);
    await sameTenantHolder.release();
    await expect(sameTenantMutation).resolves.toBeUndefined();
    await runSql(`
      INSERT INTO prompt_candidacy_decisions (
        tenant_id, prompt_version_id, prompt_version_hash, decision,
        evaluation_result_id, reason
      ) VALUES (
        '${tenantId}', '${storedA.id}', '${storedA.hash}', 'CANDIDATE',
        '${sameTenantEvaluationId}', 'Latest approved evaluation selected.'
      );
    `);

    const deploymentHolder = await holdPublicationSet(tenantId);
    const deploymentApplication = `prompt-release-deployment-${tenantId}`;
    const deploymentChange = runSql(
      `
        SET statement_timeout = '5s';
        UPDATE prompt_deployments
        SET revision = revision + 1
        WHERE tenant_id = '${tenantId}'::uuid AND action = 'GENERATE';
      `,
      deploymentApplication,
    );
    await expectWaitingOnLock(deploymentApplication, deploymentChange);
    await deploymentHolder.release();
    await expect(deploymentChange).resolves.toBeUndefined();
    await expect(
      scalar(`
        SELECT prompt_version_id::text || '|' || revision::text
        FROM prompt_deployments
        WHERE tenant_id = '${tenantId}'::uuid AND action = 'GENERATE';
      `),
    ).resolves.toBe(`${storedA.id}|2`);

    const failedA = evaluationFor(
      storedA,
      "2026-08-24T05:00:00.000Z",
      false,
      `failed-a-${promptAId}`,
    );
    const evaluationHolder = await holdDeploymentQualityGate(tenantId);
    const evaluationApplication = `prompt-release-evaluation-${tenantId}`;
    const failedEvaluation = runSql(
      `
        SET statement_timeout = '5s';
        INSERT INTO prompt_evaluation_results (
          tenant_id, prompt_version_id, prompt_version_hash, report_hash,
          evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
          suite_name, suite_manifest_hash, report_document, report_canonical
        ) VALUES (${evaluationValues(storedA, failedA)});
      `,
      evaluationApplication,
    );
    await expectWaitingOnLock(evaluationApplication, failedEvaluation);
    await evaluationHolder.release();
    await expect(failedEvaluation).resolves.toBeUndefined();
    await expect(
      scalar(`
        SELECT passed_cases::text || '/' || evaluated_cases::text
        FROM prompt_evaluation_results AS evaluation
        WHERE tenant_id = '${tenantId}'::uuid
          AND prompt_version_id = '${storedA.id}'::uuid
          AND public.prompt_evaluation_evidence_is_complete(evaluation)
        ORDER BY evaluated_at DESC, recorded_at DESC, id DESC
        LIMIT 1;
      `),
    ).resolves.toBe("0/1");
    await expect(
      runSql(`
        UPDATE prompt_deployments
        SET revision = revision + 1
        WHERE tenant_id = '${tenantId}'::uuid AND action = 'GENERATE';
      `),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("PROMPT_DEPLOYMENT_CANDIDACY_GATE_REJECTED"),
    });

    const retirementHolder = await holdPublicationSet(tenantId);
    const retirementApplication = `prompt-release-retirement-${tenantId}`;
    const retirement = runSql(
      `
        SET statement_timeout = '5s';
        INSERT INTO prompt_candidacy_decisions (
          tenant_id, prompt_version_id, prompt_version_hash, decision, reason
        ) VALUES (
          '${tenantId}', '${storedA.id}', '${storedA.hash}', 'RETIRED',
          'Failed strict release evaluation.'
        );
      `,
      retirementApplication,
    );
    await expectWaitingOnLock(retirementApplication, retirement);
    await retirementHolder.release();
    await expect(retirement).resolves.toBeUndefined();
    await expect(
      scalar(`
        SELECT coalesce(
          public.prompt_is_effective_candidate(
            '${tenantId}'::uuid,
            '${storedA.id}'::uuid,
            '${storedA.hash}'
          ),
          false
        )::text;
      `),
    ).resolves.toBe("false");
  }, 30_000);
});
