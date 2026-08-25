import { createHash } from "node:crypto";

import { derivePromptVersionHash } from "@review/domain/experiment";
import { composePrompt } from "@review/domain/prompt";
import { getBuiltInFormat } from "@review/domain/review-format";

import { evaluateScenario } from "../../../../evals/scenario-evaluator.js";
import type { GoldenScenario } from "../../../../evals/types.js";

import {
  PrismaClient,
  type Prisma,
} from "../generated/control-plane/index.js";

import { strictZeroPromptContentPolicy } from "./prompt-release-content-policy.js";

type StoredPromptAction =
  | "GENERATE"
  | "PARAPHRASE"
  | "REGENERATE"
  | "REFORMAT"
  | "CONDENSE"
  | "EXPAND"
  | "REVISE_WORDING"
  | "ADD_FACT";

const COMMAND_KIND_BY_ACTION = {
  GENERATE: "generate",
  PARAPHRASE: "paraphrase",
  REGENERATE: "generate",
  REFORMAT: "reformat",
  CONDENSE: "condense",
  EXPAND: "expand",
  REVISE_WORDING: "revise-wording",
  ADD_FACT: "generate",
} as const satisfies Readonly<
  Record<StoredPromptAction, Parameters<typeof derivePromptVersionHash>[0]["commandKind"]>
>;

export interface PromptVersionForEvaluation {
  readonly id: string;
  readonly tenantId: string;
  readonly action: StoredPromptAction;
  readonly key: string;
  readonly hash: string;
  readonly body: string;
  readonly variables: readonly string[];
}

export interface BoundPromptEvaluationReport {
  readonly schemaVersion: 1;
  readonly evaluatorReleaseSha: string;
  readonly evaluatedAt: string;
  readonly promptVersion: PromptVersionForEvaluation;
  readonly suite: {
    readonly kind: "deterministic-compose-request-grounding-gate";
    readonly name: string;
    readonly manifestHash: string;
    /** Mocked outputs exercise composition and the guard, not provider quality. */
    readonly providerBehaviorMeasured: false;
    readonly cases: readonly {
      readonly id: string;
      readonly scenarioHash: string;
      readonly composedRequestHash: string;
      readonly passed: boolean;
      readonly failureReason?: string | undefined;
    }[];
  };
}

export interface PromptEvaluationAppend {
  readonly tenantId: string;
  readonly promptVersionId: string;
  readonly promptVersionHash: string;
  readonly reportHash: string;
  readonly evaluatedCases: number;
  readonly passedCases: number;
  readonly evaluatorReleaseSha: string;
  readonly evaluatedAt: string;
  readonly suiteName: string;
  readonly suiteManifestHash: string;
  readonly reportDocument: BoundPromptEvaluationReport;
  readonly reportCanonical: string;
}

export interface PromptEvaluationIngestionTransaction {
  /** Refuses runtime credentials even if they can read Prompt metadata. */
  assertMigrationOwner(): Promise<void>;
  /** Locks immutable Prompt identity until the append completes. */
  lockPromptVersion(
    promptVersionId: string,
  ): Promise<PromptVersionForEvaluation | null>;
  appendEvaluation(
    evaluation: PromptEvaluationAppend,
  ): Promise<{ readonly status: "inserted" | "existing" }>;
}

