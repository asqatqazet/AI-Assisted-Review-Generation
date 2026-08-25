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

export interface GroundedSourceClaim {
  readonly semanticId: string;
  readonly grounding: readonly ClaimGroundingReference[];
}

export interface ResampleGroundingPostcondition {
  readonly kind: "resample";
  readonly allowedAssertionIds: readonly string[];
  readonly allowedContextFactIds: readonly string[];
}

export interface ParaphraseGroundingPostcondition {
  readonly kind: "paraphrase";
  readonly sourceRevisionId: string;
  readonly allowedAssertionIds: readonly string[];
  readonly requiredSemanticIds: readonly string[];
}

export interface ReformatGroundingPostcondition {
  readonly kind: "reformat";
  readonly sourceClaims: readonly GroundedSourceClaim[];
}

export interface CondenseGroundingPostcondition {
  readonly kind: "condense";
  readonly sourceClaims: readonly GroundedSourceClaim[];
  readonly sourceDraftCharacterLength: number;
  readonly targetMaxChars: number;
}

export interface ExpandGroundingPostcondition {
  readonly kind: "expand";
  readonly sourceClaims: readonly GroundedSourceClaim[];
  readonly sourceDraftCharacterLength: number;
  readonly targetMinChars: number;
}

export interface ReviseWordingGroundingPostcondition {
  readonly kind: "revise-wording";
  readonly sourceClaims: readonly GroundedSourceClaim[];
}

