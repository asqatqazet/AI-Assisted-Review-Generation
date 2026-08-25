import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";
import { PublicSurveyContextDtoSchema } from "./public-survey-context.js";

export const EntryChallengeProjectionDtoSchema = z.strictObject({
  status: z.literal("ready"),
  entryChallengeHandle: IdentifierDtoSchema,
  csrfToken: z.string().min(32),
  stage: z
    .enum(["entry", "verification-required", "verification-unavailable"])
    .optional(),
  provisionalSelection: z
    .strictObject({
      rating: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
      ]),
      action: z.enum(["generate", "paraphrase"]),
    })
    .nullable()
    .optional(),
  context: PublicSurveyContextDtoSchema,
});

export type EntryChallengeProjectionDto = z.infer<
  typeof EntryChallengeProjectionDtoSchema
>;
