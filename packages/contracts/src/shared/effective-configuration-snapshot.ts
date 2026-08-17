import { z } from "zod";

import {
  ConfigurationScopeDtoSchema,
  IdentifierDtoSchema,
  IsoDateTimeDtoSchema,
  LocaleDtoSchema,
  ReviewFormatLocaleDtoSchema,
} from "./primitives.js";

export const ConfigurationProvenanceDtoSchema = z.strictObject({
  scope: ConfigurationScopeDtoSchema,
  sourceId: IdentifierDtoSchema,
  revision: IdentifierDtoSchema,
});

export const EffectiveSettingsDtoSchema = z.strictObject({
  locale: LocaleDtoSchema,
  toneGuidelines: z.string().min(1),
  entryMode: z.enum(["invite", "open-qr", "both"]),
  requireDisclosure: z.boolean(),
  requireVerifiedExperience: z.boolean(),
  maxReviewFormatsPerRequest: z.number().int().positive(),
  bannedTerms: z.array(z.string().min(1)),
  enabledReviewFormatVersionIds: z.array(IdentifierDtoSchema),
  enabledCommands: z.array(
    z.enum([
      "generate",
      "paraphrase",
      "reformat",
      "condense",
      "expand",
      "revise-wording",
    ]),
  ),
  monthlyBudgetMicros: z.number().int().nonnegative(),
  alertThresholdPct: z.number().min(0).max(100),
});

export const FactOptionOwnerDtoSchema = z.discriminatedUnion("scope", [
  z.strictObject({
    scope: z.literal("tenant"),
    tenantId: IdentifierDtoSchema,
  }),
  z.strictObject({
    scope: z.literal("location"),
    tenantId: IdentifierDtoSchema,
    locationId: IdentifierDtoSchema,
  }),
]);

export const FactOptionVersionDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  version: IdentifierDtoSchema,
  owner: FactOptionOwnerDtoSchema,
  proposition: z.string().min(1),
  categoryId: IdentifierDtoSchema,
  polarity: z.enum(["positive", "neutral", "negative"]),
  locale: LocaleDtoSchema,
  active: z.boolean(),
  sortOrder: z.number().int(),
});

export const ReviewFormatConstraintsDtoSchema = z
  .strictObject({
    minChars: z.number().int().nonnegative(),
    maxChars: z.number().int().positive(),
    paragraphs: z.number().int().positive(),
    emojiPolicy: z.enum(["none", "allowed"]),
    secondPerson: z.boolean(),
  })
  .refine((constraints) => constraints.minChars <= constraints.maxChars, {
    error: "minChars must not exceed maxChars",
    path: ["minChars"],
  });

export const ReviewFormatVersionDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  key: IdentifierDtoSchema,
  version: IdentifierDtoSchema,
  displayName: z.string().min(1),
  targetPlatform: IdentifierDtoSchema,
  locale: ReviewFormatLocaleDtoSchema,
  description: z.partialRecord(LocaleDtoSchema, z.string().min(1)),
  sample: z.partialRecord(LocaleDtoSchema, z.string().min(1)),
  constraints: ReviewFormatConstraintsDtoSchema,
  supportedCommands: z.array(
    z.enum([
      "generate",
      "paraphrase",
      "reformat",
      "condense",
      "expand",
      "revise-wording",
    ]),
  ),
});

export const PromptVersionDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  hash: IdentifierDtoSchema,
  key: IdentifierDtoSchema,
  commandKind: z.enum([
    "generate",
    "paraphrase",
    "reformat",
    "condense",
    "expand",
    "revise-wording",
  ]),
  body: z.string().min(1),
  variables: z.array(z.string().min(1)),
});

export const PriceRateDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  providerModelId: IdentifierDtoSchema,
  provider: IdentifierDtoSchema,
  model: IdentifierDtoSchema,
  inputPerMillionMicros: z.number().int().nonnegative(),
  outputPerMillionMicros: z.number().int().nonnegative(),
  currency: z.string().length(3),
  unit: z.literal("token"),
  effectiveFrom: IsoDateTimeDtoSchema,
  effectiveTo: IsoDateTimeDtoSchema.nullable(),
});

export const ProviderRoutingDtoSchema = z.strictObject({
  version: IdentifierDtoSchema,
  providerModelId: IdentifierDtoSchema,
  primaryProvider: IdentifierDtoSchema,
  primaryModel: IdentifierDtoSchema,
});

export const EffectiveConfigurationSnapshotDtoSchema = z.strictObject({
  snapshotId: IdentifierDtoSchema,
  schemaVersion: z.literal(2),
  tenantId: IdentifierDtoSchema,
  locationId: IdentifierDtoSchema,
  tenantName: z.string().min(1),
  locationName: z.string().min(1),
  settings: EffectiveSettingsDtoSchema,
  provenance: z.record(z.string().min(1), ConfigurationProvenanceDtoSchema),
  factOptions: z.array(FactOptionVersionDtoSchema),
  reviewFormats: z.array(ReviewFormatVersionDtoSchema),
  promptVersions: z.array(PromptVersionDtoSchema),
  priceRates: z.array(PriceRateDtoSchema),
  providerRouting: ProviderRoutingDtoSchema,
});

export type EffectiveConfigurationSnapshotDto = z.infer<
  typeof EffectiveConfigurationSnapshotDtoSchema
>;
