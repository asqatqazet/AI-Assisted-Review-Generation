import type {
  EffectiveSettings,
  PromptVersion,
  ProviderRouting,
  ReviewFormatVersion,
} from "@review/domain/configuration";
import {
  evaluateGrounding,
  type Candidate,
  type DraftSystemAnnotation,
  type GenerationAssertion,
  type GroundedCandidateClaim,
} from "@review/domain/generation";
import { applyPolicy } from "@review/domain/policy";
import { composePrompt } from "@review/domain/prompt";
import type { ReviewFormatManifest } from "@review/domain/review-format";

import type {
  ModelGatewayPort,
  ModelGatewayRequest,
} from "../ports/model-gateway.port.js";

export interface PaidWorkAttemptPreparerOptions {
  readonly gateway: ModelGatewayPort;
}

export interface PreparedPaidWorkAttempt {
  readonly requestPayload: ModelGatewayRequest;
  readonly execute: (attemptId: string) => Promise<PaidWorkAttemptResult>;
}

interface ProviderReturnedPaidWorkAttemptResult {
  readonly generationId: string;
  readonly attemptId: string;
  /** Raw structured Provider output. It is private audit evidence and must
   * never be projected through a reviewer transport contract. */
  readonly providerOutput: Readonly<Record<string, unknown>>;
  readonly attempt: Awaited<ReturnType<ModelGatewayPort["generate"]>>["attempt"];
}

export interface CompletedPaidWorkAttemptResult
  extends ProviderReturnedPaidWorkAttemptResult {
  readonly status: "completed";
  readonly draft: string;
  readonly draftBody: string;
  readonly systemAnnotations: readonly DraftSystemAnnotation[];
  readonly claims: readonly GroundedCandidateClaim[];
}

export interface RejectedPaidWorkAttemptResult
  extends ProviderReturnedPaidWorkAttemptResult {
  readonly status: "rejected";
  readonly code:
    | "GROUNDING_REJECTED"
    | "POLICY_REJECTED"
    | "FORMAT_REJECTED";
}

export type PaidWorkAttemptResult =
  | CompletedPaidWorkAttemptResult
  | RejectedPaidWorkAttemptResult;

export class PaidWorkGroundingRejectedError extends Error {
  public readonly code = "GROUNDING_REJECTED";

  public constructor() {
    super("The provider candidate failed grounding.");
    this.name = "PaidWorkGroundingRejectedError";
  }
}

export class PaidWorkPolicyRejectedError extends Error {
  public readonly code = "POLICY_REJECTED";

  public constructor() {
    super("The grounded candidate failed the resolved policy.");
    this.name = "PaidWorkPolicyRejectedError";
  }
}

export class PaidWorkFormatRejectedError extends Error {
  public readonly code = "FORMAT_REJECTED";

  public constructor() {
    super("The grounded candidate failed the selected Review Format.");
    this.name = "PaidWorkFormatRejectedError";
  }
}

export class PaidWorkActionEvidenceUnavailableError extends Error {
  public readonly code = "ACTION_SOURCE_EVIDENCE_NOT_RESOLVED";

  public constructor() {
    super("The immutable source evidence required by this Action was not resolved.");
    this.name = "PaidWorkActionEvidenceUnavailableError";
  }
}

export class PaidWorkTerminalDraftInvalidError extends Error {
  public readonly code = "TERMINAL_DRAFT_INVALID";

  public constructor() {
    super("The terminal Draft failed final validation.");
    this.name = "PaidWorkTerminalDraftInvalidError";
  }
}

