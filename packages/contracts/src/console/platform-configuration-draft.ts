import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";
import { ConfigurationEtagDtoSchema } from "./primitives.js";

const PlatformRateLimitsDtoSchema = z.strictObject({
  perReviewSessionPerHour: z.number().finite().int().min(0),
  perTenantPerMinute: z.number().finite().int().min(0),
  maxConcurrentGenerations: z.number().finite().int().min(0),
});

/**
 * Snapshot-affecting mutations owned by Platform scope. This is deliberately
 * separate from ConsoleConfigurationDraftChangeDtoSchema: a Tenant Draft can
 * never acquire authority over Platform policy, routing, or pricing.
 */
export const ConsolePlatformConfigurationDraftChangeDtoSchema =
  z.discriminatedUnion("operation", [
    z.strictObject({
      operation: z.literal("save-platform-settings"),
      defaultPolicyTemplate: z.string().max(50_000),
      globalRateLimits: PlatformRateLimitsDtoSchema,
      logRetentionDays: z.number().finite().int().min(1).max(3650),
      featureFlags: z
        .array(
          z.strictObject({
            key: IdentifierDtoSchema,
            enabled: z.boolean(),
          }),
        )
        .max(200),
    }),
    z.strictObject({
      operation: z.literal("set-provider-routing"),
      providerKey: IdentifierDtoSchema,
      modelKey: IdentifierDtoSchema,
      routingPriority: z.number().finite().int().min(0).nullable(),
      fallbackPriority: z.number().finite().int().min(0).nullable(),
    }),
    z.strictObject({
      operation: z.literal("publish-price-rate"),
      providerKey: IdentifierDtoSchema,
      modelKey: IdentifierDtoSchema,
      inputMicrosPerMillion: z.number().finite().int().min(0),
      outputMicrosPerMillion: z.number().finite().int().min(0),
      currency: z.string().regex(/^[A-Z]{3}$/u),
      validFrom: z.iso.datetime({ offset: true }),
    }),
  ]);

export const ConsolePlatformConfigurationStateDtoSchema = z.strictObject({
  etag: ConfigurationEtagDtoSchema,
  draft: z
    .strictObject({
      baseEtag: ConfigurationEtagDtoSchema,
      changes: z
        .array(ConsolePlatformConfigurationDraftChangeDtoSchema)
        .max(1000),
    })
    .nullable(),
});

export type ConsolePlatformConfigurationDraftChangeDto = z.infer<
  typeof ConsolePlatformConfigurationDraftChangeDtoSchema
>;
export type ConsolePlatformConfigurationStateDto = z.infer<
  typeof ConsolePlatformConfigurationStateDtoSchema
>;
