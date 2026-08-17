import { z } from "zod";

import { IdentifierDtoSchema, LocaleDtoSchema } from "../shared/primitives.js";
import { PublicSurveyContextDtoSchema } from "./public-survey-context.js";

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
  factOptions: PublicSurveyContextDtoSchema.shape.factOptions,
  reviewFormats: PublicSurveyContextDtoSchema.shape.reviewFormats,
});

export type ReviewSessionProjectionDto = z.infer<
  typeof ReviewSessionProjectionDtoSchema
>;