export interface PromptEvaluationIngestionDatabase {
  transaction<T>(
    work: (transaction: PromptEvaluationIngestionTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PromptEvaluationIngestionInput {
  readonly promptVersionId: string;
  readonly evaluatorReleaseSha: string;
  readonly suiteName: string;
  readonly suiteManifestHash: string;
  readonly scenarios: readonly GoldenScenario[];
  readonly evaluatedAt: string;
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

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function assertInput(input: PromptEvaluationIngestionInput): void {
  if (
    !/^[0-9a-f]{40}$/u.test(input.evaluatorReleaseSha) ||
    /^0{40}$/u.test(input.evaluatorReleaseSha)
  ) {
    throw new Error("PROMPT_EVALUATION_RELEASE_SHA_INVALID");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.promptVersionId,
    )
  ) {
    throw new Error("PROMPT_EVALUATION_PROMPT_ID_INVALID");
  }
  if (
    input.suiteName.trim() === "" ||
    input.suiteName.length > 200 ||
    !/^sha256:[0-9a-f]{64}$/u.test(input.suiteManifestHash) ||
    input.scenarios.length === 0 ||
    !Number.isFinite(Date.parse(input.evaluatedAt)) ||
    new Date(input.evaluatedAt).toISOString() !== input.evaluatedAt
  ) {
    throw new Error("PROMPT_EVALUATION_REPORT_INVALID");
  }
  if (
    input.scenarios.some(
      (scenario) => scenario.id.trim() === "" || scenario.id.length > 200,
    )
  ) {
    throw new Error("PROMPT_EVALUATION_SCENARIO_INVALID");
  }
  if (
    new Set(input.scenarios.map((scenario) => scenario.id)).size !==
    input.scenarios.length
  ) {
    throw new Error("PROMPT_EVALUATION_SCENARIO_IDS_NOT_UNIQUE");
  }
}

function asCanonicalReport(
  report: BoundPromptEvaluationReport,
): CanonicalJson {
  return report as unknown as CanonicalJson;
}

function composeScenarioRequest(
  prompt: PromptVersionForEvaluation,
  scenario: GoldenScenario,
) {
  const action = COMMAND_KIND_BY_ACTION[prompt.action];
  const assertions = scenario.assertions.map((assertion) => ({
    id: assertion.id,
    proposition: assertion.text,
  }));
  const sourceGeneration = {
    draft: scenario.assertions.map((assertion) => assertion.text).join(" "),
    claims: scenario.assertions.map((assertion) => ({
      id: assertion.id,
      text: assertion.text,
      assertionIds: [assertion.id],
    })),
  };
  return composePrompt({
    snapshot: {
      settings: {
        locale: "en-GB",
        toneGuidelines: "Deterministic offline release evaluation.",
        bannedTerms: [...(scenario.disallowedTerms ?? [])],
      },
    },
    style: getBuiltInFormat(scenario.reviewFormatKey),
    promptVersion: {
      id: prompt.id,
      key: prompt.key,
      hash: prompt.hash,
      commandKind: action,
      body: prompt.body,
      variables: [...prompt.variables],
    },
    action,
    assertions,
    sourceGeneration,
    targetLength: scenario.expectedMaxChars,
    instruction:
      action === "revise-wording"
        ? "Improve wording without adding a factual proposition."
        : undefined,
  });
}

function evaluatePromptScenarios(
  prompt: PromptVersionForEvaluation,
  scenarios: readonly GoldenScenario[],
): BoundPromptEvaluationReport["suite"]["cases"] {
  const action = COMMAND_KIND_BY_ACTION[prompt.action];
  const applicable = scenarios
    .filter((scenario) => scenario.action === action)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (applicable.length === 0) {
    throw new Error("PROMPT_EVALUATION_ACTION_SUITE_EMPTY");
  }
  return applicable.map((scenario) => {
    const composed = composeScenarioRequest(prompt, scenario);
    const evaluation = evaluateScenario(scenario);
    const requestContainsExactPrompt = composed.system.startsWith(prompt.body);
    const passed = evaluation.passed && requestContainsExactPrompt;
    const failureReason = !requestContainsExactPrompt
      ? "The composed system request did not contain the exact immutable Prompt body."
      : evaluation.failureReason;
    return {
      id: scenario.id,
      scenarioHash: sha256(canonicalJson(scenario as unknown as CanonicalJson)),
      composedRequestHash: sha256(
        canonicalJson(composed as unknown as CanonicalJson),
      ),
      passed,
      ...(failureReason === undefined ? {} : { failureReason }),
    };
  });
}

/**
 * Deployment-only seam. It is intentionally absent from `@review/db` exports,
 * so Console and every runtime deployable have no import path to forge an
 * Evaluation Result. PostgreSQL independently requires the migration owner.
 */
export async function ingestPromptEvaluation(
  database: PromptEvaluationIngestionDatabase,
  input: PromptEvaluationIngestionInput,
): Promise<{
  readonly status: "inserted" | "existing";
  readonly report: BoundPromptEvaluationReport;
  readonly reportHash: string;
  readonly reportCanonical: string;
}> {
  assertInput(input);
  return await database.transaction(async (transaction) => {
    await transaction.assertMigrationOwner();
    const prompt = await transaction.lockPromptVersion(input.promptVersionId);
    if (prompt === null) {
      throw new Error("PROMPT_EVALUATION_PROMPT_NOT_FOUND");
    }
    const canonicalPromptHash = derivePromptVersionHash({
      key: prompt.key,
      commandKind: COMMAND_KIND_BY_ACTION[prompt.action],
      body: prompt.body,
      variables: prompt.variables,
    });
    if (prompt.hash !== canonicalPromptHash) {
      throw new Error("PROMPT_EVALUATION_PROMPT_NOT_CANONICAL");
    }
    if (
      strictZeroPromptContentPolicy({
        tenantId: prompt.tenantId,
        promptVersionId: prompt.id,
        promptVersionHash: prompt.hash,
        action: prompt.action,
      }) === "rejected"
    ) {
      throw new Error("STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED");
    }
    const cases = evaluatePromptScenarios(prompt, input.scenarios);
    const report: BoundPromptEvaluationReport = {
      schemaVersion: 1,
      evaluatorReleaseSha: input.evaluatorReleaseSha,
      evaluatedAt: input.evaluatedAt,
      promptVersion: {
        ...prompt,
        variables: [...prompt.variables],
      },
      suite: {
        kind: "deterministic-compose-request-grounding-gate",
        name: input.suiteName,
        manifestHash: input.suiteManifestHash,
        providerBehaviorMeasured: false,
        cases,
      },
    };
    const reportCanonical = canonicalJson(asCanonicalReport(report));
    const reportHash = sha256(reportCanonical);
    const persisted = await transaction.appendEvaluation({
      tenantId: prompt.tenantId,
      promptVersionId: prompt.id,
      promptVersionHash: prompt.hash,
      reportHash,
      evaluatedCases: cases.length,
      passedCases: cases.filter((testCase) => testCase.passed).length,
      evaluatorReleaseSha: input.evaluatorReleaseSha,
      evaluatedAt: input.evaluatedAt,
      suiteName: input.suiteName,
      suiteManifestHash: input.suiteManifestHash,
      reportDocument: report,
      reportCanonical,
    });
    return {
      status: persisted.status,
      report,
      reportHash,
      reportCanonical,
    };
  });
}

export interface PostgresPromptEvaluationIngestionDatabase
  extends PromptEvaluationIngestionDatabase {
  disconnect(): Promise<void>;
}

export function createPostgresPromptEvaluationIngestionDatabase(
  databaseUrl: string,
): PostgresPromptEvaluationIngestionDatabase {
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  return {
    async disconnect() {
      await client.$disconnect();
    },
    async transaction(work) {
      return await client.$transaction(async (prismaTransaction) => {
        const transaction: PromptEvaluationIngestionTransaction = {
          async assertMigrationOwner() {
            const rows = await prismaTransaction.$queryRaw<
              { readonly currentUser: string; readonly tableOwner: string }[]
            >`
              SELECT
                current_user::text AS "currentUser",
                pg_get_userbyid(class.relowner)::text AS "tableOwner"
              FROM pg_class AS class
              WHERE class.oid = 'prompt_evaluation_results'::regclass
            `;
            const authority = rows[0];
            if (
              authority === undefined ||
              authority.currentUser !== authority.tableOwner
            ) {
              throw new Error("PROMPT_EVALUATION_MIGRATION_OWNER_REQUIRED");
            }
          },
          async lockPromptVersion(promptVersionId) {
            const rows = await prismaTransaction.$queryRaw<
              {
                readonly id: string;
                readonly tenantId: string;
                readonly action: string;
                readonly key: string;
                readonly hash: string;
                readonly body: string;
                readonly variables: string[];
              }[]
            >`
              SELECT
                id::text,
                tenant_id::text AS "tenantId",
                action::text,
                prompt_key AS key,
                content_hash AS hash,
                body,
                variables
              FROM prompt_versions
              WHERE id = ${promptVersionId}::uuid
              FOR SHARE
            `;
            const row = rows[0];
            if (
              row === undefined ||
              !Object.hasOwn(COMMAND_KIND_BY_ACTION, row.action)
            ) {
              return null;
            }
            return {
              ...row,
              action: row.action as StoredPromptAction,
              variables: [...row.variables],
            };
          },
          async appendEvaluation(evaluation) {
            const inserted = await prismaTransaction.promptEvaluationResult.createMany({
              data: [
                {
                  tenantId: evaluation.tenantId,
                  promptVersionId: evaluation.promptVersionId,
                  promptVersionHash: evaluation.promptVersionHash,
                  reportHash: evaluation.reportHash,
                  evaluatedCases: evaluation.evaluatedCases,
                  passedCases: evaluation.passedCases,
                  evaluatorReleaseSha: evaluation.evaluatorReleaseSha,
                  suiteName: evaluation.suiteName,
                  suiteManifestHash: evaluation.suiteManifestHash,
                  reportDocument:
                    evaluation.reportDocument as unknown as Prisma.InputJsonValue,
                  reportCanonical: evaluation.reportCanonical,
                  evaluatedAt: new Date(evaluation.evaluatedAt),
                },
              ],
              skipDuplicates: true,
            });
            if (inserted.count === 1) {
              return { status: "inserted" };
            }
            const existing =
              await prismaTransaction.promptEvaluationResult.findFirst({
                where: {
                  tenantId: evaluation.tenantId,
                  promptVersionId: evaluation.promptVersionId,
                  reportHash: evaluation.reportHash,
                  promptVersionHash: evaluation.promptVersionHash,
                  evaluatedCases: evaluation.evaluatedCases,
                  passedCases: evaluation.passedCases,
                  evaluatorReleaseSha: evaluation.evaluatorReleaseSha,
                  suiteName: evaluation.suiteName,
                  suiteManifestHash: evaluation.suiteManifestHash,
                  reportCanonical: evaluation.reportCanonical,
                  evaluatedAt: new Date(evaluation.evaluatedAt),
                },
                select: { id: true },
              });
            if (existing === null) {
              throw new Error("PROMPT_EVALUATION_IDEMPOTENCY_CONFLICT");
            }
            return { status: "existing" };
          },
        };
        return await work(transaction);
      });
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Normalizes untrusted checked-in JSON before it can become evidence. */
export function parsePromptEvaluationScenarios(
  values: unknown,
): GoldenScenario[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("PROMPT_EVALUATION_SUITE_INVALID");
  }
  const parsed = values.map((value) => {
    const scenario = record(value);
    const output = record(scenario?.["mockedModelOutput"]);
    const assertions = scenario?.["assertions"];
    const claims = output?.["claims"];
    const action = scenario?.["action"];
    if (
      scenario === null ||
      typeof scenario["id"] !== "string" ||
      typeof scenario["description"] !== "string" ||
      typeof scenario["tenantId"] !== "string" ||
      typeof action !== "string" ||
      ![
        "generate",
        "paraphrase",
        "reformat",
        "condense",
        "expand",
        "revise-wording",
        "resample",
      ].includes(action) ||
      typeof scenario["reviewFormatKey"] !== "string" ||
      typeof scenario["promptVersionKey"] !== "string" ||
      !Array.isArray(assertions) ||
      assertions.length === 0 ||
      output === null ||
      typeof output["draft"] !== "string" ||
      !Array.isArray(claims) ||
      !(
        scenario["expectedVerdict"] === "pass" ||
        scenario["expectedVerdict"] === "rejected"
      )
    ) {
      throw new Error("PROMPT_EVALUATION_SCENARIO_INVALID");
    }
    const parsedAssertions = assertions.map((value) => {
      const assertion = record(value);
      if (
        assertion === null ||
        typeof assertion["id"] !== "string" ||
        typeof assertion["semanticId"] !== "string" ||
        !(
          assertion["semanticKind"] === "experience-fact" ||
          assertion["semanticKind"] === "rating-sentiment"
        ) ||
        !(
          assertion["polarity"] === "positive" ||
          assertion["polarity"] === "negative"
        ) ||
        typeof assertion["text"] !== "string"
      ) {
        throw new Error("PROMPT_EVALUATION_SCENARIO_INVALID");
      }
      return {
        id: assertion["id"],
        semanticId: assertion["semanticId"],
        semanticKind: assertion["semanticKind"] as
          | "experience-fact"
          | "rating-sentiment",
        polarity: assertion["polarity"] as "positive" | "negative",
        text: assertion["text"],
      };
    });
    const parsedClaims = claims.map((value) => {
      const claim = record(value);
      const assertionIds = claim?.["assertionIds"];
      if (
        claim === null ||
        typeof claim["id"] !== "string" ||
        typeof claim["text"] !== "string" ||
        !(
          assertionIds === undefined ||
          (Array.isArray(assertionIds) &&
            assertionIds.every((id) => typeof id === "string"))
        )
      ) {
        throw new Error("PROMPT_EVALUATION_SCENARIO_INVALID");
      }
      return {
        id: claim["id"],
        text: claim["text"],
        ...(assertionIds === undefined
          ? {}
          : { assertionIds: [...assertionIds] as string[] }),
      };
    });
    const expectedMaxChars = scenario["expectedMaxChars"];
    const disallowedTerms = scenario["disallowedTerms"];
    if (
      !(
        expectedMaxChars === undefined ||
        (typeof expectedMaxChars === "number" &&
          Number.isSafeInteger(expectedMaxChars) &&
          expectedMaxChars > 0)
      ) ||
      !(
        disallowedTerms === undefined ||
        (Array.isArray(disallowedTerms) &&
          disallowedTerms.every((term) => typeof term === "string"))
      ) ||
      !(
        scenario["expectedRejectionCode"] === undefined ||
        typeof scenario["expectedRejectionCode"] === "string"
      )
    ) {
      throw new Error("PROMPT_EVALUATION_SCENARIO_INVALID");
    }
    // `resample` is a checked-in legacy/source-generation scenario. Its raw
    // bytes remain bound by the suite manifest, but until that Action has a
    // release implementation it must not be re-labelled as Generate evidence.
    if (action === "resample") {
      return null;
    }
    return {
      id: scenario["id"],
      description: scenario["description"],
      tenantId: scenario["tenantId"],
      action: action as GoldenScenario["action"],
      reviewFormatKey: scenario["reviewFormatKey"],
      promptVersionKey: scenario["promptVersionKey"],
      assertions: parsedAssertions,
      mockedModelOutput: {
        draft: output["draft"],
        claims: parsedClaims,
      },
      expectedVerdict: scenario["expectedVerdict"] as "pass" | "rejected",
      ...(scenario["expectedRejectionCode"] === undefined
        ? {}
        : {
            expectedRejectionCode: scenario["expectedRejectionCode"] as string,
          }),
      ...(expectedMaxChars === undefined ? {} : { expectedMaxChars }),
      ...(disallowedTerms === undefined
        ? {}
        : { disallowedTerms: [...disallowedTerms] as string[] }),
    };
  });
  return parsed.filter(
    (scenario): scenario is Exclude<typeof scenario, null> => scenario !== null,
  );
}
