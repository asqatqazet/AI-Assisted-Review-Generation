import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPostgresConsoleControlPlaneStore } from "../../packages/db/src/control-plane/console-store.js";
import {
  createPostgresPromptEvaluationIngestionDatabase,
  ingestPromptEvaluation,
  parsePromptEvaluationScenarios,
} from "../../packages/db/src/deployment/prompt-evaluation-ingestion.js";
import {
  qualifyStudentRelease,
  type StudentReleaseQualificationConsole,
} from "../../scripts/qualify-student-release.js";
import { PrismaClient } from "../../packages/db/src/generated/control-plane/index.js";

export const LOCAL_STATIC_EVALUATOR_RELEASE_SHA =
  "ffffffffffffffffffffffffffffffffffffffff";
const TENANT_ID = "00000000-0000-4000-8000-000000000101";
const PROMPT_VERSION_ID = "00000000-0000-4000-8000-000000000136";
const EVALUATED_AT = "2026-08-24T00:00:00.000Z";
const CONFIGURATION_RELEASE_ID = "00000000-0000-4000-8000-000000000034";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function digest(bytes: string | Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function loadLocalStaticSuite(): {
  readonly scenarios: ReturnType<typeof parsePromptEvaluationScenarios>;
  readonly manifestHash: string;
} {
  const directory = path.join(workspaceRoot, "evals", "golden");
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
  const manifest: { readonly path: string; readonly hash: string }[] = [];
  const values = names.map((name) => {
    const bytes = readFileSync(path.join(directory, name));
    manifest.push({ path: `evals/golden/${name}`, hash: digest(bytes) });
    return JSON.parse(bytes.toString("utf8")) as unknown;
  });
  return {
    scenarios: parsePromptEvaluationScenarios(values),
    manifestHash: digest(JSON.stringify(manifest)),
  };
}

/**
 * Explicit local/test bootstrap only. The report truthfully records
 * providerBehaviorMeasured=false and can never be selected by the AWS release
 * workflow, whose evaluator requires a clean tracked Git checkout and HEAD SHA.
 */
export async function qualifyLocalStaticPromptFixture(input: {
  readonly migrationDatabaseUrl: string;
  readonly consoleDatabaseUrl: string;
  readonly consoleDatabaseAuthoritySecret: string;
  readonly operatorId: string;
}): Promise<{
  readonly evaluationStatus: "inserted" | "existing";
  readonly publicationStatus: "published" | "existing";
}> {
  const suite = loadLocalStaticSuite();
  const evaluationDatabase =
    createPostgresPromptEvaluationIngestionDatabase(
      input.migrationDatabaseUrl,
    );
  let promptVersionHash: string;
  let evaluationStatus: "inserted" | "existing";
  try {
    const evidence = await ingestPromptEvaluation(evaluationDatabase, {
      promptVersionId: PROMPT_VERSION_ID,
      evaluatorReleaseSha: LOCAL_STATIC_EVALUATOR_RELEASE_SHA,
      suiteName: "local-static-checked-in-golden-fixture-v1",
      suiteManifestHash: suite.manifestHash,
      scenarios: suite.scenarios,
      evaluatedAt: EVALUATED_AT,
    });
    promptVersionHash = evidence.report.promptVersion.hash;
    evaluationStatus = evidence.status;
  } finally {
    await evaluationDatabase.disconnect();
  }

  const consoleStore = createPostgresConsoleControlPlaneStore({
    databaseUrl: input.consoleDatabaseUrl,
    consoleDatabaseAuthoritySecret: input.consoleDatabaseAuthoritySecret,
  });
  try {
    const publication = await qualifyStudentRelease({
      console:
        consoleStore.forOperator(input.operatorId) as unknown as StudentReleaseQualificationConsole,
      operatorId: input.operatorId,
      tenantId: TENANT_ID,
      promptVersionId: PROMPT_VERSION_ID,
      promptVersionHash,
      configurationReleaseId: CONFIGURATION_RELEASE_ID,
    });
    const migration = new PrismaClient({
      datasourceUrl: input.migrationDatabaseUrl,
    });
    try {
      await migration.$executeRawUnsafe(
        "DO $check$ BEGIN PERFORM public.assert_strict_zero_prompt_executable_state(); END $check$",
      );
      await migration.$queryRaw`
        SELECT public.promote_configuration_release(
          ${CONFIGURATION_RELEASE_ID}::uuid,
          ${input.operatorId}::uuid
        )
      `;
    } finally {
      await migration.$disconnect();
    }
    return {
      evaluationStatus,
      publicationStatus: publication.status,
    };
  } finally {
    await consoleStore.disconnect();
  }
}
