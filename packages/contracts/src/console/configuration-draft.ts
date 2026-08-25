import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";
import { ConsoleKeywordPolarityDtoSchema } from "./configuration.js";
import { ConsoleActionKeyDtoSchema } from "./overview.js";

const EntryModeSchema = z.enum(["invite", "open-qr", "both"]);
const BannedTermsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(500)
  .refine((terms) => new Set(terms).size === terms.length, {
    error: "banned terms must be unique",
  });
const TenantSettingChangeSchema = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("locale"), value: z.enum(["en-GB", "de-DE"]) }),
  z.strictObject({
    key: z.literal("toneGuidelines"),
    value: z.string().trim().min(1).max(20_000),
  }),
  z.strictObject({ key: z.literal("entryMode"), value: EntryModeSchema }),
  z.strictObject({ key: z.literal("requireVerifiedExperience"), value: z.boolean() }),
  z.strictObject({ key: z.literal("requireDisclosure"), value: z.boolean() }),
  z.strictObject({
    key: z.literal("maxReviewFormatsPerRequest"),
    value: z.number().finite().int().min(1).max(8),
  }),
  z.strictObject({ key: z.literal("bannedTerms"), value: BannedTermsSchema }),
  z.strictObject({
    key: z.literal("monthlyBudgetMicros"),
    value: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    key: z.literal("alertThresholdPct"),
    value: z.number().finite().int().min(0).max(100),
  }),
]);
const LocationOverrideChangeSchema = z.discriminatedUnion("key", [
  z.strictObject({ key: z.literal("entryMode"), value: EntryModeSchema }),
  z.strictObject({ key: z.literal("requireVerifiedExperience"), value: z.boolean() }),
  z.strictObject({ key: z.literal("requireDisclosure"), value: z.boolean() }),
  z.strictObject({
    key: z.literal("maxReviewFormatsPerRequest"),
    value: z.number().finite().int().min(1).max(8),
  }),
  z.strictObject({ key: z.literal("bannedTerms"), value: BannedTermsSchema }),
]);

/**
 * Every mutation that can change a future Effective Configuration Snapshot.
 * The union is persisted in one scoped Draft and applied only by publication.
 */
export const ConsoleConfigurationDraftChangeDtoSchema = z.union([
  TenantSettingChangeSchema,
  z.strictObject({
    operation: z.literal("set-location-override"),
    change: LocationOverrideChangeSchema,
  }),
  z.strictObject({
    operation: z.literal("reset-location-override"),
    key: IdentifierDtoSchema,
  }),
  z.strictObject({
    operation: z.literal("create-fact-option"),
    mutationId: IdentifierDtoSchema,
    label: z.string().trim().min(1).max(200),
    categoryKey: IdentifierDtoSchema,
    polarity: ConsoleKeywordPolarityDtoSchema,
    ownerScope: z.enum(["tenant", "location"]),
  }),
  z.strictObject({
    operation: z.literal("update-fact-option"),
    keywordId: IdentifierDtoSchema,
    label: z.string().trim().min(1).max(200),
    polarity: ConsoleKeywordPolarityDtoSchema,
    active: z.boolean(),
  }),
  z.strictObject({
    operation: z.literal("reorder-fact-options"),
    orderedKeywordIds: z.array(IdentifierDtoSchema).max(1000),
  }),
  z.strictObject({
    operation: z.literal("delete-fact-option"),
    keywordId: IdentifierDtoSchema,
  }),
  z.strictObject({
    operation: z.literal("set-review-format-enablement"),
    styleId: IdentifierDtoSchema,
    enabled: z.boolean(),
    enabledActions: z.array(ConsoleActionKeyDtoSchema).max(20),
  }),
  z.strictObject({
    operation: z.literal("reorder-review-formats"),
    orderedStyleIds: z.array(IdentifierDtoSchema).max(200),
  }),
  z.strictObject({
    operation: z.literal("set-action-enablement"),
    action: ConsoleActionKeyDtoSchema,
    enabled: z.boolean(),
  }),
  z.strictObject({
    operation: z.literal("deploy-prompt-version"),
    action: ConsoleActionKeyDtoSchema,
    promptVersionId: IdentifierDtoSchema,
  }),
]);

export type ConsoleConfigurationDraftChangeDto = z.infer<
  typeof ConsoleConfigurationDraftChangeDtoSchema
>;