type PaidWorkAttemptCommand =
  | {
      readonly kind: "generate";
      readonly assertionIds?: readonly string[];
      readonly rating?: number;
    }
  | {
      readonly kind: "paraphrase";
      readonly sourceTextRevisionId: string;
    }
  | { readonly kind: "reformat"; readonly sourceGenerationId: string }
  | {
      readonly kind: "condense";
      readonly sourceGenerationId: string;
      readonly targetMaxChars: number;
    }
  | {
      readonly kind: "expand";
      readonly sourceGenerationId: string;
      readonly targetMinChars: number;
    }
  | {
      readonly kind: "revise-wording";
      readonly sourceGenerationId: string;
      readonly presentationInstruction: string;
    }
  | { readonly kind: "resample"; readonly sourceGenerationId: string };

export interface PaidWorkAttemptInput {
  readonly bindings: {
    readonly generationId: string;
    readonly reviewSessionId: string;
    readonly reviewFormatVersionId: string;
  };
  readonly snapshot: {
    readonly tenantName: string;
    readonly settings: Pick<
      EffectiveSettings,
      | "locale"
      | "toneGuidelines"
      | "bannedTerms"
      | "requireDisclosure"
      | "requireVerifiedExperience"
      | "maxReviewFormatsPerRequest"
    >;
    readonly provenance: Readonly<
      Record<string, { readonly revision: string } | undefined>
    >;
    readonly reviewFormats: readonly ReviewFormatVersion[];
    readonly promptVersions: readonly PromptVersion[];
    readonly providerRouting: Pick<ProviderRouting, "primaryModel">;
  };
  readonly command: PaidWorkAttemptCommand;
  readonly assertions: readonly (GenerationAssertion & {
    readonly proposition: string;
  })[];
}

const normalizeProposition = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const containsEmoji = (value: string): boolean =>
  /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]{2}|[#*0-9]\uFE0F?\u20E3/u.test(
    value,
  );

const containsSecondPerson = (
  value: string,
  locale: EffectiveSettings["locale"],
): boolean => {
  switch (locale) {
    case "en-GB":
      return /\b(?:you|your|yours|yourself|yourselves)\b/iu.test(value);
    case "de-DE":
      return (
        /\b(?:du|dich|dir|dein(?:e|er|en|em|es)?|ihr|euch|euer(?:e|er|en|em|es)?)\b/iu.test(
          value,
        ) ||
        /\b(?:Sie|Ihnen|Ihr(?:e|er|en|em|es)?)\b/u.test(value)
      );
    default:
      throw new PaidWorkFormatRejectedError();
  }
};

const groundingPostconditionFor = (
  workload: PaidWorkAttemptInput,
): Parameters<typeof evaluateGrounding>[0]["postcondition"] => {
  if (workload.command.kind === "paraphrase") {
    return {
      kind: "paraphrase",
      sourceRevisionId: workload.command.sourceTextRevisionId,
      allowedAssertionIds: workload.assertions.map((assertion) => assertion.id),
      requiredSemanticIds: workload.assertions.map(
        (assertion) => assertion.semanticId,
      ),
    };
  }
  return {
    kind: "generate",
    allowedAssertionIds: workload.assertions.map((assertion) => assertion.id),
    allowedContextFactIds: [],
  };
};

const terminalCandidateFromClaims = (
  claims: readonly GroundedCandidateClaim[],
): Candidate => ({
  claims,
  segments: claims.flatMap((claim, index) => [
    { kind: "claim" as const, claimId: claim.id },
    ...(index < claims.length - 1
      ? [{ kind: "connector" as const, text: " " }]
      : []),
  ]),
});

const annotationsMatch = (
  actual: readonly DraftSystemAnnotation[],
  expected: readonly DraftSystemAnnotation[],
): boolean =>
  actual.length === expected.length &&
  actual.every((annotation, index) => {
    const expectedAnnotation = expected[index];
    return (
      expectedAnnotation !== undefined &&
      annotation.kind === expectedAnnotation.kind &&
      annotation.text === expectedAnnotation.text &&
      annotation.policyVersionId === expectedAnnotation.policyVersionId
    );
  });

