import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";

export const ReviewerDraftRevisionCommandDtoSchema = z.strictObject({
  draftId: IdentifierDtoSchema,
  generationId: IdentifierDtoSchema,
  expectedRevision: z.number().int().positive(),
  text: z
    .string()
    .min(1)
    .max(10_000)
    .refine((value) => value.trim().length > 0, "Draft text must not be blank"),
});

export const ReviewerDraftRevisionScopeDtoSchema = z.strictObject({
  tenantId: IdentifierDtoSchema,
  locationId: IdentifierDtoSchema,
  reviewSessionId: IdentifierDtoSchema,
  draftId: IdentifierDtoSchema,
  generationId: IdentifierDtoSchema,
  expectedRevision: z.number().int().positive(),
  textHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  idempotencyKey: z.string().min(1).max(200),
});

export const RecordReviewerDraftRevisionInvocationDtoSchema = z.strictObject({
  operation: z.literal("record-reviewer-draft-revision"),
  permit: z.string().min(1),
  scope: ReviewerDraftRevisionScopeDtoSchema,
  text: ReviewerDraftRevisionCommandDtoSchema.shape.text,
});

export const ReviewerDraftRevisionResultDtoSchema = z.strictObject({
  status: z.enum(["recorded", "conflict"]),
  revision: z.number().int().positive(),
});

export const RecordReviewerDraftRevisionResultDtoSchema =
  ReviewerDraftRevisionResultDtoSchema.extend({
    operation: z.literal("record-reviewer-draft-revision"),
  });

export type ReviewerDraftRevisionScopeDto = z.infer<
  typeof ReviewerDraftRevisionScopeDtoSchema
>;
export type RecordReviewerDraftRevisionInvocationDto = z.infer<
  typeof RecordReviewerDraftRevisionInvocationDtoSchema
>;
export type RecordReviewerDraftRevisionResultDto = z.infer<
  typeof RecordReviewerDraftRevisionResultDtoSchema
>;
export type ReviewerDraftRevisionResultDto = z.infer<
  typeof ReviewerDraftRevisionResultDtoSchema
>;
