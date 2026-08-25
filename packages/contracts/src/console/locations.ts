import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";
import {
  ConfigurationEtagDtoSchema,
  ConsoleScopeDtoSchema,
} from "./primitives.js";
import { ConsoleConfigurationDraftChangeDtoSchema } from "./configuration-draft.js";

export const ConsoleEntryModeDtoSchema = z.enum(["invite", "open-qr", "both"]);

export const ConsoleAddressDtoSchema = z.strictObject({
  line1: z.string().max(200),
  line2: z.string().max(200),
  postalCode: z.string().max(20),
  city: z.string().max(120),
  country: z.string().max(2),
});

export const ConsoleLocationDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  slug: IdentifierDtoSchema,
  name: z.string().min(1).max(200),
  address: ConsoleAddressDtoSchema,
  active: z.boolean(),
  entryMode: ConsoleEntryModeDtoSchema,
  entryModeSource: z.enum(["tenant", "location"]),
});

export const ConsoleLocationListDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  locations: z.array(ConsoleLocationDtoSchema).max(500),
});

const SettingValueDtoSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()).max(200),
]);

const BannedTermsDtoSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(500)
  .refine((terms) => new Set(terms).size === terms.length, {
    error: "banned terms must be unique",
  });

/**
 * A setting key determines its value type and range. Keeping this as a
 * discriminated union means an invalid key/value pair cannot cross the wire
 * and become an unsafe JSON/number coercion in the control-plane adapter.
 */
export const ConsoleTenantSettingChangeDtoSchema = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("locale"), value: z.enum(["en-GB", "de-DE"]) }),
  z.strictObject({
    key: z.literal("toneGuidelines"),
    value: z.string().trim().min(1).max(20_000),
  }),
  z.strictObject({ key: z.literal("entryMode"), value: ConsoleEntryModeDtoSchema }),
  z.strictObject({ key: z.literal("requireVerifiedExperience"), value: z.boolean() }),
  z.strictObject({ key: z.literal("requireDisclosure"), value: z.boolean() }),
  z.strictObject({
    key: z.literal("maxReviewFormatsPerRequest"),
    value: z.number().finite().int().min(1).max(8),
  }),
  z.strictObject({ key: z.literal("bannedTerms"), value: BannedTermsDtoSchema }),
  z.strictObject({
    key: z.literal("monthlyBudgetMicros"),
    value: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    key: z.literal("alertThresholdPct"),
    value: z.number().finite().int().min(0).max(100),
  }),
]);

export const ConsoleLocationOverrideChangeDtoSchema = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("entryMode"), value: ConsoleEntryModeDtoSchema }),
  z.strictObject({ key: z.literal("requireVerifiedExperience"), value: z.boolean() }),
  z.strictObject({ key: z.literal("requireDisclosure"), value: z.boolean() }),
  z.strictObject({
    key: z.literal("maxReviewFormatsPerRequest"),
    value: z.number().finite().int().min(1).max(8),
  }),
  z.strictObject({ key: z.literal("bannedTerms"), value: BannedTermsDtoSchema }),
]);

export const ConsoleConfigurationStateDtoSchema = z.strictObject({
  etag: ConfigurationEtagDtoSchema,
  draft: z
    .strictObject({
      baseEtag: ConfigurationEtagDtoSchema,
      changes: z.array(ConsoleConfigurationDraftChangeDtoSchema).max(1000),
    })
    .nullable(),
});

export const ConsoleSettingKindDtoSchema = z.enum([
  "boolean",
  "number",
  "text",
  "locale",
  "entry-mode",
  "string-list",
  /** Stored in micros; shown and edited as a currency amount. */
  "money-micros",
  "percent",
]);

/**
 * ADM-LOC-03. `locationOverride === null` means the Location inherits. Reset
 * therefore has to delete the override, not copy the Tenant value into it,
 * otherwise a later Tenant change stops propagating.
 */
export const InheritedSettingDtoSchema = z.strictObject({
  key: IdentifierDtoSchema,
  label: z.string().min(1).max(120),
  description: z.string().max(400),
  group: z.string().min(1).max(80),
  kind: ConsoleSettingKindDtoSchema,
  ownerScope: z.literal("tenant"),
  effectiveValue: SettingValueDtoSchema,
  source: z.enum(["platform", "tenant", "location"]),
  platformDefault: SettingValueDtoSchema.nullable().optional(),
  tenantValue: SettingValueDtoSchema.nullable(),
  locationOverride: SettingValueDtoSchema.nullable(),
  overridable: z.boolean(),
});

export const ConsoleLocationSettingsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  configuration: ConsoleConfigurationStateDtoSchema,
  settings: z.array(InheritedSettingDtoSchema).max(100),
});

