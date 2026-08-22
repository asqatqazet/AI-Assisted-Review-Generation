import { z } from "zod";

import { OperatorIdentityDtoSchema } from "../context/operator-access.js";
import { IdentifierDtoSchema } from "../shared/primitives.js";
import {
  ConsoleBenchInputDtoSchema,
  ConsoleBenchResultDtoSchema,
  ConsoleExperimentsDtoSchema,
  ConsolePromptComparisonDtoSchema,
  ConsolePromptsDtoSchema,
  ConsoleBenchFormDtoSchema,
} from "./ai.js";
import {
  ConsoleAnalyticsDtoSchema,
  ConsoleAnalyticsQueryDtoSchema,
  ConsoleGenerationDetailDtoSchema,
} from "./analytics.js";
import { ConsoleBootstrapDtoSchema } from "./bootstrap.js";
import {
  ConsoleActionsDtoSchema,
  ConsoleContextDtoSchema,
  ConsoleKeywordPolarityDtoSchema,
  ConsoleKeywordsDtoSchema,
  ConsoleStyleDetailDtoSchema,
  ConsoleStyleValidationDtoSchema,
  ConsoleStylesDtoSchema,
} from "./configuration.js";
import {
  ConsoleAddressDtoSchema,
  ConsoleDestinationsDtoSchema,
  ConsoleDistributionDtoSchema,
  ConsoleDistributionOverviewDtoSchema,
  ConsoleEntryModeDtoSchema,
  ConsoleLocationListDtoSchema,
  ConsoleLocationSettingsDtoSchema,
  ConsoleSettingValueDtoSchema,
  ConsoleTenantSettingsDtoSchema,
} from "./locations.js";
import { ConsoleOverviewDtoSchema } from "./overview.js";
import { ConsoleActionKeyDtoSchema } from "./overview.js";
import {
  PlatformProvidersDtoSchema,
  PlatformSettingsDtoSchema,
  PlatformStylesDtoSchema,
  PlatformTenantsDtoSchema,
} from "./platform.js";
import {
  ConsoleScopeRequestDtoSchema,
} from "./primitives.js";
import { LocaleDtoSchema } from "../shared/primitives.js";

export const ConsoleQueryDtoSchema = z.discriminatedUnion("view", [
  z.strictObject({ view: z.literal("bootstrap") }),
  z.strictObject({ view: z.literal("overview") }),
  z.strictObject({ view: z.literal("locations") }),
  z.strictObject({ view: z.literal("location-settings") }),
  z.strictObject({ view: z.literal("tenant-settings") }),
  z.strictObject({ view: z.literal("distribution") }),
  z.strictObject({ view: z.literal("distribution-overview") }),
  z.strictObject({ view: z.literal("destinations") }),
  z.strictObject({ view: z.literal("context") }),
  z.strictObject({ view: z.literal("keywords") }),
  z.strictObject({ view: z.literal("styles") }),
  z.strictObject({
    view: z.literal("style-detail"),
    styleId: IdentifierDtoSchema,
  }),
  z.strictObject({ view: z.literal("actions") }),
  z.strictObject({
    view: z.literal("prompts"),
    action: ConsoleActionKeyDtoSchema.nullable(),
  }),
  z.strictObject({
    view: z.literal("prompt-comparison"),
    leftPromptVersionId: IdentifierDtoSchema,
    rightPromptVersionId: IdentifierDtoSchema,
  }),
  z.strictObject({ view: z.literal("experiments") }),
  z.strictObject({
    view: z.literal("bench-form"),
    replayGenerationId: IdentifierDtoSchema.nullable(),
  }),
  z.strictObject({
    view: z.literal("analytics"),
    query: ConsoleAnalyticsQueryDtoSchema,
  }),
  z.strictObject({
    view: z.literal("generation-detail"),
    generationId: IdentifierDtoSchema,
  }),
  z.strictObject({ view: z.literal("platform-tenants") }),
  z.strictObject({ view: z.literal("platform-providers") }),
  z.strictObject({ view: z.literal("platform-styles") }),
  z.strictObject({ view: z.literal("platform-settings") }),
]);

