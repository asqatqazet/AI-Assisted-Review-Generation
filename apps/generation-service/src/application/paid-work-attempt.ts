import type {
  CommandKind,
  EffectiveSettings,
  PromptVersion,
  ProviderRouting,
  ReviewFormatVersion,
} from "@review/domain/configuration";
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

export interface PaidWorkAttemptInput {
  readonly bindings: {
    readonly reviewFormatVersionId: string;
  };
  readonly snapshot: {
    readonly settings: Pick<
      EffectiveSettings,
      "locale" | "toneGuidelines" | "bannedTerms"
    >;
    readonly reviewFormats: readonly ReviewFormatVersion[];
    readonly promptVersions: readonly PromptVersion[];
    readonly providerRouting: Pick<ProviderRouting, "primaryModel">;
  };
  readonly command: {
    readonly kind: CommandKind | "resample";
  };
  readonly assertions: readonly {
    readonly id: string;
    readonly proposition: string;
  }[];
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
      execute: async () => await gateway.generate(requestPayload),
    };
  };
}
