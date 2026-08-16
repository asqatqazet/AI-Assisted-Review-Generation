import type {
  CommandKind,
  PriceRate,
  ResolvedConfigSnapshot,
} from "@review/domain/configuration";
import {
  evaluateGrounding,
  type Candidate,
  type CandidateSegment,
  type GenerationAssertion,
  type GroundedCandidateClaim,
  type GroundingPostcondition,
  type GroundingResult,
  type PermittedContextFact,
} from "@review/domain/generation";
import { applyPolicy } from "@review/domain/policy";
import { composePrompt } from "@review/domain/prompt";
import {
  getBuiltInFormat,
  type ReviewFormatManifest,
} from "@review/domain/review-format";

import type {
  ModelGatewayAttempt,
  ModelGatewayPort,
} from "../ports/model-gateway.port.js";
import type { TelemetryPort } from "../ports/telemetry.port.js";

export interface GenerationRequest {
  readonly idempotencyKey: string;
  readonly reviewSessionId: string;
  readonly action: CommandKind;
  readonly reviewFormatKey: string;
  readonly snapshot: ResolvedConfigSnapshot;
  readonly assertions?: readonly GenerationAssertion[] | undefined;
  readonly contextFacts?: readonly PermittedContextFact[] | undefined;
  readonly freeText?: string | undefined;
  readonly sourceText?: string | undefined;
  readonly sourceGenerationId?: string | undefined;
  readonly sourceGeneration?:
    | {
        readonly draft: string;
        readonly claims: readonly { readonly id: string; readonly text: string }[];
      }
    | undefined;
  readonly instruction?: string | undefined;
  readonly targetLength?: number | undefined;
}

export interface GenerationResult {
  readonly generationId: string;
  readonly status: "completed" | "failed";
  readonly draft: string;
  readonly claims: readonly unknown[];
  readonly removedClaims: readonly unknown[];
  readonly groundingVerdict: GroundingResult;
  readonly costMicros: number;
  readonly sourceGenerationId?: string | undefined;
  readonly attempt: ModelGatewayAttempt;
  readonly cached: boolean;
}

export interface GenerationOrchestratorOptions {
  readonly gateway: ModelGatewayPort;
  readonly telemetry?: TelemetryPort | undefined;
}

export interface GenerationOrchestrator {
  generate(
    request: GenerationRequest,
    signal?: AbortSignal,
  ): Promise<GenerationResult>;
}

export class GroundingRejectedError extends Error {
  public constructor() {
    super("The generated candidate failed grounding.");
    this.name = "GroundingRejectedError";
  }
}

function calculateCostMicros(
  rate: PriceRate | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  if (!rate) {
    return 0;
  }
  const inputCost = Math.round((inputTokens / 1_000_000) * rate.inputPerMillionMicros);
  const outputCost = Math.round((outputTokens / 1_000_000) * rate.outputPerMillionMicros);
  return inputCost + outputCost;
}