export type PaidWorkTerminalValidationResult =
  | { readonly verdict: "pass" }
  | {
      readonly verdict: "rejected";
      readonly code:
        | "GROUNDING_REJECTED"
        | "POLICY_REJECTED"
        | "FORMAT_REJECTED";
    };

/**
 * The persisted Draft must be exactly the Claim-covered body followed only by
 * deterministic, typed system annotations from the resolved Tenant policy.
 */
export function validatePaidWorkTerminalDraft(
  workload: PaidWorkAttemptInput,
  artifact: Pick<
    CompletedPaidWorkAttemptResult,
    "claims" | "draft" | "draftBody" | "systemAnnotations"
  >,
): PaidWorkTerminalValidationResult {
  if (
    workload.command.kind !== "generate" &&
    workload.command.kind !== "paraphrase"
  ) {
    return { verdict: "rejected", code: "GROUNDING_REJECTED" };
  }
  const format = workload.snapshot.reviewFormats.find(
    (candidate) => candidate.id === workload.bindings.reviewFormatVersionId,
  );
  if (format === undefined) {
    return { verdict: "rejected", code: "FORMAT_REJECTED" };
  }
  const claimTextIsStillBoundToEvidence = artifact.claims.every((claim) => {
    if (claim.grounding.length !== 1) {
      return false;
    }
    const grounding = claim.grounding[0];
    if (grounding === undefined || grounding.kind !== "assertion") {
      return false;
    }
    const assertion = workload.assertions.find(
      (candidate) => candidate.id === grounding.assertionId,
    );
    return (
      assertion !== undefined &&
      normalizeProposition(claim.text) ===
        normalizeProposition(assertion.proposition)
    );
  });
  if (!claimTextIsStillBoundToEvidence) {
    return { verdict: "rejected", code: "GROUNDING_REJECTED" };
  }
  const grounding = evaluateGrounding({
    reviewSessionId: workload.bindings.reviewSessionId,
    candidate: terminalCandidateFromClaims(artifact.claims),
    assertions: workload.assertions,
    permittedContextFacts: [],
    postcondition: groundingPostconditionFor(workload),
  });
  if (
    grounding.verdict === "rejected" ||
    grounding.draftBody !== artifact.draftBody
  ) {
    return { verdict: "rejected", code: "GROUNDING_REJECTED" };
  }

  const policy = applyPolicy({
    draft: grounding.draftBody,
    claims: grounding.candidate.claims,
    policy: {
      requireDisclosure: workload.snapshot.settings.requireDisclosure,
      requireVerifiedExperience:
        workload.snapshot.settings.requireVerifiedExperience,
      maxReviewFormatsPerRequest:
        workload.snapshot.settings.maxReviewFormatsPerRequest,
      bannedTerms: workload.snapshot.settings.bannedTerms,
    },
    tenantName: workload.snapshot.tenantName,
    locale: workload.snapshot.settings.locale,
    disclosurePolicyVersionId:
      workload.snapshot.provenance["requireDisclosure"]?.revision,
  });
  if (
    policy.violations.length > 0 ||
    policy.draft !== artifact.draft ||
    !annotationsMatch(artifact.systemAnnotations, policy.systemAnnotations)
  ) {
    return { verdict: "rejected", code: "POLICY_REJECTED" };
  }

  let hasForbiddenSecondPerson: boolean;
  try {
    hasForbiddenSecondPerson =
      !format.constraints.secondPerson &&
      containsSecondPerson(
        artifact.draft,
        workload.snapshot.settings.locale,
      );
  } catch {
    return { verdict: "rejected", code: "FORMAT_REJECTED" };
  }
  const paragraphCount = artifact.draft
    .trim()
    .split(/\n\s*\n/u)
    .filter((paragraph) => paragraph.trim().length > 0).length;
  if (
    artifact.draft.length < format.constraints.minChars ||
    artifact.draft.length > format.constraints.maxChars ||
    paragraphCount !== format.constraints.paragraphs ||
    (format.constraints.emojiPolicy === "none" &&
      containsEmoji(artifact.draft)) ||
    hasForbiddenSecondPerson
  ) {
    return { verdict: "rejected", code: "FORMAT_REJECTED" };
  }
  return { verdict: "pass" };
}

