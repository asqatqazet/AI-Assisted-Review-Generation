import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";
import { PublicSurveyContextDtoSchema } from "./public-survey-context.js";

export const EntryChallengeProjectionDtoSchema = z.strictObject({
  status: z.literal("ready"),
  entryChallengeHandle: IdentifierDtoSchema,
  csrfToken: z.string().min(32),
  context: PublicSurveyContextDtoSchema,
});

export type EntryChallengeProjectionDto = z.infer<
  typeof EntryChallengeProjectionDtoSchema
>;
