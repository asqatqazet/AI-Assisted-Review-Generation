import { createHash } from "node:crypto";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface StrictPromptEvaluationFixtureInput {
  readonly promptId: string;
  readonly tenantId: string;
  readonly promptKey: string;
  readonly promptHash: string;
  readonly promptBody: string;
  readonly promptVariables: readonly string[];
  readonly evaluatedAt: string;
  readonly evaluatorReleaseSha?: string;
  readonly suiteName?: string;
  readonly scenarioId?: string;
  readonly passed?: boolean;
}

export interface StrictPromptEvaluationFixture {
  readonly canonical: string;
  readonly reportHash: string;
  readonly evaluatorReleaseSha: string;
  readonly suiteName: string;
  readonly suiteManifestHash: string;
  readonly evaluatedCases: 1;
  readonly passedCases: 0 | 1;
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

export function createStrictPromptEvaluationFixture(
  input: StrictPromptEvaluationFixtureInput,
): StrictPromptEvaluationFixture {
  const evaluatorReleaseSha =
    input.evaluatorReleaseSha ?? "1234567890abcdef1234567890abcdef12345678";
  const suiteName = input.suiteName ?? "control-plane-integration-fixture-v1";
  const suiteManifestHash = sha256(`suite:${suiteName}`);
  const scenarioId = input.scenarioId ?? `case-${input.promptId}`;
  const passed = input.passed ?? true;
  const report = {
    schemaVersion: 1,
    evaluatorReleaseSha,
    evaluatedAt: input.evaluatedAt,
    promptVersion: {
      id: input.promptId,
      tenantId: input.tenantId,
      action: "GENERATE",
      key: input.promptKey,
      hash: input.promptHash,
      body: input.promptBody,
      variables: [...input.promptVariables],
    },
    suite: {
      kind: "deterministic-compose-request-grounding-gate",
      name: suiteName,
      manifestHash: suiteManifestHash,
      providerBehaviorMeasured: false,
      cases: [
        {
          id: scenarioId,
          scenarioHash: sha256(`scenario:${scenarioId}`),
          composedRequestHash: sha256(`request:${scenarioId}`),
          passed,
          ...(passed ? {} : { failureReason: "Fixture evaluation failed." }),
        },
      ],
    },
  } as const;
  const canonical = canonicalJson(report);
  return {
    canonical,
    reportHash: sha256(canonical),
    evaluatorReleaseSha,
    suiteName,
    suiteManifestHash,
    evaluatedCases: 1,
    passedCases: passed ? 1 : 0,
  };
}

export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
