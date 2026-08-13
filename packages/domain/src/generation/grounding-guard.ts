export type ClaimPolarity = "positive" | "neutral" | "negative";
export type SemanticKind =
  | "experience-fact"
  | "rating-sentiment"
  | "verified-context";

export type AssertionSource =
  | {
      readonly kind: "fact-option";
      readonly factOptionId: string;
      readonly factOptionVersion: string;
    }
  | {
      readonly kind: "reviewer-text";
      readonly sourceRevisionId: string;
      readonly start: number;
      readonly end: number;
      readonly quotedText: string;
    }
  | { readonly kind: "rating"; readonly rating: 1 | 2 | 3 | 4 | 5 }
  | {
      readonly kind: "confirmed-fact";
      readonly sourceRevisionId: string;
    };

export interface GenerationAssertion {
  readonly id: string;
  readonly version: string;
  readonly reviewSessionId: string;
  readonly semanticId: string;
  readonly semanticKind: Exclude<SemanticKind, "verified-context">;
  readonly polarity: ClaimPolarity;
  readonly source: AssertionSource;
}

export interface PermittedContextFact {
  readonly id: string;
  readonly version: string;
  readonly reviewSessionId: string;
  readonly semanticId: string;
  readonly semanticKind: "verified-context";
  readonly polarity: ClaimPolarity;
}

export type ClaimGroundingReference =
  | {
      readonly kind: "assertion";
      readonly assertionId: string;
      readonly assertionVersion: string;
    }
  | {
      readonly kind: "verified-context";
      readonly contextFactId: string;
      readonly version: string;
    };

export interface GroundedCandidateClaim {
  readonly id: string;
  readonly semanticId: string;
  readonly semanticKind: SemanticKind;
  readonly polarity: ClaimPolarity;
  readonly text: string;
  readonly grounding: readonly ClaimGroundingReference[];
}

export type CandidateSegment =
  | { readonly kind: "claim"; readonly claimId: string }
  | { readonly kind: "connector"; readonly text: string };

export interface Candidate {
  readonly claims: readonly GroundedCandidateClaim[];
  readonly segments: readonly CandidateSegment[];
}

export interface GenerateGroundingPostcondition {
  readonly kind: "generate";
  readonly allowedAssertionIds: readonly string[];
  readonly allowedContextFactIds: readonly string[];
}

export type GroundingPostcondition = GenerateGroundingPostcondition;

export interface GroundingEvaluationInput {
  readonly reviewSessionId: string;
  readonly candidate: Candidate;
  readonly assertions: readonly GenerationAssertion[];
  readonly permittedContextFacts: readonly PermittedContextFact[];
  readonly postcondition: GroundingPostcondition;
}

export type GroundingRejectionCode =
  | "empty-candidate"
  | "duplicate-claim-id"
  | "empty-claim-text"
  | "unknown-claim-segment"
  | "unsafe-connector"
  | "unrendered-claim"
  | "missing-grounding"
  | "unknown-assertion"
  | "cross-session-assertion"
  | "assertion-version-mismatch"
  | "assertion-not-allowed"
  | "unknown-context-fact"
  | "cross-session-context-fact"
  | "context-version-mismatch"
  | "context-fact-not-allowed"
  | "grounding-kind-conflict"
  | "grounding-identity-conflict"
  | "grounding-polarity-conflict";

export interface GroundingRejectionReason {
  readonly code: GroundingRejectionCode;
  readonly claimId?: string;
  readonly message: string;
}

export type GroundingResult =
  | {
      readonly verdict: "pass";
      readonly candidate: Candidate;
      readonly draftBody: string;
    }
  | {
      readonly verdict: "rejected";
      readonly candidate: null;
      readonly draftBody: null;
      readonly reasons: readonly GroundingRejectionReason[];
    };

const reason = (
  code: GroundingRejectionCode,
  message: string,
  claimId?: string,
): GroundingRejectionReason =>
  claimId === undefined ? { code, message } : { code, claimId, message };

const isSafeConnector = (text: string): boolean =>
  /^[\p{P}\p{Z}\s]*$/u.test(text);

const hasOppositePolarity = (
  claim: ClaimPolarity,
  evidence: ClaimPolarity,
): boolean =>
  (claim === "positive" && evidence === "negative") ||
  (claim === "negative" && evidence === "positive");

function validateCoverage(candidate: Candidate): readonly GroundingRejectionReason[] {
  if (candidate.claims.length === 0 && candidate.segments.length === 0) {
    return [
      reason(
        "empty-candidate",
        "No grounded review text could be produced from the supplied facts.",
      ),
    ];
  }

  const reasons: GroundingRejectionReason[] = [];
  const claimById = new Map<string, GroundedCandidateClaim>();
  for (const claim of candidate.claims) {
    if (claimById.has(claim.id)) {
      reasons.push(
        reason(
          "duplicate-claim-id",
          "The generated response repeated an internal claim identity.",
          claim.id,
        ),
      );
      continue;
    }
    claimById.set(claim.id, claim);
    if (claim.text.trim().length === 0) {
      reasons.push(
        reason(
          "empty-claim-text",
          "The generated response contained an empty claim.",
          claim.id,
        ),
      );
    }
  }

  const renderedClaimIds = new Set<string>();
  for (const segment of candidate.segments) {
    if (segment.kind === "claim") {
      if (!claimById.has(segment.claimId)) {
        reasons.push(
          reason(
            "unknown-claim-segment",
            "The generated response contained text without a matching grounded claim.",
          ),
        );
      } else {
        renderedClaimIds.add(segment.claimId);
      }
    } else if (!isSafeConnector(segment.text)) {
      reasons.push(
        reason(
          "unsafe-connector",
          "The generated response placed factual wording outside its grounded claims.",
        ),
      );
    }
  }

  for (const claim of candidate.claims) {
    if (!renderedClaimIds.has(claim.id)) {
      reasons.push(
        reason(
          "unrendered-claim",
          "A grounded claim was not represented in the generated review text.",
          claim.id,
        ),
      );
    }
  }

  return reasons;
}

