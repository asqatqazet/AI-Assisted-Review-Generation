import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";
import { ConsoleScopeDtoSchema } from "./primitives.js";

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
  z.number(),
  z.boolean(),
  z.array(z.string()).max(200),
]);

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
  source: z.enum(["tenant", "location"]),
  tenantValue: SettingValueDtoSchema,
  locationOverride: SettingValueDtoSchema.nullable(),
  overridable: z.boolean(),
});

export const ConsoleLocationSettingsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
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
  value: SettingValueDtoSchema,
  platformDefault: SettingValueDtoSchema.nullable(),
  editable: z.boolean(),
});

export const ConsoleTenantSettingsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
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

export { SettingValueDtoSchema as ConsoleSettingValueDtoSchema };