export type GroundingPostcondition =
  | GenerateGroundingPostcondition
  | ResampleGroundingPostcondition
  | ParaphraseGroundingPostcondition
  | ReformatGroundingPostcondition
  | CondenseGroundingPostcondition
  | ExpandGroundingPostcondition
  | ReviseWordingGroundingPostcondition;

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
  | "grounding-polarity-conflict"
  | "claim-added-by-transformation"
  | "required-claim-missing"
  | "required-assertion-missing"
  | "transitive-grounding-mismatch"
  | "source-revision-mismatch"
  | "condense-not-shorter"
  | "condense-target-not-met"
  | "expand-not-longer"
  | "expand-target-not-met";

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
  const allowedEvidence = allowedEvidenceFor(input.postcondition);
  const allowedAssertions = allowedEvidence.assertionIds;
  const allowedContextFacts = allowedEvidence.contextFactIds;

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
        if (
          input.postcondition.kind === "paraphrase" &&
          (evidence.source.kind !== "reviewer-text" ||
            evidence.source.sourceRevisionId !==
              input.postcondition.sourceRevisionId)
        ) {
          reasons.push(
            reason(
              "source-revision-mismatch",
              "This wording referred to a different version of the text you supplied.",
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

interface AllowedEvidence {
  readonly assertionIds: ReadonlySet<string>;
  readonly contextFactIds: ReadonlySet<string>;
}

function groundingReferenceKey(reference: ClaimGroundingReference): string {
  return reference.kind === "assertion"
    ? `assertion:${reference.assertionId}:${reference.assertionVersion}`
    : `context:${reference.contextFactId}:${reference.version}`;
}

function allowedEvidenceFor(
  postcondition: GroundingPostcondition,
): AllowedEvidence {
  if (
    postcondition.kind === "generate" ||
    postcondition.kind === "resample"
  ) {
    return {
      assertionIds: new Set(postcondition.allowedAssertionIds),
      contextFactIds: new Set(postcondition.allowedContextFactIds),
    };
  }
  if (postcondition.kind === "paraphrase") {
    return {
      assertionIds: new Set(postcondition.allowedAssertionIds),
      contextFactIds: new Set(),
    };
  }

  const assertionIds = new Set<string>();
  const contextFactIds = new Set<string>();
  for (const sourceClaim of postcondition.sourceClaims) {
    for (const reference of sourceClaim.grounding) {
      if (reference.kind === "assertion") {
        assertionIds.add(reference.assertionId);
      } else {
        contextFactIds.add(reference.contextFactId);
      }
    }
  }
  return { assertionIds, contextFactIds };
}

function validateRequiredSemanticSet(
  candidateSemanticIds: ReadonlySet<string>,
  requiredSemanticIds: ReadonlySet<string>,
  reasons: GroundingRejectionReason[],
): void {
  for (const semanticId of candidateSemanticIds) {
    if (!requiredSemanticIds.has(semanticId)) {
      reasons.push(
        reason(
          "claim-added-by-transformation",
          "This version introduced a fact that was not present in the source review.",
        ),
      );
    }
  }
  for (const semanticId of requiredSemanticIds) {
    if (!candidateSemanticIds.has(semanticId)) {
      reasons.push(
        reason(
          "required-claim-missing",
          "This version left out a fact that the command must preserve.",
        ),
      );
    }
  }
}

function validatePostcondition(
  input: GroundingEvaluationInput,
): readonly GroundingRejectionReason[] {
  const postcondition = input.postcondition;
  if (postcondition.kind === "generate" || postcondition.kind === "resample") {
    return [];
  }

  const reasons: GroundingRejectionReason[] = [];
  const candidateSemanticIds = new Set(
    input.candidate.claims.map((claim) => claim.semanticId),
  );

  if (postcondition.kind === "paraphrase") {
    const usedAssertionIds = new Set(
      input.candidate.claims.flatMap((claim) =>
        claim.grounding.flatMap((reference) =>
          reference.kind === "assertion" ? [reference.assertionId] : [],
        ),
      ),
    );
    for (const assertionId of postcondition.allowedAssertionIds) {
      if (!usedAssertionIds.has(assertionId)) {
        reasons.push(
          reason(
            "required-assertion-missing",
            "This paraphrase left out a proposition from the immutable source text.",
          ),
        );
      }
    }
    validateRequiredSemanticSet(
      candidateSemanticIds,
      new Set(postcondition.requiredSemanticIds),
      reasons,
    );
    return reasons;
  }

  const sourceSemanticIds = new Set(
    postcondition.sourceClaims.map((claim) => claim.semanticId),
  );
  for (const semanticId of candidateSemanticIds) {
    if (!sourceSemanticIds.has(semanticId)) {
      reasons.push(
        reason(
          "claim-added-by-transformation",
          "This version introduced a fact that was not present in the source review.",
        ),
      );
    }
  }

  const sourceGroundingBySemanticId = new Map<string, Set<string>>();
  for (const sourceClaim of postcondition.sourceClaims) {
    const references = sourceGroundingBySemanticId.get(sourceClaim.semanticId) ??
      new Set<string>();
    for (const reference of sourceClaim.grounding) {
      references.add(groundingReferenceKey(reference));
    }
    sourceGroundingBySemanticId.set(sourceClaim.semanticId, references);
  }

  for (const claim of input.candidate.claims) {
    const sourceReferences = sourceGroundingBySemanticId.get(claim.semanticId);
    if (sourceReferences === undefined) {
      continue;
    }
    const candidateReferences = new Set(
      claim.grounding.map(groundingReferenceKey),
    );
    if (
      candidateReferences.size !== sourceReferences.size ||
      [...candidateReferences].some(
        (reference) => !sourceReferences.has(reference),
      )
    ) {
      reasons.push(
        reason(
          "transitive-grounding-mismatch",
          "This version lost the original source of one of its facts.",
          claim.id,
        ),
      );
    }
  }

  if (
    postcondition.kind === "expand" ||
    postcondition.kind === "revise-wording"
  ) {
    for (const semanticId of sourceSemanticIds) {
      if (!candidateSemanticIds.has(semanticId)) {
        reasons.push(
          reason(
            "required-claim-missing",
            "This version left out a fact that the command must preserve.",
          ),
        );
      }
    }
  }

  const candidateCharacterLength = Array.from(renderCandidate(input.candidate)).length;
  if (
    postcondition.kind === "condense" &&
    candidateCharacterLength >= postcondition.sourceDraftCharacterLength
  ) {
    reasons.push(
      reason(
        "condense-not-shorter",
        "The condensed version was not shorter than the source review.",
      ),
    );
  }
  if (
    postcondition.kind === "condense" &&
    candidateCharacterLength > postcondition.targetMaxChars
  ) {
    reasons.push(
      reason(
        "condense-target-not-met",
        "The condensed version did not meet the requested maximum length.",
      ),
    );
  }
  if (
    postcondition.kind === "expand" &&
    candidateCharacterLength <= postcondition.sourceDraftCharacterLength
  ) {
    reasons.push(
      reason(
        "expand-not-longer",
        "The expanded version was not longer than the source review.",
      ),
    );
  }
  if (
    postcondition.kind === "expand" &&
    candidateCharacterLength < postcondition.targetMinChars
  ) {
    reasons.push(
      reason(
        "expand-target-not-met",
        "The expanded version did not meet the requested minimum length.",
      ),
    );
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
    ...validatePostcondition(input),
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
