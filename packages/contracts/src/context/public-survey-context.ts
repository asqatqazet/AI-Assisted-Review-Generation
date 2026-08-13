import { z } from "zod";

import { IdentifierDtoSchema, LocaleDtoSchema } from "../shared/primitives.js";

export const PublicSurveyContextDtoSchema = z.strictObject({
  tenantDisplayName: z.string().min(1),
  locationDisplayName: z.string().min(1),
  locale: LocaleDtoSchema,
  entryMode: z.enum(["invite", "open-qr", "both"]),
  ratingRequired: z.boolean(),
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
});

export type PublicSurveyContextDto = z.infer<typeof PublicSurveyContextDtoSchema>;