function candidateFromProviderOutput(
  output: Readonly<Record<string, unknown>>,
  assertions: PaidWorkAttemptInput["assertions"],
): Candidate {
  const rawClaims = Array.isArray(output["claims"]) ? output["claims"] : [];
  const claims: GroundedCandidateClaim[] = rawClaims.map((rawClaim, index) => {
    const record =
      typeof rawClaim === "object" && rawClaim !== null
        ? (rawClaim as Readonly<Record<string, unknown>>)
        : {};
    const assertionIds = Array.isArray(record["assertionIds"])
      ? record["assertionIds"].filter(
          (assertionId): assertionId is string => typeof assertionId === "string",
        )
      : [];
    const supportingAssertion = assertions.find(
      (assertion) => assertion.id === assertionIds[0],
    );
    const text = typeof record["text"] === "string" ? record["text"] : "";
    if (
      assertionIds.length !== 1 ||
      supportingAssertion === undefined ||
      normalizeProposition(text) !==
        normalizeProposition(supportingAssertion.proposition)
    ) {
      throw new PaidWorkGroundingRejectedError();
    }

    return {
      id:
        typeof record["id"] === "string"
          ? record["id"]
          : `provider-claim-${index + 1}`,
      semanticId: supportingAssertion?.semanticId ?? `unknown-${index + 1}`,
      semanticKind: supportingAssertion?.semanticKind ?? "experience-fact",
      polarity: supportingAssertion?.polarity ?? "neutral",
      text,
      grounding: assertionIds.map((assertionId) => {
        const assertion = assertions.find((candidate) => candidate.id === assertionId);
        return {
          kind: "assertion" as const,
          assertionId,
          assertionVersion: assertion?.version ?? "unknown-version",
        };
      }),
    };
  });

  return {
    claims,
    segments: claims.flatMap((claim, index) => [
      { kind: "claim" as const, claimId: claim.id },
      ...(index < claims.length - 1
        ? [{ kind: "connector" as const, text: " " }]
        : []),
    ]),
  };
}

