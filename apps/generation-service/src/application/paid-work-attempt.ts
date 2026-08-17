import type {
  CommandKind,
  EffectiveSettings,
  PromptVersion,
  ProviderRouting,
  ReviewFormatVersion,
} from "@review/domain/configuration";
import {
  evaluateGrounding,
  type Candidate,
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
  readonly execute: (attemptId: string) => Promise<unknown>;
}

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
    readonly reviewFormats: readonly ReviewFormatVersion[];
    readonly promptVersions: readonly PromptVersion[];
    readonly providerRouting: Pick<ProviderRouting, "primaryModel">;
  };
  readonly command: {
    readonly kind: CommandKind | "resample";
  };
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
    if (workload.command.kind !== "generate") {
      throw new Error("PAID_WORK_ACTION_NOT_IMPLEMENTED");
    }

    const format = workload.snapshot.reviewFormats.find(
      (candidate) => candidate.id === workload.bindings.reviewFormatVersionId,
    );
    if (
      format === undefined ||
      !format.supportedCommands.includes(workload.command.kind)
    ) {
      throw new Error("REVIEW_FORMAT_NOT_AVAILABLE");
    }

    const matchingPrompts = workload.snapshot.promptVersions.filter(
      (candidate) => candidate.commandKind === workload.command.kind,
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
      action: workload.command.kind,
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
        const candidate = candidateFromProviderOutput(
          run.output,
          workload.assertions,
        );
        const grounding = evaluateGrounding({
          reviewSessionId: workload.bindings.reviewSessionId,
          candidate,
          assertions: workload.assertions,
          permittedContextFacts: [],
          postcondition: {
            kind: "generate",
            allowedAssertionIds: workload.assertions.map(
              (assertion) => assertion.id,
            ),
            allowedContextFactIds: [],
          },
        });
        if (grounding.verdict === "rejected") {
          throw new PaidWorkGroundingRejectedError();
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
        });
        if (policy.violations.length > 0) {
          throw new PaidWorkPolicyRejectedError();
        }

        return {
          status: "completed",
          generationId: workload.bindings.generationId,
          attemptId,
          draft: policy.draft,
          claims: grounding.candidate.claims,
          attempt: run.attempt,
        };
      },
    };
  };
}
