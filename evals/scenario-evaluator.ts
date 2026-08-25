import {
  evaluateGrounding,
  type Candidate,
  type CandidateSegment,
  type GenerationAssertion,
  type GroundedCandidateClaim,
  type GroundingPostcondition,
} from "../packages/domain/src/generation/index.js";

import type { GoldenScenario } from "./types.js";

/** Deterministically replays one mocked-output scenario through the guard. */
export function evaluateScenario(scenario: GoldenScenario): {
  readonly passed: boolean;
  readonly failureReason?: string;
} {
  const groundedClaims: GroundedCandidateClaim[] =
    scenario.mockedModelOutput.claims.map((rc, idx) => {
      const claimId = rc.id || `c${idx + 1}`;
      const assertionIds =
        rc.assertionIds ?? scenario.assertions.map((assertion) => assertion.id);
      const supporting = scenario.assertions.find((assertion) =>
        assertionIds.includes(assertion.id),
      );
      return {
        id: claimId,
        semanticId: supporting?.semanticId ?? "unknown-semantic-id",
        semanticKind: supporting?.semanticKind ?? "experience-fact",
        polarity: supporting?.polarity ?? "positive",
        text: rc.text,
        grounding: assertionIds.map((assertionId) => ({
          kind: "assertion" as const,
          assertionId,
          assertionVersion: `${assertionId}-v1`,
        })),
      };
    });

  const segments: CandidateSegment[] = groundedClaims.flatMap((claim, index) => [
    { kind: "claim" as const, claimId: claim.id },
    ...(index < groundedClaims.length - 1
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
  const assertions: GenerationAssertion[] = scenario.assertions.map(
    (assertion) => ({
      id: assertion.id,
      version: `${assertion.id}-v1`,
      reviewSessionId: `session-${scenario.id}`,
      semanticId: assertion.semanticId,
      semanticKind: assertion.semanticKind,
      polarity: assertion.polarity,
      source:
        scenario.action === "paraphrase"
          ? {
              kind: "reviewer-text" as const,
              sourceRevisionId: "rev-1",
              start: 0,
              end: assertion.text.length,
              quotedText: assertion.text,
            }
          : {
              kind: "fact-option" as const,
              factOptionId: assertion.id,
              factOptionVersion: `${assertion.id}-v1`,
            },
    }),
  );
  const sourceClaims = scenario.assertions.map((assertion) => ({
    semanticId: assertion.semanticId,
    grounding: [
      {
        kind: "assertion" as const,
        assertionId: assertion.id,
        assertionVersion: `${assertion.id}-v1`,
      },
    ],
  }));
  const postcondition: GroundingPostcondition =
    scenario.action === "generate"
      ? {
          kind: "generate",
          allowedAssertionIds: scenario.assertions.map(
            (assertion) => assertion.id,
          ),
          allowedContextFactIds: [],
        }
      : scenario.action === "reformat"
        ? { kind: "reformat", sourceClaims }
        : scenario.action === "condense"
          ? {
              kind: "condense",
              sourceClaims,
              sourceDraftCharacterLength: 200,
              targetMaxChars: scenario.expectedMaxChars ?? 199,
            }
          : scenario.action === "expand"
            ? {
                kind: "expand",
                sourceClaims,
                sourceDraftCharacterLength: 10,
                targetMinChars: 11,
              }
            : scenario.action === "revise-wording"
              ? { kind: "revise-wording", sourceClaims }
              : scenario.action === "paraphrase"
                ? {
                    kind: "paraphrase",
                    sourceRevisionId: "rev-1",
                    allowedAssertionIds: scenario.assertions.map(
                      (assertion) => assertion.id,
                    ),
                    requiredSemanticIds: scenario.assertions.map(
                      (assertion) => assertion.semanticId,
                    ),
                  }
                : {
                    kind: "generate",
                    allowedAssertionIds: scenario.assertions.map(
                      (assertion) => assertion.id,
                    ),
                    allowedContextFactIds: [],
                  };
  const verdict = evaluateGrounding({
    reviewSessionId: `session-${scenario.id}`,
    candidate,
    assertions,
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
    scenario.expectedRejectionCode !== undefined
  ) {
    const matched =
      verdict.verdict === "rejected" &&
      verdict.reasons.some(
        (reason) => reason.code === scenario.expectedRejectionCode,
      );
    if (!matched) {
      return {
        passed: false,
        failureReason: `Expected rejection code '${scenario.expectedRejectionCode}', but reasons were: ${
          verdict.verdict === "rejected"
            ? verdict.reasons.map((reason) => reason.code).join(", ")
            : "none"
        }.`,
      };
    }
  }
  if (
    scenario.expectedMaxChars !== undefined &&
    scenario.mockedModelOutput.draft.length > scenario.expectedMaxChars
  ) {
    return {
      passed: false,
      failureReason: `Draft character length ${scenario.mockedModelOutput.draft.length} exceeded max constraint ${scenario.expectedMaxChars}.`,
    };
  }
  for (const term of scenario.disallowedTerms ?? []) {
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
  return { passed: true };
}