export function createPaidWorkAttemptPreparer({
  gateway,
}: PaidWorkAttemptPreparerOptions): (
  workload: PaidWorkAttemptInput,
) => Promise<PreparedPaidWorkAttempt> {
  return async (workload) => {
    const command = workload.command;
    if (
      command.kind !== "generate" &&
      command.kind !== "paraphrase"
    ) {
      throw new PaidWorkActionEvidenceUnavailableError();
    }
    const sourceTextRevisionId =
      command.kind === "paraphrase"
        ? command.sourceTextRevisionId
        : undefined;
    if (
      sourceTextRevisionId !== undefined &&
      workload.assertions.some(
        (assertion) =>
          assertion.source.kind !== "reviewer-text" ||
          assertion.source.sourceRevisionId !==
            sourceTextRevisionId ||
          normalizeProposition(assertion.proposition) !==
            normalizeProposition(assertion.source.quotedText),
      )
    ) {
      throw new PaidWorkActionEvidenceUnavailableError();
    }

    const format = workload.snapshot.reviewFormats.find(
      (candidate) => candidate.id === workload.bindings.reviewFormatVersionId,
    );
    if (
      format === undefined ||
      !format.supportedCommands.includes(command.kind)
    ) {
      throw new Error("REVIEW_FORMAT_NOT_AVAILABLE");
    }

    const matchingPrompts = workload.snapshot.promptVersions.filter(
      (candidate) => candidate.commandKind === command.kind,
    );
    if (matchingPrompts.length !== 1) {
      throw new Error("PROMPT_VERSION_NOT_RESOLVED");
    }

    const style: ReviewFormatManifest = {
      key: format.key,
      version: format.version,
      displayName: format.displayName,
      targetPlatform: format.targetPlatform,
      locale: format.locale,
      description: format.description,
      sample: format.sample,
      constraints: format.constraints,
      supportedCommands: format.supportedCommands,
      promptFragments: {
        styleGuide: `Structure: ${format.displayName}`,
        fewShot: [],
      },
    };
    const composed = composePrompt({
      snapshot: workload.snapshot,
      style,
      promptVersion: matchingPrompts[0]!,
      action: command.kind,
      assertions: workload.assertions.map((assertion) => ({
        id: assertion.id,
        proposition: assertion.proposition,
      })),
    });
    const requestPayload: ModelGatewayRequest = {
      model: workload.snapshot.providerRouting.primaryModel,
      messages: [
        { role: "system", content: composed.system },
        ...composed.messages,
      ],
      maxOutputTokens: 350,
      outputSchema: {
        name: "CandidateGeneration",
        schema: composed.outputSchema,
      },
    };

    return {
      requestPayload,
      execute: async (attemptId) => {
        const run = await gateway.generate(requestPayload);
        const rejected = (
          code: RejectedPaidWorkAttemptResult["code"],
        ): RejectedPaidWorkAttemptResult => ({
          status: "rejected",
          code,
          generationId: workload.bindings.generationId,
          attemptId,
          providerOutput: run.output,
          attempt: run.attempt,
        });
        let candidate: Candidate;
        try {
          candidate = candidateFromProviderOutput(
            run.output,
            workload.assertions,
          );
        } catch (error) {
          if (error instanceof PaidWorkGroundingRejectedError) {
            return rejected("GROUNDING_REJECTED");
          }
          throw error;
        }
        const grounding = evaluateGrounding({
          reviewSessionId: workload.bindings.reviewSessionId,
          candidate,
          assertions: workload.assertions,
          permittedContextFacts: [],
          postcondition:
            sourceTextRevisionId !== undefined
              ? {
                  kind: "paraphrase",
                  sourceRevisionId: sourceTextRevisionId,
                  allowedAssertionIds: workload.assertions.map(
                    (assertion) => assertion.id,
                  ),
                  requiredSemanticIds: workload.assertions.map(
                    (assertion) => assertion.semanticId,
                  ),
                }
              : {
                  kind: "generate",
                  allowedAssertionIds: workload.assertions.map(
                    (assertion) => assertion.id,
                  ),
                  allowedContextFactIds: [],
                },
        });
        if (grounding.verdict === "rejected") {
          return rejected("GROUNDING_REJECTED");
        }
        const policy = applyPolicy({
          draft: grounding.draftBody,
          claims: grounding.candidate.claims,
          policy: {
            requireDisclosure: workload.snapshot.settings.requireDisclosure,
            requireVerifiedExperience:
              workload.snapshot.settings.requireVerifiedExperience,
            maxReviewFormatsPerRequest:
              workload.snapshot.settings.maxReviewFormatsPerRequest,
            bannedTerms: workload.snapshot.settings.bannedTerms,
          },
          tenantName: workload.snapshot.tenantName,
          locale: workload.snapshot.settings.locale,
          disclosurePolicyVersionId:
            workload.snapshot.provenance["requireDisclosure"]?.revision,
        });
        const result: CompletedPaidWorkAttemptResult = {
          status: "completed",
          generationId: workload.bindings.generationId,
          attemptId,
          providerOutput: run.output,
          draft: policy.draft,
          draftBody: grounding.draftBody,
          systemAnnotations: policy.systemAnnotations,
          claims: grounding.candidate.claims,
          attempt: run.attempt,
        };
        const terminalValidation = validatePaidWorkTerminalDraft(
          workload,
          result,
        );
        if (terminalValidation.verdict === "rejected") {
          return rejected(terminalValidation.code);
        }
        return result;
      },
    };
  };
}
