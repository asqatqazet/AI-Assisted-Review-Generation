import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPostgresConsoleControlPlaneStore } from "../packages/db/src/control-plane/console-store.js";
import {
  STUDENT_STRICT_ZERO_PROMPT_APPROVAL,
  strictZeroPromptContentPolicy,
} from "../packages/db/src/deployment/prompt-release-content-policy.js";
import { PrismaClient } from "../packages/db/src/generated/control-plane/index.js";

const STUDENT_TENANT_ID = STUDENT_STRICT_ZERO_PROMPT_APPROVAL.tenantId;
const STUDENT_PROMPT_VERSION_ID =
  STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionId;
const STUDENT_REVIEW_FORMAT_VERSION_ID =
  "00000000-0000-4000-8000-000000000122";

type TargetPromptDeploymentChange = {
  readonly operation: "deploy-prompt-version";
  readonly action: "generate";
  readonly promptVersionId: string;
};

type Draft = {
  readonly id: string;
  readonly revision: string;
  readonly baseRevision: string;
  readonly changes: readonly unknown[];
};

export interface StudentReleaseQualificationConsole {
  listLocations(tenantId: string): Promise<readonly { readonly id: string }[]>;
  readPublishedConfigurationSnapshot(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly configurationReleaseId?: string | undefined;
  }): Promise<{
    readonly snapshotId: string;
    readonly contentHash: string;
    readonly payload: unknown;
  } | null>;
  stageConfigurationRelease(input: {
    readonly tenantId: string;
    readonly configurationReleaseId: string;
    readonly snapshotIds: readonly string[];
    readonly actorId: string;
  }): Promise<void>;
  readConfigurationState(input: {
    readonly tenantId: string;
    readonly locationId: null;
  }): Promise<{ readonly revision: string; readonly draft: Draft | null } | null>;
  promotePromptVersion(input: {
    readonly tenantId: string;
    readonly promptVersionId: string;
  }): Promise<
    | { readonly status: "candidate" }
    | { readonly status: "unknown-prompt" }
    | { readonly status: "quality-gate-rejected" }
  >;
  saveConfigurationDraft(input: {
    readonly tenantId: string;
    readonly locationId: null;
    readonly expectedRevision: string;
    readonly expectedDraft: null;
    readonly changes: readonly TargetPromptDeploymentChange[];
    readonly actorId: string;
  }): Promise<{ readonly status: "saved" | "conflict" }>;
  publishConfiguration(input: {
    readonly tenantId: string;
    readonly locationId: null;
    readonly expectedRevision: string;
    readonly expectedDraft: { readonly id: string; readonly revision: string };
    readonly actorId: string;
    readonly configurationReleaseId: string;
  }): Promise<
    | {
        readonly status: "published";
        readonly snapshotIds: readonly string[];
        readonly configurationReleaseId: string;
      }
    | { readonly status: "conflict" | "no-draft" }
    | { readonly status: "incomplete"; readonly missing: readonly string[] }
  >;
}

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | { readonly [key: string]: CanonicalJson };

function canonicalJson(value: CanonicalJson): string {
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
        `${JSON.stringify(key)}:${canonicalJson(entry as CanonicalJson)}`,
    )
    .join(",")}}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function snapshotContainsPrompt(
  payload: unknown,
  promptVersionId: string,
  promptVersionHash: string,
): boolean {
  const promptVersions = record(payload)?.["promptVersions"];
  return (
    Array.isArray(promptVersions) &&
    promptVersions.some((value) => {
      const prompt = record(value);
      return (
        prompt?.["id"] === promptVersionId &&
        prompt["hash"] === promptVersionHash &&
        prompt["commandKind"] === "generate"
      );
    })
  );
}

function exactStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry, index) => entry === expected[index])
  );
}

