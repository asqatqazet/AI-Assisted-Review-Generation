import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";

export const ReviewerDispositionCommandDtoSchema = z.strictObject({
  draftId: IdentifierDtoSchema,
  generationId: IdentifierDtoSchema,
  finalText: z
    .string()
    .min(1)
    .max(10_000)
    .refine((value) => value.trim().length > 0, "Final text must not be blank"),
});

export const ReviewerDispositionScopeDtoSchema = z.strictObject({
  tenantId: IdentifierDtoSchema,
  locationId: IdentifierDtoSchema,
  reviewSessionId: IdentifierDtoSchema,
  draftId: IdentifierDtoSchema,
  generationId: IdentifierDtoSchema,
  finalTextHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  idempotencyKey: z.string().min(1).max(200),
});

export const RecordReviewerDispositionInvocationDtoSchema = z.strictObject({
  operation: z.literal("record-reviewer-disposition"),
  permit: z.string().min(1),
  scope: ReviewerDispositionScopeDtoSchema,
  finalText: ReviewerDispositionCommandDtoSchema.shape.finalText,
});

export const ReviewerDispositionResultDtoSchema = z.strictObject({
  status: z.literal("recorded"),
  kind: z.enum(["accepted", "edited"]),
  revision: z.number().int().positive(),
  normalizedEditDistance: z.number().min(0).max(1),
});

export const RecordReviewerDispositionResultDtoSchema =
  ReviewerDispositionResultDtoSchema.extend({
    operation: z.literal("record-reviewer-disposition"),
  });

export type ReviewerDispositionCommandDto = z.infer<
  typeof ReviewerDispositionCommandDtoSchema
>;
export type ReviewerDispositionScopeDto = z.infer<
  typeof ReviewerDispositionScopeDtoSchema
>;
export type RecordReviewerDispositionInvocationDto = z.infer<
  typeof RecordReviewerDispositionInvocationDtoSchema
>;
export type RecordReviewerDispositionResultDto = z.infer<
  typeof RecordReviewerDispositionResultDtoSchema
>;
export type ReviewerDispositionResultDto = z.infer<
  typeof ReviewerDispositionResultDtoSchema
>;
