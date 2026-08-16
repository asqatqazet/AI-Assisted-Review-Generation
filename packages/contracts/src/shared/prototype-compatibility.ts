import { z } from "zod";

import { ReviewFormatConstraintsDtoSchema } from "./effective-configuration-snapshot.js";
import { LocaleDtoSchema, ReviewFormatLocaleDtoSchema } from "./primitives.js";

export const PrototypeGenerationActionDtoSchema = z.enum([
  "generate",
  "paraphrase",
  "regenerate",
  "restyle",
  "condense",
  "expand",
  "refine",
]);

export const PrototypeEffectivePolicyDtoSchema = z.strictObject({
  requireDisclosure: z.boolean(),
  requireVerifiedExperience: z.boolean(),
  maxDraftsPerSession: z.number().int().positive(),
  bannedTerms: z.array(z.string()),
});

export const PrototypeKeywordCategoryDtoSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
});

export const PrototypeKeywordDtoSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.string().min(1),
  polarity: z.enum(["positive", "neutral", "negative"]),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});

export const PrototypeStyleManifestDtoSchema = z.strictObject({
  key: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1),
  targetPlatform: z.string().min(1),
  locale: ReviewFormatLocaleDtoSchema,
  description: z.partialRecord(LocaleDtoSchema, z.string().min(1)),
  constraints: ReviewFormatConstraintsDtoSchema,
  supportedActions: z.array(PrototypeGenerationActionDtoSchema),
  sample: z.partialRecord(LocaleDtoSchema, z.string().min(1)),
});

export const PrototypeTenantDtoSchema = z.strictObject({
  slug: z.string().min(1),
  locale: LocaleDtoSchema,
  plan: z.string().min(1),
  status: z.enum(["active", "inactive"]),
  createdAt: z.iso.date(),
  business: z.strictObject({
    name: z.string().min(1),
    category: z.string().min(1),
    description: z.string(),
    toneGuidelines: z.string(),
  }),
  entryMode: z.enum(["invite", "open-qr", "both"]),
  policy: PrototypeEffectivePolicyDtoSchema,
  keywordCategories: z.array(PrototypeKeywordCategoryDtoSchema),
  enabledStyles: z.array(z.string().min(1)),
  enabledActions: z.array(PrototypeGenerationActionDtoSchema),
  contextVersion: z.number().int().nonnegative(),
  monthlyBudgetMicros: z.number().int().nonnegative(),
  monthToDateCostMicros: z.number().int().nonnegative(),
  alertThresholdPct: z.number().min(0).max(100),
});

export const PrototypeLocationDtoSchema = z.strictObject({
  slug: z.string().min(1),
  tenantSlug: z.string().min(1),
  name: z.string().min(1),
  address: z.string(),
  active: z.boolean(),
  entryMode: z.enum(["invite", "open-qr", "both"]).nullable(),
  destinations: z.array(z.string().min(1)),
  platformIds: z.record(z.string(), z.string()),
  overrides: z.record(z.string(), z.unknown()),
  keywordAdditions: z.array(PrototypeKeywordDtoSchema),
  counters: z.strictObject({
    issued: z.number().int().nonnegative(),
    opened: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  }),
});

export const PrototypeProviderDtoSchema = z.strictObject({
  id: z.string().min(1),
  displayName: z.string().min(1),
  role: z.string().min(1),
  credential: z.string(),
  health: z.string().min(1),
  p95Ms: z.number().nonnegative(),
  models: z.array(
    z.strictObject({
      id: z.string().min(1),
      streaming: z.boolean(),
      structuredOutput: z.boolean(),
      maxTokens: z.number().int().nonnegative(),
    }),
  ),
});

export const PrototypePlatformSettingsDtoSchema = z.strictObject({
  providers: z.array(PrototypeProviderDtoSchema),
  priceTable: z.array(
    z.strictObject({
      provider: z.string().min(1),
      model: z.string().min(1),
      inputPerMTokMicros: z.number().int().nonnegative(),
      outputPerMTokMicros: z.number().int().nonnegative(),
      effectiveFrom: z.iso.date(),
    }),
  ),
  routing: z.strictObject({
    defaultProvider: z.string().min(1),
    fallbackProvider: z.string().min(1),
  }),
  defaultPolicyTemplate: PrototypeEffectivePolicyDtoSchema,
  rateLimits: z.strictObject({
    draftsPerSessionPerHour: z.number().int().positive(),
    requestsPerTenantPerMinute: z.number().int().positive(),
  }),
  featureFlags: z.array(
    z.strictObject({ key: z.string().min(1), on: z.boolean(), note: z.string() }),
  ),
  logRetentionDays: z.number().int().positive(),
});

