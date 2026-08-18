import { z } from "zod";

import { IdentifierDtoSchema, LocaleDtoSchema } from "../shared/primitives.js";

export const PublicSurveyContextDtoSchema = z.strictObject({
  tenantDisplayName: z.string().min(1),
  locationDisplayName: z.string().min(1),
  locale: LocaleDtoSchema,
  entryMode: z.enum(["invite", "open-qr", "both"]),
  ratingRequired: z.boolean(),
  requirements: z.strictObject({
    minimumFactSelections: z.number().int().min(1).max(20),
    maximumReviewFormatsPerGeneration: z.number().int().min(1).max(8),
    maximumCustomerAssertionChars: z.number().int().min(1).max(5_000),
  }),
  factOptions: z.array(
    z.strictObject({
      id: IdentifierDtoSchema,
      label: z.string().min(1),
      categoryLabel: z.string().min(1),
      polarity: z.enum(["positive", "neutral", "negative"]),
    }),
  ),
  reviewFormats: z.array(
    z.strictObject({
      id: IdentifierDtoSchema,
      displayName: z.string().min(1),
      description: z.string().min(1),
      sample: z.string().min(1),
      targetPlatform: z.string().min(1),
      constraints: z.strictObject({
        minChars: z.number().int().nonnegative(),
        maxChars: z.number().int().positive(),
      }).refine((constraints) => constraints.minChars <= constraints.maxChars, {
        message: "minChars must not exceed maxChars",
      }),
      availableCommands: z.array(
        z.enum([
          "generate",
          "paraphrase",
          "reformat",
          "condense",
          "expand",
          "revise-wording",
        ]),
      ),
    }),
  ),
  destinations: z.array(
    z.strictObject({
      targetPlatform: z.string().min(1),
      displayName: z.string().min(1),
      targetUrl: z.string().url(),
    }),
  ),
});

export type PublicSurveyContextDto = z.infer<typeof PublicSurveyContextDtoSchema>;