export function createGenerationOrchestrator(
  options: GenerationOrchestratorOptions,
): GenerationOrchestrator {
  const gateway = options.gateway;
  const telemetry = options.telemetry;
  const idempotencyStore = new Map<string, GenerationResult>();

  return {
    async generate(request: GenerationRequest, signal?: AbortSignal): Promise<GenerationResult> {
      // 1. Check idempotency store
      const cached = idempotencyStore.get(request.idempotencyKey);
      if (cached) {
        return {
          ...cached,
          cached: true,
        };
      }

      const startTime = Date.now();
      const { snapshot, action, reviewFormatKey } = request;

      // 2. Resolve Review Format Manifest
      const snapshotFormat = snapshot.reviewFormats.find(
        (f) => f.key === reviewFormatKey,
      );
      const style: ReviewFormatManifest = snapshotFormat
        ? {
            key: snapshotFormat.key,
            version: snapshotFormat.version,
            displayName: snapshotFormat.displayName,
            targetPlatform: snapshotFormat.targetPlatform,
            locale: snapshotFormat.locale,
            description: snapshotFormat.description,
            sample: snapshotFormat.sample,
            constraints: snapshotFormat.constraints,
            supportedCommands: snapshotFormat.supportedCommands,
            promptFragments: {
              styleGuide: `Structure: ${snapshotFormat.displayName}`,
              fewShot: [],
            },
          }
        : getBuiltInFormat(reviewFormatKey);

      // 3. Resolve Prompt Version
      const promptVersion =
        snapshot.promptVersions.find((pv) => pv.commandKind === action) ?? {
          hash: "prompt-fallback-v1",
          key: `review.${action}`,
          commandKind: action,
          body: "Draft an authentic review adhering strictly to the evidence provided.",
          variables: ["tone", "locale"],
        };

      // 4. Compose Prompt
      const composed = composePrompt({
        snapshot,
        style,
        promptVersion,
        action,
        assertions: (request.assertions ?? []).map((a) => ({
          id: a.id,
          proposition:
            a.source.kind === "fact-option"
              ? a.source.factOptionId
              : a.source.kind === "reviewer-text"
                ? a.source.quotedText
                : a.semanticId,
        })),
        freeText: request.freeText,
        sourceText: request.sourceText,
        sourceGeneration: request.sourceGeneration,
        instruction: request.instruction,
        targetLength: request.targetLength,
      });

      // 5. Call Provider via Model Gateway Port
      const modelRun = await gateway.generate(
        {
          model: snapshot.providerRouting.primaryModel,
          messages: composed.messages,
          maxOutputTokens: 500,
          outputSchema: {
            name: "CandidateGeneration",
            schema: composed.outputSchema,
          },
        },
        signal,
      );

      // 6. Structured Output & Candidate Preparation
      const rawDraft = String(modelRun.output["draft"] ?? "");
      const rawClaims = (modelRun.output["claims"] as Array<{
        id: string;
        text: string;
        assertionIds?: string[];
      }>) ?? [];

      const groundedClaims: GroundedCandidateClaim[] = rawClaims.map((rc, idx) => {
        const claimId = rc.id || `c${idx + 1}`;
        const assertionIds = rc.assertionIds ?? (request.assertions ?? []).map((a) => a.id);
        const supportingAssertion = request.assertions?.find((a) =>
          assertionIds.includes(a.id),
        );
        return {
          id: claimId,
          semanticId: supportingAssertion?.semanticId ?? claimId,
          semanticKind: supportingAssertion?.semanticKind ?? "experience-fact",
          polarity: supportingAssertion?.polarity ?? "positive",
          text: rc.text,
          grounding: assertionIds.map((aid) => ({
            kind: "assertion" as const,
            assertionId: aid,
            assertionVersion:
              request.assertions?.find((a) => a.id === aid)?.version ?? `${aid}-v1`,
          })),
        };
      });

      const segments: CandidateSegment[] = groundedClaims.flatMap((gc, idx) => [
        { kind: "claim" as const, claimId: gc.id },
        ...(idx < groundedClaims.length - 1 ? [{ kind: "connector" as const, text: " " }] : []),
      ]);

      const candidate: Candidate = {
        claims: groundedClaims,
        segments: segments.length > 0 ? segments : [{ kind: "connector", text: rawDraft }],
      };

      // 7. Evaluate Grounding Guard
      const postcondition: GroundingPostcondition =
        action === "generate"
          ? {
              kind: "generate",
              allowedAssertionIds: (request.assertions ?? []).map((a) => a.id),
              allowedContextFactIds: (request.contextFacts ?? []).map((cf) => cf.id),
            }
          : action === "reformat"
            ? {
                kind: "reformat",
                sourceClaims: (request.sourceGeneration?.claims ?? []).map((sc) => ({
                  semanticId: sc.id,
                  grounding: (request.assertions ?? []).map((a) => ({
                    kind: "assertion" as const,
                    assertionId: a.id,
                    assertionVersion: a.version,
                  })),
                })),
              }
            : action === "condense"
              ? {
                  kind: "condense",
                  sourceClaims: (request.sourceGeneration?.claims ?? []).map((sc) => ({
                    semanticId: sc.id,
                    grounding: (request.assertions ?? []).map((a) => ({
                      kind: "assertion" as const,
                      assertionId: a.id,
                      assertionVersion: a.version,
                    })),
                  })),
                  sourceDraftCharacterLength: request.sourceGeneration?.draft.length ?? 100,
                }
              : action === "expand"
                ? {
                    kind: "expand",
                    sourceClaims: (request.sourceGeneration?.claims ?? []).map((sc) => ({
                      semanticId: sc.id,
                      grounding: (request.assertions ?? []).map((a) => ({
                        kind: "assertion" as const,
                        assertionId: a.id,
                        assertionVersion: a.version,
                      })),
                    })),
                    sourceDraftCharacterLength: request.sourceGeneration?.draft.length ?? 20,
                  }
                : action === "revise-wording"
                  ? {
                      kind: "revise-wording",
                      sourceClaims: (request.sourceGeneration?.claims ?? []).map((sc) => ({
                        semanticId: sc.id,
                        grounding: (request.assertions ?? []).map((a) => ({
                          kind: "assertion" as const,
                          assertionId: a.id,
                          assertionVersion: a.version,
                        })),
                      })),
                    }
                  : {
                      kind: "generate",
                      allowedAssertionIds: (request.assertions ?? []).map((a) => a.id),
                      allowedContextFactIds: [],
                    };

      const groundingVerdict = evaluateGrounding({
        reviewSessionId: request.reviewSessionId,
        candidate,
        assertions: request.assertions ?? [],
        permittedContextFacts: request.contextFacts ?? [],
        postcondition,
      });

      const priceRate = snapshot.priceRates.find(
        (r) =>
          r.provider === modelRun.attempt.provider &&
          r.model === modelRun.attempt.model,
      );
      const costMicros = calculateCostMicros(
        priceRate,
        modelRun.attempt.usage.inputTokens,
        modelRun.attempt.usage.outputTokens,
      );

      if (groundingVerdict.verdict === "rejected") {
        telemetry?.emit({
          service: "generation-service",
          tenantId: snapshot.tenantId,
          locationId: snapshot.locationId,
          commandKind: action,
          provider: modelRun.attempt.provider,
          model: modelRun.attempt.model,
          inputTokens: modelRun.attempt.usage.inputTokens,
          outputTokens: modelRun.attempt.usage.outputTokens,
          costMicros,
          latencyMs: Date.now() - startTime,
          outcome: "rejected",
          fallbackUsed: Boolean(modelRun.attempt.receipt.metadata?.["fallbackUsed"]),
        });
        throw new GroundingRejectedError();
      }

      // 8. Apply Policy
      const policyResult = applyPolicy({
        draft: groundingVerdict.draftBody,
        claims: candidate.claims.map((c) => ({
          id: c.id,
          semanticId: c.semanticId,
          polarity: c.polarity,
        })),
        policy: {
          requireDisclosure: snapshot.settings.requireDisclosure,
          requireVerifiedExperience: snapshot.settings.requireVerifiedExperience,
          maxReviewFormatsPerRequest: snapshot.settings.maxReviewFormatsPerRequest,
          bannedTerms: snapshot.settings.bannedTerms,
        },
        tenantName: snapshot.tenantName,
        locale: snapshot.settings.locale,
      });

      const result: GenerationResult = {
        generationId: `gen-${Date.now()}`,
        status: "completed",
        draft: policyResult.draft,
        claims: candidate.claims,
        removedClaims: [],
        groundingVerdict,
        costMicros,
        sourceGenerationId: request.sourceGenerationId,
        attempt: modelRun.attempt,
        cached: false,
      };

      // 10. Persist Idempotency and Emit Metric
      idempotencyStore.set(request.idempotencyKey, result);

      const latencyMs = Date.now() - startTime;
      if (telemetry) {
        telemetry.emit({
          service: "generation-service",
          tenantId: snapshot.tenantId,
          locationId: snapshot.locationId,
          commandKind: action,
          provider: modelRun.attempt.provider,
          model: modelRun.attempt.model,
          inputTokens: modelRun.attempt.usage.inputTokens,
          outputTokens: modelRun.attempt.usage.outputTokens,
          costMicros,
          latencyMs,
          outcome: groundingVerdict.verdict === "pass" ? "pass" : "rejected",
          fallbackUsed: Boolean(modelRun.attempt.receipt.metadata?.["fallbackUsed"]),
        });
      }

      return result;
    },
  };
}