function validateEvidence(
  input: GroundingEvaluationInput,
): readonly GroundingRejectionReason[] {
  const reasons: GroundingRejectionReason[] = [];
  const assertionById = new Map(input.assertions.map((item) => [item.id, item]));
  const contextById = new Map(
    input.permittedContextFacts.map((item) => [item.id, item]),
  );
  const allowedAssertions = new Set(input.postcondition.allowedAssertionIds);
  const allowedContextFacts = new Set(
    input.postcondition.allowedContextFactIds,
  );

  for (const claim of input.candidate.claims) {
    if (claim.grounding.length === 0) {
      reasons.push(
        reason(
          "missing-grounding",
          "This wording was not supported by anything you supplied.",
          claim.id,
        ),
      );
      continue;
    }

    for (const reference of claim.grounding) {
      if (reference.kind === "assertion") {
        const evidence = assertionById.get(reference.assertionId);
        if (evidence === undefined) {
          reasons.push(
            reason(
              "unknown-assertion",
              "This wording referred to a fact that was not supplied in this review.",
              claim.id,
            ),
          );
          continue;
        }
        if (evidence.reviewSessionId !== input.reviewSessionId) {
          reasons.push(
            reason(
              "cross-session-assertion",
              "This wording referred to facts from a different review session.",
              claim.id,
            ),
          );
          continue;
        }
        if (evidence.version !== reference.assertionVersion) {
          reasons.push(
            reason(
              "assertion-version-mismatch",
              "This wording referred to an outdated version of a supplied fact.",
              claim.id,
            ),
          );
          continue;
        }
        if (!allowedAssertions.has(evidence.id)) {
          reasons.push(
            reason(
              "assertion-not-allowed",
              "This wording used a fact that was not selected for this request.",
              claim.id,
            ),
          );
          continue;
        }
        if (claim.semanticKind !== evidence.semanticKind) {
          reasons.push(
            reason(
              "grounding-kind-conflict",
              "This wording used one kind of evidence to support a different kind of statement.",
              claim.id,
            ),
          );
          continue;
        }
        if (claim.semanticId !== evidence.semanticId) {
          reasons.push(
            reason(
              "grounding-identity-conflict",
              "This wording did not identify the same fact as its supporting evidence.",
              claim.id,
            ),
          );
          continue;
        }
        if (hasOppositePolarity(claim.polarity, evidence.polarity)) {
          reasons.push(
            reason(
              "grounding-polarity-conflict",
              "This wording reversed the meaning of a fact you supplied.",
              claim.id,
            ),
          );
        }
        continue;
      }

      const evidence = contextById.get(reference.contextFactId);
      if (evidence === undefined) {
        reasons.push(
          reason(
            "unknown-context-fact",
            "This wording referred to context that was not verified for this review.",
            claim.id,
          ),
        );
        continue;
      }
      if (evidence.reviewSessionId !== input.reviewSessionId) {
        reasons.push(
          reason(
            "cross-session-context-fact",
            "This wording referred to context from a different review session.",
            claim.id,
          ),
        );
        continue;
      }
      if (evidence.version !== reference.version) {
        reasons.push(
          reason(
            "context-version-mismatch",
            "This wording referred to an outdated version of verified context.",
            claim.id,
          ),
        );
        continue;
      }
      if (!allowedContextFacts.has(evidence.id)) {
        reasons.push(
          reason(
            "context-fact-not-allowed",
            "This wording used context that was not permitted for this request.",
            claim.id,
          ),
        );
        continue;
      }
      if (claim.semanticKind !== evidence.semanticKind) {
        reasons.push(
          reason(
            "grounding-kind-conflict",
            "This wording used verified context to support a different kind of statement.",
            claim.id,
          ),
        );
        continue;
      }
      if (claim.semanticId !== evidence.semanticId) {
        reasons.push(
          reason(
            "grounding-identity-conflict",
            "This wording did not identify the same fact as its verified context.",
            claim.id,
          ),
        );
        continue;
      }
      if (hasOppositePolarity(claim.polarity, evidence.polarity)) {
        reasons.push(
          reason(
            "grounding-polarity-conflict",
            "This wording reversed the meaning of verified context.",
            claim.id,
          ),
        );
      }
    }
  }

  return reasons;
}

function renderCandidate(candidate: Candidate): string {
  const claims = new Map(candidate.claims.map((claim) => [claim.id, claim]));
  return candidate.segments
    .map((segment) =>
      segment.kind === "claim"
        ? (claims.get(segment.claimId)?.text ?? "")
        : segment.text,
    )
    .join("");
}

export function evaluateGrounding(
  input: GroundingEvaluationInput,
): GroundingResult {
  const reasons = [
    ...validateCoverage(input.candidate),
    ...validateEvidence(input),
  ];

  if (reasons.length > 0) {
    return {
      verdict: "rejected",
      candidate: null,
      draftBody: null,
      reasons,
    };
  }

  return {
    verdict: "pass",
    candidate: input.candidate,
    draftBody: renderCandidate(input.candidate),
  };
}
