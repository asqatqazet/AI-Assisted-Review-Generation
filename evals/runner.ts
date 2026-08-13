import * as fs from "node:fs";
import * as path from "node:path";
import {
  evaluateGrounding,
  type Candidate,
  type CandidateSegment,
  type GenerationAssertion,
  type GroundedCandidateClaim,
  type GroundingPostcondition,
} from "@review/domain/generation";

import type { GoldenEvalReport, GoldenScenario } from "./types.js";

export function evaluateScenario(scenario: GoldenScenario): {
  readonly passed: boolean;
  readonly failureReason?: string;
} {
  const groundedClaims: GroundedCandidateClaim[] =
    scenario.mockedModelOutput.claims.map((rc, idx) => {
      const claimId = rc.id || `c${idx + 1}`;
      const assertionIds = rc.assertionIds ?? scenario.assertions.map((a) => a.id);
      const supporting = scenario.assertions.find((a) => assertionIds.includes(a.id));
      return {
        id: claimId,
        semanticId: supporting?.semanticId ?? "unknown-semantic-id",
        semanticKind: supporting?.semanticKind ?? "experience-fact",
        polarity: supporting?.polarity ?? "positive",
        text: rc.text,
        grounding: assertionIds.map((aid) => ({
          kind: "assertion" as const,
          assertionId: aid,
          assertionVersion: `${aid}-v1`,
        })),
      };
    });

  const segments: CandidateSegment[] = groundedClaims.flatMap((gc, idx) => [
    { kind: "claim" as const, claimId: gc.id },
    ...(idx < groundedClaims.length - 1
      ? [{ kind: "connector" as const, text: " " }]
      : []),
  ]);

  const candidate: Candidate = {
    claims: groundedClaims,
    segments:
      segments.length > 0
        ? segments
        : [{ kind: "connector", text: scenario.mockedModelOutput.draft }],
  };

  const domainAssertions: GenerationAssertion[] = scenario.assertions.map(
    (a) => ({
      id: a.id,
      version: `${a.id}-v1`,
      reviewSessionId: `session-${scenario.id}`,
      semanticId: a.semanticId,
      semanticKind: a.semanticKind,
      polarity: a.polarity,
      source:
        scenario.action === "paraphrase"
          ? {
              kind: "reviewer-text" as const,
              sourceRevisionId: "rev-1",
              start: 0,
              end: a.text.length,
              quotedText: a.text,
            }
          : {
              kind: "fact-option" as const,
              factOptionId: a.id,
              factOptionVersion: `${a.id}-v1`,
            },
    }),
  );

  const postcondition: GroundingPostcondition =
    scenario.action === "generate"
      ? {
          kind: "generate",
          allowedAssertionIds: scenario.assertions.map((a) => a.id),
          allowedContextFactIds: [],
        }
      : scenario.action === "reformat"
        ? {
            kind: "reformat",
            sourceClaims: scenario.assertions.map((a) => ({
              semanticId: a.semanticId,
              grounding: [
                {
                  kind: "assertion" as const,
                  assertionId: a.id,
                  assertionVersion: `${a.id}-v1`,
                },
              ],
            })),
          }
        : scenario.action === "condense"
          ? {
              kind: "condense",
              sourceClaims: scenario.assertions.map((a) => ({
                semanticId: a.semanticId,
                grounding: [
                  {
                    kind: "assertion" as const,
                    assertionId: a.id,
                    assertionVersion: `${a.id}-v1`,
                  },
                ],
              })),
              sourceDraftCharacterLength: 200,
            }
          : scenario.action === "expand"
            ? {
                kind: "expand",
                sourceClaims: scenario.assertions.map((a) => ({
                  semanticId: a.semanticId,
                  grounding: [
                    {
                      kind: "assertion" as const,
                      assertionId: a.id,
                      assertionVersion: `${a.id}-v1`,
                    },
                  ],
                })),
                sourceDraftCharacterLength: 10,
              }
            : scenario.action === "revise-wording"
              ? {
                  kind: "revise-wording",
                  sourceClaims: scenario.assertions.map((a) => ({
                    semanticId: a.semanticId,
                    grounding: [
                      {
                        kind: "assertion" as const,
                        assertionId: a.id,
                        assertionVersion: `${a.id}-v1`,
                      },
                    ],
                  })),
                }
              : scenario.action === "paraphrase"
                ? {
                    kind: "paraphrase",
                    sourceRevisionId: "rev-1",
                    allowedAssertionIds: scenario.assertions.map((a) => a.id),
                    requiredSemanticIds: scenario.assertions.map(
                      (a) => a.semanticId,
                    ),
                  }
                : {
                    kind: "generate",
                    allowedAssertionIds: scenario.assertions.map((a) => a.id),
                    allowedContextFactIds: [],
                  };

  const verdict = evaluateGrounding({
    reviewSessionId: `session-${scenario.id}`,
    candidate,
    assertions: domainAssertions,
    permittedContextFacts: [],
    postcondition,
  });

  if (verdict.verdict !== scenario.expectedVerdict) {
    return {
      passed: false,
      failureReason: `Grounding verdict was '${verdict.verdict}', expected '${scenario.expectedVerdict}'.`,
    };
  }

  if (
    scenario.expectedVerdict === "rejected" &&
    scenario.expectedRejectionCode
  ) {
    const matchedCode =
      verdict.verdict === "rejected" &&
      verdict.reasons.some((r) => r.code === scenario.expectedRejectionCode);
    if (!matchedCode) {
      return {
        passed: false,
        failureReason: `Expected rejection code '${scenario.expectedRejectionCode}', but reasons were: ${
          verdict.verdict === "rejected"
            ? verdict.reasons.map((r) => r.code).join(", ")
            : "none"
        }`,
      };
    }
  }

  if (
    scenario.expectedMaxChars &&
    scenario.mockedModelOutput.draft.length > scenario.expectedMaxChars
  ) {
    return {
      passed: false,
      failureReason: `Draft character length ${scenario.mockedModelOutput.draft.length} exceeded max constraint ${scenario.expectedMaxChars}.`,
    };
  }

  if (scenario.disallowedTerms) {
    for (const term of scenario.disallowedTerms) {
      if (
        scenario.mockedModelOutput.draft
          .toLowerCase()
          .includes(term.toLowerCase())
      ) {
        return {
          passed: false,
          failureReason: `Draft contained disallowed term: '${term}'.`,
        };
      }
    }
  }

  return { passed: true };
}