export const ConsoleCommandDtoSchema = z.discriminatedUnion("command", [
  z.strictObject({
    command: z.literal("create-location"),
    name: z.string().min(1).max(200),
    slug: IdentifierDtoSchema.max(100),
    address: ConsoleAddressDtoSchema,
    entryMode: ConsoleEntryModeDtoSchema.nullable(),
  }),
  z.strictObject({
    command: z.literal("update-location"),
    locationId: IdentifierDtoSchema,
    name: z.string().min(1).max(200),
    address: ConsoleAddressDtoSchema,
    active: z.boolean(),
  }),
  z.strictObject({
    command: z.literal("save-tenant-settings"),
    values: z.record(IdentifierDtoSchema, ConsoleSettingValueDtoSchema),
  }),
  z.strictObject({
    command: z.literal("set-location-override"),
    key: IdentifierDtoSchema,
    value: ConsoleSettingValueDtoSchema,
  }),
  z.strictObject({
    command: z.literal("reset-location-override"),
    key: IdentifierDtoSchema,
  }),
  z.strictObject({
    command: z.literal("save-destination"),
    destinationTypeId: IdentifierDtoSchema,
    platformPlaceId: z.string().max(255),
    targetUrl: z.string().max(2000),
    enabled: z.boolean(),
  }),
  z.strictObject({
    command: z.literal("publish-context-version"),
    context: z.string().max(20_000),
    bannedTerms: z.array(z.string().min(1).max(120)).max(500),
  }),
  z.strictObject({
    command: z.literal("create-keyword"),
    label: z.string().min(1).max(200),
    categoryKey: IdentifierDtoSchema,
    polarity: ConsoleKeywordPolarityDtoSchema,
    ownerScope: z.enum(["tenant", "location"]),
  }),
  z.strictObject({
    command: z.literal("update-keyword"),
    keywordId: IdentifierDtoSchema,
    label: z.string().min(1).max(200),
    polarity: ConsoleKeywordPolarityDtoSchema,
    active: z.boolean(),
  }),
  z.strictObject({
    command: z.literal("reorder-keywords"),
    orderedKeywordIds: z.array(IdentifierDtoSchema).max(1000),
  }),
  z.strictObject({
    command: z.literal("delete-keyword"),
    keywordId: IdentifierDtoSchema,
  }),
  z.strictObject({
    command: z.literal("set-style-enablement"),
    styleId: IdentifierDtoSchema,
    enabled: z.boolean(),
    enabledActions: z.array(ConsoleActionKeyDtoSchema).max(20),
  }),
  z.strictObject({
    command: z.literal("reorder-styles"),
    orderedStyleIds: z.array(IdentifierDtoSchema).max(200),
  }),
  z.strictObject({
    command: z.literal("validate-style"),
    styleId: IdentifierDtoSchema,
  }),
  z.strictObject({
    command: z.literal("set-action-enablement"),
    action: ConsoleActionKeyDtoSchema,
    enabled: z.boolean(),
  }),
  z.strictObject({
    command: z.literal("create-prompt-version"),
    action: ConsoleActionKeyDtoSchema,
    body: z.string().min(1).max(50_000),
    variables: z.array(z.string().min(1).max(80)).max(100),
  }),
  z.strictObject({
    command: z.literal("create-experiment"),
    action: ConsoleActionKeyDtoSchema,
    variants: z
      .array(
        z.strictObject({
          promptVersionId: IdentifierDtoSchema,
          weightPct: z.number().int().min(0).max(100),
        }),
      )
      .min(2)
      .max(10),
  }),
  z.strictObject({
    command: z.literal("start-experiment"),
    experimentId: IdentifierDtoSchema,
  }),
  z.strictObject({
    command: z.literal("stop-experiment"),
    experimentId: IdentifierDtoSchema,
  }),
  z.strictObject({
    command: z.literal("run-bench"),
    input: ConsoleBenchInputDtoSchema,
  }),
  z.strictObject({
    command: z.literal("create-tenant"),
    name: z.string().min(1).max(200),
    slug: IdentifierDtoSchema.max(100),
    locale: LocaleDtoSchema,
    category: z.string().max(120),
    plan: z.string().max(80),
  }),
  z.strictObject({
    /**
     * Materialises this venue's Effective Configuration Snapshot from current
     * account configuration and Platform routing. Generation reads the
     * snapshot, not the live tables, so a change reaches reviewers only once
     * it has been published here.
     */
    command: z.literal("republish-configuration"),
  }),
  z.strictObject({
    command: z.literal("set-tenant-status"),
    tenantId: IdentifierDtoSchema,
    status: z.enum(["active", "suspended", "deactivated"]),
  }),
  z.strictObject({
    command: z.literal("create-keyword-category"),
    key: IdentifierDtoSchema.max(100),
    label: z.string().min(1).max(120),
  }),
  z.strictObject({
    command: z.literal("set-provider-routing"),
    providerKey: IdentifierDtoSchema,
    modelKey: IdentifierDtoSchema,
    routingPriority: z.number().int().min(0).nullable(),
    fallbackPriority: z.number().int().min(0).nullable(),
  }),
  z.strictObject({
    command: z.literal("publish-price-rate"),
    providerKey: IdentifierDtoSchema,
    modelKey: IdentifierDtoSchema,
    inputMicrosPerMillion: z.number().int().min(0),
    outputMicrosPerMillion: z.number().int().min(0),
    currency: z.string().length(3),
    validFrom: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    command: z.literal("import-platform-style"),
    manifest: z.string().min(1).max(50_000),
  }),
  z.strictObject({
    command: z.literal("save-platform-settings"),
    defaultPolicyTemplate: z.string().max(50_000),
    globalRateLimits: PlatformSettingsDtoSchema.shape.globalRateLimits,
    logRetentionDays: z.number().int().min(1).max(3650),
    featureFlags: z
      .array(
        z.strictObject({
          key: IdentifierDtoSchema,
          enabled: z.boolean(),
        }),
      )
      .max(200),
  }),
]);

