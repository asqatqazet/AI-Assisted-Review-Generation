import { z } from "zod";

import { IdentifierDtoSchema, IsoDateTimeDtoSchema } from "../shared/primitives.js";
import {
  ConsoleScopeDtoSchema,
  MoneyDtoSchema,
  SummaryDtoSchema,
} from "./primitives.js";

export const ConsoleActionKeyDtoSchema = z.enum([
  "generate",
  "paraphrase",
  "resample",
  "reformat",
  "condense",
  "expand",
  "revise-wording",
  "add-assertion",
]);

const MetricsDtoSchema = z.strictObject({
  generations: z.number().int().min(0),
  accepted: z.number().int().min(0),
  acceptanceRate: z.number().min(0).max(1),
  totalCost: MoneyDtoSchema,
  costPerAccepted: MoneyDtoSchema.nullable(),
});

const ActionMetricDtoSchema = z.strictObject({
  action: ConsoleActionKeyDtoSchema,
  generations: z.number().int().min(0),
  accepted: z.number().int().min(0),
  acceptanceRate: z.number().min(0).max(1),
  totalCost: MoneyDtoSchema,
});

const ScopedMetricDtoSchema = z.strictObject({
  subject: SummaryDtoSchema,
  generations: z.number().int().min(0),
  accepted: z.number().int().min(0),
  acceptanceRate: z.number().min(0).max(1),
  totalCost: MoneyDtoSchema,
});

const ExperimentVariantSummaryDtoSchema = z.strictObject({
  promptVersionId: IdentifierDtoSchema,
  promptVersionHash: z.string().min(1).max(128),
  weightPct: z.number().int().min(0).max(100),
  generations: z.number().int().min(0),
  accepted: z.number().int().min(0),
  acceptanceRate: z.number().min(0).max(1),
});

export const ProviderHealthSummaryDtoSchema = z.strictObject({
  providerKey: IdentifierDtoSchema,
  displayName: z.string().min(1).max(120),
  routingRole: z.enum(["primary", "fallback"]),
  status: z.enum(["healthy", "degraded", "unavailable"]),
  p95LatencyMs: z.number().int().min(0).nullable(),
  fallbackShare: z.number().min(0).max(1),
});

/**
 * Alert conditions are decided server-side. The Console renders the condition
 * it is given and never recomputes a threshold from raw spend.
 */
export const ConsoleAlertDtoSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("budget_warning"),
    severity: z.enum(["warning", "critical"]),
    tenant: SummaryDtoSchema.nullable(),
    spent: MoneyDtoSchema,
    budget: MoneyDtoSchema,
    thresholdPercent: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    type: z.literal("provider_degraded"),
    severity: z.enum(["warning", "critical"]),
    providerKey: IdentifierDtoSchema,
    displayName: z.string().min(1).max(120),
  }),
]);

export const ConsoleOverviewDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  window: z.strictObject({
    from: IsoDateTimeDtoSchema,
    to: IsoDateTimeDtoSchema,
  }),
  metrics: MetricsDtoSchema,
  byAction: z.array(ActionMetricDtoSchema).max(50),
  byLocation: z.array(ScopedMetricDtoSchema).max(500),
  byTenant: z.array(ScopedMetricDtoSchema).max(200),
  experiment: z
    .strictObject({
      id: IdentifierDtoSchema,
      action: ConsoleActionKeyDtoSchema,
      status: z.literal("running"),
      variants: z.array(ExperimentVariantSummaryDtoSchema).max(10),
    })
    .nullable(),
  providerHealth: z.array(ProviderHealthSummaryDtoSchema).max(50),
  alerts: z.array(ConsoleAlertDtoSchema).max(50),
});

export type ConsoleActionKeyDto = z.infer<typeof ConsoleActionKeyDtoSchema>;
export type ConsoleOverviewDto = z.infer<typeof ConsoleOverviewDtoSchema>;
export type ConsoleAlertDto = z.infer<typeof ConsoleAlertDtoSchema>;
export type ProviderHealthSummaryDto = z.infer<
  typeof ProviderHealthSummaryDtoSchema
>;