function studentSnapshotIsReusable(
  payload: unknown,
  promptVersionId: string,
  promptVersionHash: string,
): boolean {
  if (!snapshotContainsPrompt(payload, promptVersionId, promptVersionHash)) {
    return false;
  }
  const document = record(payload);
  const settings = record(document?.["settings"]);
  const providerRouting = record(document?.["providerRouting"]);
  const reviewFormats = document?.["reviewFormats"];
  const factOptions = document?.["factOptions"];
  const priceRates = document?.["priceRates"];
  if (
    settings?.["locale"] !== "de-DE" ||
    settings["entryMode"] !== "open-qr" ||
    settings["requireDisclosure"] !== false ||
    settings["requireVerifiedExperience"] !== false ||
    settings["maxReviewFormatsPerRequest"] !== 1 ||
    settings["minimumFactSelections"] !== 1 ||
    settings["maximumCustomerAssertionChars"] !== 500 ||
    settings["monthlyBudgetMicros"] !== 0 ||
    !exactStringArray(settings["enabledCommands"], ["generate"]) ||
    !exactStringArray(settings["enabledReviewFormatVersionIds"], [
      STUDENT_REVIEW_FORMAT_VERSION_ID,
    ]) ||
    providerRouting?.["primaryProvider"] !== "fake" ||
    providerRouting["primaryModel"] !== "fake-v1" ||
    !Array.isArray(factOptions) ||
    !factOptions.some((entry) => record(entry)?.["active"] === true) ||
    !Array.isArray(reviewFormats) ||
    reviewFormats.length !== 1 ||
    !Array.isArray(priceRates) ||
    priceRates.length !== 1
  ) {
    return false;
  }
  const format = record(reviewFormats[0]);
  const constraints = record(format?.["constraints"]);
  const rate = record(priceRates[0]);
  return (
    format?.["id"] === STUDENT_REVIEW_FORMAT_VERSION_ID &&
    exactStringArray(format["supportedCommands"], ["generate"]) &&
    constraints?.["minChars"] === 8 &&
    constraints["maxChars"] === 420 &&
    constraints["paragraphs"] === 1 &&
    constraints["emojiPolicy"] === "none" &&
    constraints["secondPerson"] === false &&
    rate?.["provider"] === "fake" &&
    rate["model"] === "fake-v1" &&
    rate["inputPerMillionMicros"] === 0 &&
    rate["outputPerMillionMicros"] === 0
  );
}

function isTargetDraft(
  draft: Draft,
  promptVersionId: string,
): boolean {
  if (draft.changes.length !== 1) {
    return false;
  }
  const change = record(draft.changes[0]);
  return (
    change?.["operation"] === "deploy-prompt-version" &&
    change["action"] === "generate" &&
    change["promptVersionId"] === promptVersionId
  );
}

export async function qualifyStudentRelease(input: {
  readonly console: StudentReleaseQualificationConsole;
  readonly operatorId: string;
  readonly tenantId: string;
  readonly promptVersionId: string;
  readonly promptVersionHash: string;
  readonly configurationReleaseId: string;
}): Promise<
  | {
      readonly status: "existing";
      readonly snapshotIds: readonly string[];
      readonly configurationReleaseId: string;
    }
  | {
      readonly status: "published";
      readonly snapshotIds: readonly string[];
      readonly configurationReleaseId: string;
    }
