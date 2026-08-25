import { z } from "zod";

import { IdentifierDtoSchema, IsoDateTimeDtoSchema } from "../shared/primitives.js";
import { ModelCandidateDtoSchema, UnsupportedOutputDtoSchema } from "./candidate.js";

export const ProviderAttemptDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  provider: IdentifierDtoSchema,
  model: IdentifierDtoSchema,
  status: z.enum([
    "reserved",
    "provider-started",
    "completed",
    "failed-before-provider",
    "cost-unknown-after-provider",
    "cancelled",
  ]),
  startedAt: IsoDateTimeDtoSchema,
  finishedAt: IsoDateTimeDtoSchema.nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  priceRateId: IdentifierDtoSchema,
  costMicros: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3),
});

export const GroundingVerdictDtoSchema = z.enum(["pass", "rejected"]);

export const GenerationRecordDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  tenantId: IdentifierDtoSchema,
  locationId: IdentifierDtoSchema,
  reviewSessionId: IdentifierDtoSchema,
  commandKind: z.enum([
    "generate",
    "paraphrase",
    "reformat",
    "condense",
    "expand",
    "revise-wording",
    "resample",
  ]),
  sourceGenerationId: IdentifierDtoSchema.nullable(),
  snapshotId: IdentifierDtoSchema,
  promptVersionHash: IdentifierDtoSchema,
  reviewFormatVersionId: IdentifierDtoSchema,
  normalizedInput: z.record(z.string(), z.unknown()),
  candidate: ModelCandidateDtoSchema,
  groundingVerdict: GroundingVerdictDtoSchema,
  attempts: z.array(ProviderAttemptDtoSchema).min(1),
  totalCostMicros: z.number().int().nonnegative(),
  currency: z.string().length(3),
  createdAt: IsoDateTimeDtoSchema,
});

export const DraftDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  generationId: IdentifierDtoSchema,
  revision: z.number().int().positive(),
  text: z.string(),
  systemAnnotations: z.array(
    z.strictObject({
      kind: z.literal("assisted-review-disclosure"),
      text: z.string().min(1),
      policyVersionId: IdentifierDtoSchema,
    }),
  ),
});

export const DispositionDtoSchema = z.strictObject({
  generationId: IdentifierDtoSchema,
  status: z.enum(["accepted", "edited", "discarded"]),
  submittedDraftRevisionId: IdentifierDtoSchema.nullable(),
  editDistance: z.number().min(0).max(1).nullable(),
  recordedAt: IsoDateTimeDtoSchema,
});

export const GenerationTerminalEventDtoSchema = z.discriminatedUnion("status", [
  z.strictObject({
    type: z.literal("terminal"),
    status: z.literal("completed"),
    generation: GenerationRecordDtoSchema,
    draft: DraftDtoSchema,
  }),
  z.strictObject({
    type: z.literal("terminal"),
    status: z.literal("rejected"),
    generationId: IdentifierDtoSchema,
    reason: z.enum(["grounding", "policy", "format-unsatisfiable"]),
    correctiveGuidance: z.string().min(1),
  }),
]);

export const GenerationEventDtoSchema = z.union([
  z.strictObject({
    type: z.literal("progress"),
    phase: z.enum(["queued", "generating", "validating", "persisting"]),
  }),
  GenerationTerminalEventDtoSchema,
]);

export const GenerateResultDtoSchema = GenerationTerminalEventDtoSchema;

export const AuditUnsupportedOutputDtoSchema = UnsupportedOutputDtoSchema;

export type GenerationRecordDto = z.infer<typeof GenerationRecordDtoSchema>;
export type GenerationEventDto = z.infer<typeof GenerationEventDtoSchema>;
export type DispositionDto = z.infer<typeof DispositionDtoSchema>;
export type GenerateResultDto = z.infer<typeof GenerateResultDtoSchema>;