export function runGoldenEvaluation(goldenDir = "evals/golden"): GoldenEvalReport {
  const dirPath = path.resolve(goldenDir);
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Golden scenarios directory '${dirPath}' does not exist.`);
  }

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    throw new Error(`No golden scenario files found in '${dirPath}'.`);
  }

  const results: { id: string; passed: boolean; failureReason?: string | undefined }[] = [];

  for (const file of files.sort()) {
    const raw = fs.readFileSync(path.join(dirPath, file), "utf8");
    const scenario = JSON.parse(raw) as GoldenScenario;
    const result = evaluateScenario(scenario);
    results.push({
      id: scenario.id,
      passed: result.passed,
      failureReason: result.failureReason,
    });
  }

  const totalScenarios = results.length;
  const passedScenarios = results.filter((r) => r.passed).length;
  const failedScenarios = totalScenarios - passedScenarios;
  const passRate = Number((passedScenarios / totalScenarios).toFixed(4));

  const report: GoldenEvalReport = {
    totalScenarios,
    passedScenarios,
    failedScenarios,
    passRate,
    results,
    timestamp: new Date().toISOString(),
  };

  const resultsDir = path.resolve("evals/results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(resultsDir, "latest.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );

  return report;
}

if (process.argv[1]?.endsWith("runner.ts") || process.argv[1]?.endsWith("runner.js")) {
  const report = runGoldenEvaluation();
  console.log(`\n======================================================`);
  console.log(` GOLDEN SET EVALUATION GATE REPORT`);
  console.log(`======================================================`);
  console.log(` Total Scenarios:  ${report.totalScenarios}`);
  console.log(` Passed:           ${report.passedScenarios}`);
  console.log(` Failed:           ${report.failedScenarios}`);
  console.log(` Pass Rate:        ${(report.passRate * 100).toFixed(1)}%`);
  console.log(` Result File:      evals/results/latest.json`);
  console.log(`======================================================\n`);

  if (report.failedScenarios > 0) {
    console.error("Evaluation Failures:");
    for (const r of report.results.filter((res) => !res.passed)) {
      console.error(` - [${r.id}]: ${r.failureReason}`);
    }
  }
}