> {
  if (
    strictZeroPromptContentPolicy({
      tenantId: input.tenantId,
      promptVersionId: input.promptVersionId,
      promptVersionHash: input.promptVersionHash,
      action: "GENERATE",
    }) !== "approved"
  ) {
    throw new Error("STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED");
  }
  const locations = await input.console.listLocations(input.tenantId);
  if (locations.length === 0) {
    throw new Error("STUDENT_RELEASE_HAS_NO_ACTIVE_LOCATION");
  }
  const before = await Promise.all(
    locations.map(async (location) =>
      await input.console.readPublishedConfigurationSnapshot({
        tenantId: input.tenantId,
        locationId: location.id,
      }),
    ),
  );
  if (
    before.every(
      (snapshot) =>
        snapshot !== null &&
        studentSnapshotIsReusable(
          snapshot.payload,
          input.promptVersionId,
          input.promptVersionHash,
      ),
    )
  ) {
    const promoted = await input.console.promotePromptVersion({
      tenantId: input.tenantId,
      promptVersionId: input.promptVersionId,
    });
    if (promoted.status !== "candidate") {
      throw new Error(`STUDENT_RELEASE_PROMPT_${promoted.status.toUpperCase()}`);
    }
    const snapshotIds = before.flatMap((snapshot) =>
      snapshot === null ? [] : [snapshot.snapshotId],
    );
    await input.console.stageConfigurationRelease({
      tenantId: input.tenantId,
      configurationReleaseId: input.configurationReleaseId,
      snapshotIds,
      actorId: input.operatorId,
    });
    const staged = await Promise.all(
      locations.map(async (location) =>
        await input.console.readPublishedConfigurationSnapshot({
          tenantId: input.tenantId,
          locationId: location.id,
          configurationReleaseId: input.configurationReleaseId,
        }),
      ),
    );
    if (staged.some((snapshot) => snapshot === null)) {
      throw new Error("STUDENT_RELEASE_CANDIDATE_VERIFICATION_FAILED");
    }
    return {
      status: "existing",
      snapshotIds,
      configurationReleaseId: input.configurationReleaseId,
    };
  }

  let configuration = await input.console.readConfigurationState({
    tenantId: input.tenantId,
    locationId: null,
  });
  if (configuration === null) {
    throw new Error("STUDENT_RELEASE_TENANT_NOT_FOUND");
  }
  if (
    configuration.draft !== null &&
    !isTargetDraft(configuration.draft, input.promptVersionId)
  ) {
    throw new Error("STUDENT_RELEASE_CONFIGURATION_DRAFT_NOT_EMPTY");
  }

  const promoted = await input.console.promotePromptVersion({
    tenantId: input.tenantId,
    promptVersionId: input.promptVersionId,
  });
  if (promoted.status !== "candidate") {
    throw new Error(`STUDENT_RELEASE_PROMPT_${promoted.status.toUpperCase()}`);
  }

  if (configuration.draft === null) {
    const saved = await input.console.saveConfigurationDraft({
      tenantId: input.tenantId,
      locationId: null,
      expectedRevision: configuration.revision,
      expectedDraft: null,
      changes: [
        {
          operation: "deploy-prompt-version",
          action: "generate",
          promptVersionId: input.promptVersionId,
        },
      ],
      actorId: input.operatorId,
    });
    if (saved.status !== "saved") {
      throw new Error("STUDENT_RELEASE_DRAFT_CONFLICT");
    }
    configuration = await input.console.readConfigurationState({
      tenantId: input.tenantId,
      locationId: null,
    });
  }
  if (
    configuration === null ||
    configuration.draft === null ||
    !isTargetDraft(configuration.draft, input.promptVersionId)
  ) {
    throw new Error("STUDENT_RELEASE_DRAFT_NOT_PERSISTED");
  }

  const published = await input.console.publishConfiguration({
    tenantId: input.tenantId,
    locationId: null,
    expectedRevision: configuration.revision,
    expectedDraft: {
      id: configuration.draft.id,
      revision: configuration.draft.revision,
    },
    actorId: input.operatorId,
    configurationReleaseId: input.configurationReleaseId,
  });
  if (published.status !== "published") {
    const detail =
      published.status === "incomplete" ? `:${published.missing.join(",")}` : "";
    throw new Error(
      `STUDENT_RELEASE_PUBLICATION_${published.status.toUpperCase()}${detail}`,
    );
  }

  const after = await Promise.all(
    locations.map(async (location) =>
      await input.console.readPublishedConfigurationSnapshot({
        tenantId: input.tenantId,
        locationId: location.id,
        configurationReleaseId: input.configurationReleaseId,
      }),
    ),
  );
  if (
    !after.every(
      (snapshot) =>
        snapshot !== null &&
        snapshotContainsPrompt(
          snapshot.payload,
          input.promptVersionId,
          input.promptVersionHash,
        ),
    )
  ) {
    throw new Error("STUDENT_RELEASE_SNAPSHOT_VERIFICATION_FAILED");
  }
  if (published.configurationReleaseId !== input.configurationReleaseId) {
    throw new Error("STUDENT_RELEASE_CONFIGURATION_RELEASE_MISMATCH");
  }
  return {
    status: "published",
    snapshotIds: published.snapshotIds,
    configurationReleaseId: published.configurationReleaseId,
  };
}

interface ReleaseEvidenceRow {
  readonly tenantId: string;
  readonly promptVersionHash: string;
  readonly promptKey: string;
  readonly promptBody: string;
  readonly promptVariables: string[];
  readonly action: string;
  readonly retiredAt: Date | null;
  readonly reportHash: string | null;
  readonly evaluatedCases: number | null;
  readonly passedCases: number | null;
  readonly evaluatorReleaseSha: string | null;
  readonly suiteName: string | null;
  readonly suiteManifestHash: string | null;
  readonly reportDocument: unknown;
  readonly reportCanonical: string | null;
}

