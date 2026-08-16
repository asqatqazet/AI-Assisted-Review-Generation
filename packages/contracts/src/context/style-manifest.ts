import { z } from "zod";

import {
  IdentifierDtoSchema,
  LocaleDtoSchema,
  ReviewFormatLocaleDtoSchema,
} from "../shared/primitives.js";
import { ReviewFormatConstraintsDtoSchema } from "../shared/effective-configuration-snapshot.js";

export const FewShotExampleDtoSchema = z.strictObject({
  input: z.string().min(1),
  output: z.string().min(1),
  claims: z.array(z.string().min(1)).optional(),
});

export const PromptFragmentsDtoSchema = z.strictObject({
  styleGuide: z.string().min(1),
  fewShot: z.array(FewShotExampleDtoSchema),
});

export const CommandKindSchema = z.enum([
  "generate",
  "paraphrase",
  "reformat",
  "condense",
  "expand",
  "revise-wording",
]);

export const StyleManifestDtoSchema = z.strictObject({
  key: IdentifierDtoSchema,
  version: IdentifierDtoSchema,
  displayName: z.string().min(1),
  targetPlatform: IdentifierDtoSchema,
  locale: ReviewFormatLocaleDtoSchema,
  description: z.partialRecord(LocaleDtoSchema, z.string().min(1)),
  sample: z.partialRecord(LocaleDtoSchema, z.string().min(1)),
  constraints: ReviewFormatConstraintsDtoSchema,
  supportedCommands: z.array(CommandKindSchema).min(1),
  promptFragments: PromptFragmentsDtoSchema,
});

export type StyleManifestDto = z.infer<typeof StyleManifestDtoSchema>;
export type FewShotExampleDto = z.infer<typeof FewShotExampleDtoSchema>;
export type PromptFragmentsDto = z.infer<typeof PromptFragmentsDtoSchema>;