export const TenantSettingDtoSchema = z.strictObject({
  key: IdentifierDtoSchema,
  label: z.string().min(1).max(120),
  /** What the setting changes, in the operator's terms. */
  description: z.string().max(400),
  /** Section heading, so a long form reads as related groups. */
  group: z.string().min(1).max(80),
  kind: ConsoleSettingKindDtoSchema,
  ownerScope: z.enum(["platform", "tenant"]),
  source: z.enum(["platform", "tenant"]).optional(),
  value: SettingValueDtoSchema,
  platformDefault: SettingValueDtoSchema.nullable(),
  tenantValue: SettingValueDtoSchema.nullable().optional(),
  editable: z.boolean(),
});

export const ConsoleTenantSettingsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  configuration: ConsoleConfigurationStateDtoSchema,
  settings: z.array(TenantSettingDtoSchema).max(100),
  keywordCategories: z
    .array(
      z.strictObject({
        key: IdentifierDtoSchema,
        label: z.string().min(1).max(120),
        sortOrder: z.number().int().min(0),
      }),
    )
    .max(100),
});

export const ConsoleDistributionDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  liveUrl: z.string().url(),
  /**
   * Null when this venue's entry mode cannot admit a token-free scan. A QR
   * that leads to a refusal is worse than no QR at all.
   */
  qrSvg: z.string().min(1).max(200_000).nullable(),
  qrUnavailableReason: z.string().max(400).nullable(),
  entryMode: ConsoleEntryModeDtoSchema,
  /** Open-QR carries no visit verification, so the copy must not imply one. */
  verifiesVisit: z.boolean(),
  invitationTemplate: z.string().max(4000),
  tableQrCopy: z.string().max(4000),
  counters: z.strictObject({
    issued: z.number().int().min(0),
    opened: z.number().int().min(0),
    completed: z.number().int().min(0),
  }),
});

/**
 * Every venue of one account with its own distribution assets, so an operator
 * can hand out links without opening each venue in turn.
 */
export const ConsoleDistributionOverviewDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  locations: z
    .array(
      z.strictObject({
        locationId: IdentifierDtoSchema,
        slug: IdentifierDtoSchema,
        name: z.string().min(1).max(200),
        active: z.boolean(),
        liveUrl: z.string().url(),
        qrSvg: z.string().min(1).max(200_000).nullable(),
        qrUnavailableReason: z.string().max(400).nullable(),
        entryMode: ConsoleEntryModeDtoSchema,
        verifiesVisit: z.boolean(),
        counters: z.strictObject({
          issued: z.number().int().min(0),
          opened: z.number().int().min(0),
          completed: z.number().int().min(0),
        }),
      }),
    )
    .max(500),
});

export const ConsoleReviewDestinationDtoSchema = z.strictObject({
  destinationTypeId: IdentifierDtoSchema,
  platform: IdentifierDtoSchema,
  displayName: z.string().min(1).max(120),
  platformPlaceId: z.string().max(255),
  targetUrl: z.string().max(2000),
  enabled: z.boolean(),
  /** Server-side validation result; the Console never re-derives it. */
  configurationState: z.enum(["valid", "missing", "invalid"]),
});

export const ConsoleDestinationsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  destinations: z.array(ConsoleReviewDestinationDtoSchema).max(50),
});

export type ConsoleLocationDto = z.infer<typeof ConsoleLocationDtoSchema>;
export type ConsoleLocationListDto = z.infer<
  typeof ConsoleLocationListDtoSchema
>;
export type InheritedSettingDto = z.infer<typeof InheritedSettingDtoSchema>;
export type ConsoleLocationSettingsDto = z.infer<
  typeof ConsoleLocationSettingsDtoSchema
>;
export type ConsoleTenantSettingsDto = z.infer<
  typeof ConsoleTenantSettingsDtoSchema
>;
export type ConsoleDistributionDto = z.infer<
  typeof ConsoleDistributionDtoSchema
>;
export type ConsoleDestinationsDto = z.infer<
  typeof ConsoleDestinationsDtoSchema
>;
export type ConsoleReviewDestinationDto = z.infer<
  typeof ConsoleReviewDestinationDtoSchema
>;
export type ConsoleEntryModeDto = z.infer<typeof ConsoleEntryModeDtoSchema>;
export type ConsoleSettingValueDto = z.infer<typeof SettingValueDtoSchema>;
export type ConsoleTenantSettingChangeDto = z.infer<
  typeof ConsoleTenantSettingChangeDtoSchema
>;
export type ConsoleLocationOverrideChangeDto = z.infer<
  typeof ConsoleLocationOverrideChangeDtoSchema
>;

export { SettingValueDtoSchema as ConsoleSettingValueDtoSchema };
export type ConsoleDistributionOverviewDto = z.infer<
  typeof ConsoleDistributionOverviewDtoSchema
>;