export async function verifyStudentReleaseEvidence(input: {
  readonly databaseUrl: string;
  readonly operatorEmail: string;
  readonly operatorIssuer: string;
  readonly releaseSha: string;
  readonly tenantId: string;
  readonly promptVersionId: string;
}): Promise<{ readonly operatorId: string; readonly promptVersionHash: string }> {
  if (
    !/^[0-9a-f]{40}$/u.test(input.releaseSha) ||
    /^0{40}$/u.test(input.releaseSha)
  ) {
    throw new Error("STUDENT_RELEASE_SHA_INVALID");
  }
  const client = new PrismaClient({ datasourceUrl: input.databaseUrl });
  try {
    return await client.$transaction(async (transaction) => {
      const owners = await transaction.$queryRaw<
        { readonly migrationOwner: boolean }[]
      >`
        SELECT current_user = pg_get_userbyid(class.relowner) AS "migrationOwner"
        FROM pg_class AS class
        WHERE class.oid = 'prompt_evaluation_results'::regclass
      `;
      if (owners[0]?.migrationOwner !== true) {
        throw new Error("STUDENT_RELEASE_MIGRATION_OWNER_REQUIRED");
      }
      const operators = await transaction.$queryRaw<
        { readonly operatorId: string }[]
      >`
        SELECT operator.id::text AS "operatorId"
        FROM operators AS operator
        WHERE operator.email = ${input.operatorEmail}::citext
          AND operator.external_issuer = ${input.operatorIssuer}
          AND operator.status = 'ACTIVE'
          AND EXISTS (
            SELECT 1
            FROM platform_access_grants AS access_grant
            JOIN operator_role_definitions AS role
              ON role.key = access_grant.role_key
            WHERE access_grant.operator_id = operator.id
              AND access_grant.status = 'ACTIVE'
              AND access_grant.valid_from <= clock_timestamp()
              AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
              AND role.status = 'ACTIVE'
              AND ARRAY['ai:operate', 'tenant:configure']::text[] <@ role.capabilities
          )
      `;
      const operatorId = operators[0]?.operatorId;
      if (operatorId === undefined || operators.length !== 1) {
        throw new Error("STUDENT_RELEASE_OPERATOR_NOT_AUTHORIZED");
      }
      const evidence = await transaction.$queryRaw<ReleaseEvidenceRow[]>`
        SELECT
          prompt.tenant_id::text AS "tenantId",
          prompt.content_hash AS "promptVersionHash",
          prompt.prompt_key AS "promptKey",
          prompt.body AS "promptBody",
          prompt.variables AS "promptVariables",
          prompt.action::text,
          prompt.retired_at AS "retiredAt",
          evaluation.report_hash AS "reportHash",
          evaluation.evaluated_cases AS "evaluatedCases",
          evaluation.passed_cases AS "passedCases",
          evaluation.evaluator_release_sha AS "evaluatorReleaseSha",
          evaluation.suite_name AS "suiteName",
          evaluation.suite_manifest_hash AS "suiteManifestHash",
          evaluation.report_document AS "reportDocument",
          evaluation.report_canonical AS "reportCanonical"
        FROM prompt_versions AS prompt
        LEFT JOIN LATERAL (
          SELECT result.*
          FROM prompt_evaluation_results AS result
          WHERE result.tenant_id = prompt.tenant_id
            AND result.prompt_version_id = prompt.id
            AND result.prompt_version_hash = prompt.content_hash
          ORDER BY result.evaluated_at DESC, result.recorded_at DESC, result.id DESC
          LIMIT 1
        ) AS evaluation ON true
        WHERE prompt.id = ${input.promptVersionId}::uuid
          AND prompt.tenant_id = ${input.tenantId}::uuid
      `;
      const row = evidence[0];
      if (
        row === undefined ||
        strictZeroPromptContentPolicy({
          tenantId: row.tenantId,
          promptVersionId: input.promptVersionId,
          promptVersionHash: row.promptVersionHash,
          action: row.action,
        }) !== "approved" ||
        row.action !== "GENERATE" ||
        row.retiredAt !== null ||
        row.evaluatorReleaseSha !== input.releaseSha ||
        row.reportCanonical === null ||
        row.reportHash === null ||
        row.suiteName === null ||
        row.suiteManifestHash === null ||
        row.evaluatedCases === null ||
        row.passedCases !== row.evaluatedCases ||
        row.evaluatedCases <= 0
      ) {
        throw new Error("STUDENT_RELEASE_EVIDENCE_NOT_QUALIFIED");
      }
      const report = record(row.reportDocument);
      const reportPrompt = record(report?.["promptVersion"]);
      const reportSuite = record(report?.["suite"]);
      const cases = reportSuite?.["cases"];
      const canonical = canonicalJson(
        row.reportDocument as unknown as CanonicalJson,
      );
      if (
        canonical !== row.reportCanonical ||
        `sha256:${createHash("sha256")
          .update(row.reportCanonical, "utf8")
          .digest("hex")}` !== row.reportHash ||
        report?.["schemaVersion"] !== 1 ||
        report["evaluatorReleaseSha"] !== input.releaseSha ||
        reportPrompt?.["id"] !== input.promptVersionId ||
        reportPrompt["tenantId"] !== input.tenantId ||
        reportPrompt["hash"] !== row.promptVersionHash ||
        reportPrompt["key"] !== row.promptKey ||
        reportPrompt["body"] !== row.promptBody ||
        canonicalJson(reportPrompt["variables"] as CanonicalJson) !==
          canonicalJson(row.promptVariables as CanonicalJson) ||
        reportSuite?.["name"] !== row.suiteName ||
        reportSuite["manifestHash"] !== row.suiteManifestHash ||
        reportSuite["providerBehaviorMeasured"] !== false ||
        !Array.isArray(cases) ||
        cases.length !== row.evaluatedCases
      ) {
        throw new Error("STUDENT_RELEASE_CANONICAL_REPORT_INVALID");
      }
      return { operatorId, promptVersionHash: row.promptVersionHash };
    });
  } finally {
    await client.$disconnect();
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`STUDENT_RELEASE_ENVIRONMENT_REQUIRED:${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const promptVersionId =
    process.env["REVIEW_PROMPT_VERSION_ID"] ?? STUDENT_PROMPT_VERSION_ID;
  if (promptVersionId !== STUDENT_PROMPT_VERSION_ID) {
    throw new Error("STUDENT_RELEASE_PROMPT_OVERRIDE_FORBIDDEN");
  }
  const consoleDatabaseUrl = requiredEnvironment(
    "CONSOLE_CONTROL_DATABASE_URL",
  );
  const consoleDatabaseAuthoritySecret = requiredEnvironment(
    "CONSOLE_DATABASE_AUTHORITY_SECRET",
  );
  const verified = await verifyStudentReleaseEvidence({
    databaseUrl: requiredEnvironment("DATABASE_URL"),
    operatorEmail: requiredEnvironment("REVIEW_OPERATOR_EMAIL"),
    operatorIssuer: requiredEnvironment("REVIEW_OPERATOR_ISSUER"),
    releaseSha: requiredEnvironment("REVIEW_RELEASE_SHA").toLowerCase(),
    tenantId: STUDENT_TENANT_ID,
    promptVersionId,
  });
  const store = createPostgresConsoleControlPlaneStore({
    databaseUrl: consoleDatabaseUrl,
    consoleDatabaseAuthoritySecret,
  });
  try {
    const result = await qualifyStudentRelease({
      console:
        store.forOperator(verified.operatorId) as unknown as StudentReleaseQualificationConsole,
      operatorId: verified.operatorId,
      tenantId: STUDENT_TENANT_ID,
      promptVersionId,
      promptVersionHash: verified.promptVersionHash,
      configurationReleaseId: requiredEnvironment(
        "REVIEW_CONFIGURATION_RELEASE_ID",
      ),
    });
    console.log(JSON.stringify({ ok: true, ...result }));
  } finally {
    await store.disconnect();
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  void main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        ok: false,
        code: error instanceof Error ? error.message : "UNKNOWN",
      }),
    );
    process.exitCode = 1;
  });
}