export const PrototypeActionCatalogEntryDtoSchema = z.strictObject({
  key: PrototypeGenerationActionDtoSchema,
  label: z.string().min(1),
  intent: z.string().min(1),
  input: z.string().min(1),
  groundingRule: z.string().min(1),
  costWeight: z.string().min(1),
  needsDraft: z.boolean(),
  needsSourceText: z.boolean(),
  verb: z.string().min(1),
});

export const PrototypePromptVersionDtoSchema = z.strictObject({
  hash: z.string().min(1),
  key: z.string().min(1),
  action: PrototypeGenerationActionDtoSchema,
  createdAt: z.iso.date(),
  status: z.enum(["draft", "candidate", "in-experiment", "retired"]),
  evalScore: z.number().min(0).max(1).nullable(),
  body: z.string().min(1),
});

export const PrototypeExperimentDtoSchema = z.strictObject({
  key: z.string().min(1),
  action: PrototypeGenerationActionDtoSchema,
  status: z.enum(["draft", "running", "stopped"]),
  startedAt: z.iso.date(),
  variants: z.array(
    z.strictObject({
      key: z.string().min(1),
      promptVersionHash: z.string().min(1),
      weight: z.number().min(0).max(100),
      n: z.number().int().nonnegative(),
      acceptanceRate: z.number().min(0).max(1),
    }),
  ),
});

export const PrototypeAnalyticsRowDtoSchema = z.strictObject({
  locationSlug: z.string().min(1),
  styleKey: z.string().min(1),
  action: PrototypeGenerationActionDtoSchema,
  variantKey: z.string().min(1),
  n: z.number().int().nonnegative(),
  acceptanceRate: z.number().min(0).max(1),
  avgEditDistance: z.number().min(0).max(1),
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  totalCostMicros: z.number().int().nonnegative(),
  costPerAcceptedMicros: z.number().int().nonnegative(),
});

export const PrototypeClaimDtoSchema = z.strictObject({
  text: z.string().min(1),
  sourceKeywordId: z.string().min(1).nullable(),
  sourceSpan: z.string().min(1).nullable(),
});

export const PrototypeRemovedClaimDtoSchema = z.strictObject({
  text: z.string().min(1),
  reason: z.string().min(1),
});

export const PrototypeGenerationOutcomeDtoSchema = z.strictObject({
  status: z.enum(["accepted", "edited", "discarded"]),
  editDistance: z.number().min(0).max(1).nullable(),
});

export const PrototypeGenerationRecordDtoSchema = z.strictObject({
  id: z.string().min(1),
  tenantSlug: z.string().min(1),
  locationSlug: z.string().min(1),
  action: PrototypeGenerationActionDtoSchema,
  createdAt: z.iso.datetime({ offset: true }),
  draft: z.string().nullable(),
  claims: z.array(PrototypeClaimDtoSchema),
  removedClaims: z.array(PrototypeRemovedClaimDtoSchema),
  groundingVerdict: z.enum(["clean", "stripped", "rejected"]),
  provider: z.string().min(1),
  model: z.string().min(1),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costMicros: z.number().int().nonnegative(),
  fallbackUsed: z.boolean(),
  promptVersionHash: z.string().min(1),
  contextVersion: z.number().int().nonnegative(),
  styleKey: z.string().min(1),
  styleVersion: z.string().min(1),
  sourceGenerationId: z.string().min(1).nullable(),
  assertedKeywordIds: z.array(z.string().min(1)),
  freeText: z.string(),
  sourceText: z.string().nullable(),
  outcome: PrototypeGenerationOutcomeDtoSchema,
});

export type PrototypeTenantDto = z.infer<typeof PrototypeTenantDtoSchema>;
export type PrototypeLocationDto = z.infer<typeof PrototypeLocationDtoSchema>;
export type PrototypeGenerationRecordDto = z.infer<
  typeof PrototypeGenerationRecordDtoSchema
>;
