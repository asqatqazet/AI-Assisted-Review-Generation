import { z } from "zod";

import {
  IdentifierDtoSchema,
  IsoDateTimeDtoSchema,
  LocaleDtoSchema,
  ReviewFormatLocaleDtoSchema,
} from "../shared/primitives.js";
import { ConsoleActionKeyDtoSchema } from "./overview.js";
import { MoneyDtoSchema } from "./primitives.js";
import { ConsolePlatformConfigurationStateDtoSchema } from "./platform-configuration-draft.js";

export const PlatformTenantRowDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  slug: IdentifierDtoSchema,
  name: z.string().min(1).max(200),
  locale: LocaleDtoSchema,
  category: z.string().max(120),
  locationCount: z.number().int().min(0),
  plan: z.string().max(80),
  monthToDateSpend: MoneyDtoSchema,
  monthlyBudget: MoneyDtoSchema,
  status: z.enum(["active", "suspended", "deactivated"]),
  /** Suspending stops reviewer entry; the account's history is retained. */
  suspendable: z.boolean(),
});

export const PlatformTenantsDtoSchema = z.strictObject({
  scope: z.literal("platform"),
  tenants: z.array(PlatformTenantRowDtoSchema).max(1000),
});

export const PlatformProviderModelDtoSchema = z.strictObject({
  providerKey: IdentifierDtoSchema,
  providerName: z.string().min(1).max(120),
  modelKey: IdentifierDtoSchema,
  modelName: z.string().min(1).max(120),
  health: z.enum(["healthy", "degraded", "unavailable"]),
  /** Configured-or-missing only. A secret never crosses this seam. */
  credentialState: z.enum(["configured", "missing"]),
  supportsStreaming: z.boolean(),
  supportsStructuredOutput: z.boolean(),
  maxTokens: z.number().int().min(1),
  routingPriority: z.number().int().min(0).nullable(),
  fallbackPriority: z.number().int().min(0).nullable(),
});

export const PlatformPriceVersionDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  providerKey: IdentifierDtoSchema,
  modelKey: IdentifierDtoSchema,
  inputPerMillion: MoneyDtoSchema,
  outputPerMillion: MoneyDtoSchema,
  validFrom: IsoDateTimeDtoSchema,
  validTo: IsoDateTimeDtoSchema.nullable(),
  /** Superseded rows are retained so historical re-costing stays exact. */
  superseded: z.boolean(),
});

export const PlatformProvidersDtoSchema = z.strictObject({
  scope: z.literal("platform"),
  configuration: ConsolePlatformConfigurationStateDtoSchema,
  models: z.array(PlatformProviderModelDtoSchema).max(200),
  priceVersions: z.array(PlatformPriceVersionDtoSchema).max(1000),
});

export const PlatformStyleDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  key: IdentifierDtoSchema,
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(40),
  locale: ReviewFormatLocaleDtoSchema,
  targetPlatform: IdentifierDtoSchema,
  maxChars: z.number().int().min(1),
  supportedActions: z.array(ConsoleActionKeyDtoSchema).max(20),
  validationStatus: z.enum(["valid", "invalid", "unvalidated"]),
  status: z.enum(["active", "retired"]),
});

export const PlatformStylesDtoSchema = z.strictObject({
  scope: z.literal("platform"),
  styles: z.array(PlatformStyleDtoSchema).max(500),
});

export const PlatformSettingsDtoSchema = z.strictObject({
  scope: z.literal("platform"),
  configuration: ConsolePlatformConfigurationStateDtoSchema,
  defaultPolicyTemplate: z.string().max(50_000),
  globalRateLimits: z.strictObject({
    perReviewSessionPerHour: z.number().int().min(0),
    perTenantPerMinute: z.number().int().min(0),
    maxConcurrentGenerations: z.number().int().min(0),
  }),
  logRetentionDays: z.number().int().min(1).max(3650),
  featureFlags: z
    .array(
      z.strictObject({
        key: IdentifierDtoSchema,
        description: z.string().max(400),
        enabled: z.boolean(),
      }),
    )
    .max(200),
});

export type PlatformTenantsDto = z.infer<typeof PlatformTenantsDtoSchema>;
export type PlatformProvidersDto = z.infer<typeof PlatformProvidersDtoSchema>;
export type PlatformStylesDto = z.infer<typeof PlatformStylesDtoSchema>;
export type PlatformSettingsDto = z.infer<typeof PlatformSettingsDtoSchema>;
export type PlatformPriceVersionDto = z.infer<
  typeof PlatformPriceVersionDtoSchema
>;
