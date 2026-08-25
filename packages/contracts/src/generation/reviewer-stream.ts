import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";

export const GenerateReviewerCommandDtoSchema = z
  .strictObject({
    factOptionIds: z.array(IdentifierDtoSchema),
    reviewFormatId: IdentifierDtoSchema,
    customerAssertion: z.string().trim().min(1).max(5_000).optional(),
  })
  .superRefine((command, context) => {
    if (
      command.factOptionIds.length === 0 &&
      command.customerAssertion === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["factOptionIds"],
        message: "At least one non-rating Assertion is required",
      });
    }
  });

export const ParaphraseReviewerCommandDtoSchema = z.strictObject({
  sourceText: z.string().trim().min(20).max(10_000),
  reviewFormatId: IdentifierDtoSchema,
});

export const ReviewerTransformationCommandDtoSchema = z.discriminatedUnion(
  "action",
  [
    z.strictObject({
      action: z.literal("resample"),
      sourceGenerationId: IdentifierDtoSchema,
    }),
    z.strictObject({
      action: z.literal("reformat"),
      sourceGenerationId: IdentifierDtoSchema,
      reviewFormatId: IdentifierDtoSchema,
    }),
    z.strictObject({
      action: z.literal("condense"),
      sourceGenerationId: IdentifierDtoSchema,
      targetMaxChars: z.number().int().positive().max(10_000),
    }),
    z.strictObject({
      action: z.literal("expand"),
      sourceGenerationId: IdentifierDtoSchema,
      targetMinChars: z.number().int().positive().max(10_000),
    }),
    z.strictObject({
      action: z.literal("revise-wording"),
      sourceGenerationId: IdentifierDtoSchema,
      presentationInstruction: z.string().trim().min(1).max(500),
    }),
  ],
);

export const ReviewerGenerationCommandDtoSchema = z.union([
  GenerateReviewerCommandDtoSchema,
  ParaphraseReviewerCommandDtoSchema,
  ReviewerTransformationCommandDtoSchema,
]);

export const ReviewerDraftSystemAnnotationDtoSchema = z.strictObject({
  kind: z.literal("assisted-review-disclosure"),
  text: z.string().min(1),
  policyVersionId: IdentifierDtoSchema,
});

export const ReviewerDraftDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  generationId: IdentifierDtoSchema,
  revision: z.number().int().positive(),
  // Reviewer-authored body only. System-authored disclosure is never folded
  // into this editable value.
  text: z.string(),
  systemAnnotations: z.array(ReviewerDraftSystemAnnotationDtoSchema),
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

export const PrivateGenerationTerminalEventDtoSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      type: z.literal("terminal"),
      status: z.literal("completed"),
      terminalReceipt: z.string().min(1),
      draft: ReviewerDraftDtoSchema,
    }),
    z.strictObject({
      type: z.literal("terminal"),
      status: z.literal("rejected"),
      terminalReceipt: z.string().min(1),
      code: ReviewerGenerationRejectionCodeDtoSchema,
      retryable: z.boolean(),
    }),
  ],
);

export type ReviewerGenerationCommandDto = z.infer<
  typeof ReviewerGenerationCommandDtoSchema
>;
export type ReviewerTransformationCommandDto = z.infer<
  typeof ReviewerTransformationCommandDtoSchema
>;
export type ReviewerDraftDto = z.infer<typeof ReviewerDraftDtoSchema>;
export type ReviewerDraftSystemAnnotationDto = z.infer<
  typeof ReviewerDraftSystemAnnotationDtoSchema
>;
export type ReviewerGenerationRejectionCodeDto = z.infer<
  typeof ReviewerGenerationRejectionCodeDtoSchema
>;
export type ReviewerGenerationEventDto = z.infer<
  typeof ReviewerGenerationEventDtoSchema
>;
export type PrivateGenerationTerminalEventDto = z.infer<
  typeof PrivateGenerationTerminalEventDtoSchema
>;
