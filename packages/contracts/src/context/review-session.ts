import { z } from "zod";

import { ReviewerDraftDtoSchema } from "../generation/reviewer-stream.js";
import { IdentifierDtoSchema, LocaleDtoSchema } from "../shared/primitives.js";
import { PublicSurveyContextDtoSchema } from "./public-survey-context.js";

const ReviewSessionProgressFields = {
    phase: z.enum([
      "facts",
      "paraphrase-input",
      "format",
      "results",
      "editing",
      "done",
    ]),
    selectedFactOptionIds: z.array(IdentifierDtoSchema).max(100),
    customerAssertion: z.string().max(5_000),
    sourceText: z.string().max(10_000),
    selectedReviewFormatId: IdentifierDtoSchema.nullable(),
};

const rejectDuplicateSelections = (
  progress: { readonly selectedFactOptionIds: readonly string[] },
  context: z.RefinementCtx,
): void => {
  if (
    new Set(progress.selectedFactOptionIds).size !==
    progress.selectedFactOptionIds.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["selectedFactOptionIds"],
      message: "Fact Option selections must be unique",
    });
  }
};

export const ReviewSessionProgressInputDtoSchema = z
  .strictObject(ReviewSessionProgressFields)
  .superRefine(rejectDuplicateSelections);

export const ReviewSessionProgressDtoSchema = z
  .strictObject({
    epoch: z.number().int().positive(),
    ...ReviewSessionProgressFields,
  })
  .superRefine((progress, context) => {
    rejectDuplicateSelections(progress, context);
  });

export const ReviewSessionProjectionDtoSchema = z.strictObject({
  status: z.literal("ready"),
  reviewSessionHandle: IdentifierDtoSchema,
  tenantDisplayName: z.string().min(1),
  locationDisplayName: z.string().min(1),
  locale: LocaleDtoSchema,
  rating: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  action: z.enum(["generate", "paraphrase"]),
  requirements: PublicSurveyContextDtoSchema.shape.requirements,
  factOptions: PublicSurveyContextDtoSchema.shape.factOptions,
  reviewFormats: PublicSurveyContextDtoSchema.shape.reviewFormats,
  destinations: PublicSurveyContextDtoSchema.shape.destinations,
  progress: ReviewSessionProgressDtoSchema.optional(),
  drafts: z.array(ReviewerDraftDtoSchema).max(20).optional(),
});

export type ReviewSessionProjectionDto = z.infer<
  typeof ReviewSessionProjectionDtoSchema
>;
export type ReviewSessionProgressDto = z.infer<
  typeof ReviewSessionProgressDtoSchema
>;
