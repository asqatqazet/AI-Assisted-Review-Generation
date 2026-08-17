import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";

export const ReviewerGenerationCommandDtoSchema = z.strictObject({
  factOptionIds: z.array(IdentifierDtoSchema).min(1),
  reviewFormatId: IdentifierDtoSchema,
});

export const ReviewerDraftDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  generationId: IdentifierDtoSchema,
  revision: z.number().int().positive(),
  text: z.string(),
});

export const ReviewerGenerationRejectionCodeDtoSchema = z.enum([
  "GROUNDING_REJECTED",
  "POLICY_REJECTED",
  "FORMAT_REJECTED",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "CANCELLED",
  "GENERATION_FAILED",
]);

export const ReviewerGenerationEventDtoSchema = z.union([
  z.strictObject({
    type: z.literal("accepted"),
  }),
  z.strictObject({
    type: z.literal("progress"),
    phase: z.enum(["queued", "generating", "validating", "persisting"]),
    elapsedSeconds: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("heartbeat"),
    elapsedSeconds: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("terminal"),
    status: z.literal("completed"),
    draft: ReviewerDraftDtoSchema,
  }),
  z.strictObject({
    type: z.literal("terminal"),
    status: z.literal("rejected"),
    code: ReviewerGenerationRejectionCodeDtoSchema,
    retryable: z.boolean(),
  }),
]);

export type ReviewerGenerationCommandDto = z.infer<
  typeof ReviewerGenerationCommandDtoSchema
>;
export type ReviewerDraftDto = z.infer<typeof ReviewerDraftDtoSchema>;
export type ReviewerGenerationRejectionCodeDto = z.infer<
  typeof ReviewerGenerationRejectionCodeDtoSchema
>;
export type ReviewerGenerationEventDto = z.infer<
  typeof ReviewerGenerationEventDtoSchema
>;
