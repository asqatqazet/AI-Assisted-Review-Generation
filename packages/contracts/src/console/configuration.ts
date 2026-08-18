import { z } from "zod";

import {
  IdentifierDtoSchema,
  IsoDateTimeDtoSchema,
  LocaleDtoSchema,
  ReviewFormatLocaleDtoSchema,
} from "../shared/primitives.js";
import { ConsoleActionKeyDtoSchema } from "./overview.js";
import { ConsoleScopeDtoSchema } from "./primitives.js";

/**
 * ADM-CFG-01. Publishing never updates version N; it appends N+1, so an old
 * Generation can always resolve the exact business context it was grounded on.
 */
export const ConsoleContextVersionDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  version: z.number().int().min(1),
  status: z.literal("published"),
  createdAt: IsoDateTimeDtoSchema,
  createdBy: z.string().max(320).nullable(),
  context: z.string().max(20_000),
  bannedTerms: z.array(z.string().min(1).max(120)).max(500),
});

export const ConsoleContextDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  current: ConsoleContextVersionDtoSchema.nullable(),
  history: z
    .array(
      z.strictObject({
        id: IdentifierDtoSchema,
        version: z.number().int().min(1),
        createdAt: IsoDateTimeDtoSchema,
        createdBy: z.string().max(320).nullable(),
      }),
    )
    .max(200),
});

export const ConsoleKeywordPolarityDtoSchema = z.enum([
  "positive",
  "neutral",
  "negative",
]);

/** Fact Options in canonical language; "keyword" is the prototype's wire name. */
export const ConsoleKeywordDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  label: z.string().min(1).max(200),
  categoryKey: IdentifierDtoSchema,
  categoryLabel: z.string().min(1).max(120),
  polarity: ConsoleKeywordPolarityDtoSchema,
  ownerScope: z.enum(["tenant", "location"]),
  active: z.boolean(),
  sortOrder: z.number().int().min(0),
  deletable: z.boolean(),
});

export const ConsoleKeywordsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  /** Taxonomy is Tenant data. Adding a category must not need a deployment. */
  categories: z
    .array(
      z.strictObject({
        key: IdentifierDtoSchema,
        label: z.string().min(1).max(120),
        sortOrder: z.number().int().min(0),
      }),
    )
    .max(100),
  keywords: z.array(ConsoleKeywordDtoSchema).max(1000),
});

export const ConsoleTenantStyleDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  key: IdentifierDtoSchema,
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(40),
  locale: ReviewFormatLocaleDtoSchema,
  targetPlatform: IdentifierDtoSchema,
  maxChars: z.number().int().min(1),
  supportedActions: z.array(ConsoleActionKeyDtoSchema).max(20),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(0),
  enabledActions: z.array(ConsoleActionKeyDtoSchema).max(20),
  /** Non-null means enablement is refused, and says why in operator language. */
  incompatibility: z.string().max(400).nullable(),
});

export const ConsoleStylesDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  tenantLocale: LocaleDtoSchema,
  styles: z.array(ConsoleTenantStyleDtoSchema).max(200),
});

export const ConsoleStyleValidationDtoSchema = z.strictObject({
  checkedAt: IsoDateTimeDtoSchema,
  status: z.enum(["pass", "fail"]),
  rules: z
    .array(
      z.strictObject({
        ruleKey: IdentifierDtoSchema,
        label: z.string().min(1).max(200),
        status: z.enum(["pass", "fail"]),
        detail: z.string().max(400).nullable(),
      }),
    )
    .max(100),
});

export const ConsoleStyleDetailDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  style: ConsoleTenantStyleDtoSchema,
  /** Tenant operators inspect Platform manifests; they never author them. */
  manifestEditable: z.boolean(),
  manifest: z.string().max(50_000),
  validation: ConsoleStyleValidationDtoSchema.nullable(),
});

export const ConsoleActionPolicyDtoSchema = z.strictObject({
  key: ConsoleActionKeyDtoSchema,
  label: z.string().min(1).max(120),
  enabled: z.boolean(),
  requiredInputs: z.array(z.string().min(1).max(80)).max(20),
  groundingRule: z.string().min(1).max(400),
  relativeCost: z.enum(["low", "medium", "high"]),
  /** Disabling the last entry path would leave the Survey with no route out. */
  disableBlockedReason: z.string().max(400).nullable(),
});

export const ConsoleActionsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  actions: z.array(ConsoleActionPolicyDtoSchema).max(50),
});

export type ConsoleContextDto = z.infer<typeof ConsoleContextDtoSchema>;
export type ConsoleContextVersionDto = z.infer<
  typeof ConsoleContextVersionDtoSchema
>;
export type ConsoleKeywordsDto = z.infer<typeof ConsoleKeywordsDtoSchema>;
export type ConsoleKeywordDto = z.infer<typeof ConsoleKeywordDtoSchema>;
export type ConsoleStylesDto = z.infer<typeof ConsoleStylesDtoSchema>;
export type ConsoleStyleDetailDto = z.infer<typeof ConsoleStyleDetailDtoSchema>;
export type ConsoleActionsDto = z.infer<typeof ConsoleActionsDtoSchema>;
export type ConsoleActionPolicyDto = z.infer<
  typeof ConsoleActionPolicyDtoSchema
>;