export const ConsoleViewDtoSchema = z.discriminatedUnion("view", [
  z.strictObject({
    view: z.literal("bootstrap"),
    data: ConsoleBootstrapDtoSchema,
  }),
  z.strictObject({ view: z.literal("overview"), data: ConsoleOverviewDtoSchema }),
  z.strictObject({
    view: z.literal("locations"),
    data: ConsoleLocationListDtoSchema,
  }),
  z.strictObject({
    view: z.literal("location-settings"),
    data: ConsoleLocationSettingsDtoSchema,
  }),
  z.strictObject({
    view: z.literal("tenant-settings"),
    data: ConsoleTenantSettingsDtoSchema,
  }),
  z.strictObject({
    view: z.literal("distribution"),
    data: ConsoleDistributionDtoSchema,
  }),
  z.strictObject({
    view: z.literal("distribution-overview"),
    data: ConsoleDistributionOverviewDtoSchema,
  }),
  z.strictObject({
    view: z.literal("destinations"),
    data: ConsoleDestinationsDtoSchema,
  }),
  z.strictObject({ view: z.literal("context"), data: ConsoleContextDtoSchema }),
  z.strictObject({ view: z.literal("keywords"), data: ConsoleKeywordsDtoSchema }),
  z.strictObject({ view: z.literal("styles"), data: ConsoleStylesDtoSchema }),
  z.strictObject({
    view: z.literal("style-detail"),
    data: ConsoleStyleDetailDtoSchema,
  }),
  z.strictObject({ view: z.literal("actions"), data: ConsoleActionsDtoSchema }),
  z.strictObject({ view: z.literal("prompts"), data: ConsolePromptsDtoSchema }),
  z.strictObject({
    view: z.literal("prompt-comparison"),
    data: ConsolePromptComparisonDtoSchema,
  }),
  z.strictObject({
    view: z.literal("experiments"),
    data: ConsoleExperimentsDtoSchema,
  }),
  z.strictObject({
    view: z.literal("bench-form"),
    data: ConsoleBenchFormDtoSchema,
  }),
  z.strictObject({
    view: z.literal("analytics"),
    data: ConsoleAnalyticsDtoSchema,
  }),
  z.strictObject({
    view: z.literal("generation-detail"),
    data: ConsoleGenerationDetailDtoSchema,
  }),
  z.strictObject({
    view: z.literal("platform-tenants"),
    data: PlatformTenantsDtoSchema,
  }),
  z.strictObject({
    view: z.literal("platform-providers"),
    data: PlatformProvidersDtoSchema,
  }),
  z.strictObject({
    view: z.literal("platform-styles"),
    data: PlatformStylesDtoSchema,
  }),
  z.strictObject({
    view: z.literal("platform-settings"),
    data: PlatformSettingsDtoSchema,
  }),
]);

export const ConsoleCommandResultDtoSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("accepted") }),
  z.strictObject({
    outcome: z.literal("bench-result"),
    result: ConsoleBenchResultDtoSchema,
  }),
  z.strictObject({
    outcome: z.literal("style-validation"),
    validation: ConsoleStyleValidationDtoSchema,
  }),
]);

/**
 * A rejection an authorized operator is allowed to understand. Anything that
 * would disclose another Tenant's data resolves to `not-found` instead.
 */
export const ConsoleRejectionCodeDtoSchema = z.enum([
  "SLUG_TAKEN",
  "INVALID_WEIGHTS",
  "EXPERIMENT_RUNNING",
  "EXPERIMENT_NOT_DRAFT",
  "STYLE_INCOMPATIBLE",
  "ACTION_REQUIRED_BY_ENTRY",
  "INVALID_MANIFEST",
  "NOT_OVERRIDABLE",
  "INVALID_VALUE",
  "REPLAY_DEPENDENCY_MISSING",
  /**
   * The deployment cannot serve this view yet. It depends only on what is
   * deployed, never on who is asking, so saying so discloses nothing.
   */
  "VIEW_NOT_AVAILABLE",
]);

export const ConsoleRequestInvocationDtoSchema = z.strictObject({
  operation: z.literal("console-request"),
  input: z.strictObject({
    identity: OperatorIdentityDtoSchema,
    scope: ConsoleScopeRequestDtoSchema,
    /**
     * The edge origin this request arrived on, so distribution links are minted
     * for the domain the reviewer will actually use. Null when the BFF cannot
     * establish its own public origin.
     */
    publicOrigin: z.string().url().nullable(),
    request: z.discriminatedUnion("mode", [
      z.strictObject({ mode: z.literal("query"), query: ConsoleQueryDtoSchema }),
      z.strictObject({
        mode: z.literal("command"),
        command: ConsoleCommandDtoSchema,
      }),
    ]),
  }),
});

export const ConsoleRequestInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("console-request"),
  result: z.discriminatedUnion("status", [
    /**
     * Unknown id, another Tenant's id and an unauthorized scope are the same
     * public answer. Existence is never disclosed across a Tenant boundary.
     */
    z.strictObject({ status: z.literal("not-found") }),
    z.strictObject({ status: z.literal("view"), view: ConsoleViewDtoSchema }),
    z.strictObject({
      status: z.literal("command"),
      result: ConsoleCommandResultDtoSchema,
    }),
    z.strictObject({
      status: z.literal("rejected"),
      code: ConsoleRejectionCodeDtoSchema,
      message: z.string().min(1).max(400),
    }),
  ]),
});

export type ConsoleQueryDto = z.infer<typeof ConsoleQueryDtoSchema>;
export type ConsoleCommandDto = z.infer<typeof ConsoleCommandDtoSchema>;
export type ConsoleViewDto = z.infer<typeof ConsoleViewDtoSchema>;
export type ConsoleCommandResultDto = z.infer<
  typeof ConsoleCommandResultDtoSchema
>;
export type ConsoleRejectionCodeDto = z.infer<
  typeof ConsoleRejectionCodeDtoSchema
>;
export type ConsoleRequestInvocationDto = z.infer<
  typeof ConsoleRequestInvocationDtoSchema
>;
export type ConsoleRequestInvocationResultDto = z.infer<
  typeof ConsoleRequestInvocationResultDtoSchema
>;
