import { z } from "zod";

import { IdentifierDtoSchema, IsoDateTimeDtoSchema } from "../shared/primitives.js";
import { ConsoleActionKeyDtoSchema } from "./overview.js";
import {
  ConsoleScopeDtoSchema,
  MoneyDtoSchema,
  SummaryDtoSchema,
} from "./primitives.js";

export const ConsoleAnalyticsSortKeyDtoSchema = z.enum([
  "generations",
  "acceptanceRate",
  "averageEditDistance",
  "p95LatencyMs",
  "totalCost",
  "costPerAccepted",
]);

export const ConsoleAnalyticsQueryDtoSchema = z.strictObject({
  from: IsoDateTimeDtoSchema,
  to: IsoDateTimeDtoSchema,
  sortKey: ConsoleAnalyticsSortKeyDtoSchema,
  sortDirection: z.enum(["asc", "desc"]),
});

/**
 * ADM-ANA-01. Location stays part of the row grain: two venues of one Tenant
 * routinely perform differently and a Tenant-level average hides that.
 */
export const ConsoleAnalyticsRowDtoSchema = z.strictObject({
  tenant: SummaryDtoSchema,
  location: SummaryDtoSchema,
  action: ConsoleActionKeyDtoSchema,
  style: z.string().min(1).max(120),
  variant: z.string().max(120).nullable(),
  generations: z.number().int().min(0),
  acceptanceRate: z.number().min(0).max(1),
  averageEditDistance: z.number().min(0),
  p50LatencyMs: z.number().int().min(0),
  p95LatencyMs: z.number().int().min(0),
  totalCost: MoneyDtoSchema,
  costPerAccepted: MoneyDtoSchema.nullable(),
});

export const ConsoleAnalyticsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  query: ConsoleAnalyticsQueryDtoSchema,
  rows: z.array(ConsoleAnalyticsRowDtoSchema).max(2000),
});

const ClaimDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  text: z.string().max(2000),
  verdict: z.enum(["supported", "unsupported", "annotation"]),
  supportedBy: z.array(z.string().max(200)).max(20),
});

export const ConsoleGenerationDetailDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  generation: z.strictObject({
    id: IdentifierDtoSchema,
    createdAt: IsoDateTimeDtoSchema,
    tenant: SummaryDtoSchema,
    location: SummaryDtoSchema,
    action: ConsoleActionKeyDtoSchema,
    style: z.strictObject({
      id: IdentifierDtoSchema,
      name: z.string().min(1).max(120),
      version: z.string().min(1).max(40),
    }),
    promptVersion: z.strictObject({
      id: IdentifierDtoSchema,
      version: z.number().int().min(1),
      hash: z.string().min(1).max(128),
    }),
    contextVersion: z
      .strictObject({
        id: IdentifierDtoSchema,
        version: z.number().int().min(1),
      })
      .nullable(),
    inputKeywords: z.array(z.string().max(200)).max(200),
    freeTextAssertions: z.array(z.string().max(4000)).max(50),
    sourceText: z.string().max(20_000).nullable(),
    provider: IdentifierDtoSchema,
    model: IdentifierDtoSchema,
    route: z.enum(["primary", "fallback"]),
    output: z.string().max(50_000),
    claims: z.array(ClaimDtoSchema).max(200),
    /** Raw removed candidates are privileged; absent means not authorized. */
    removedClaims: z
      .array(
        z.strictObject({
          text: z.string().max(2000),
          reason: z.string().max(400),
        }),
      )
      .max(200)
      .nullable(),
    cost: MoneyDtoSchema,
    /** Historical re-costing resolves the price version active at the time. */
    pricingVersionId: IdentifierDtoSchema.nullable(),
    outcome: z.enum(["accepted", "discarded", "pending"]),
    editDistance: z.number().min(0).nullable(),
    isBench: z.boolean(),
  }),
  lineage: z.strictObject({
    ancestors: z
      .array(
        z.strictObject({
          id: IdentifierDtoSchema,
          action: ConsoleActionKeyDtoSchema,
          createdAt: IsoDateTimeDtoSchema,
        }),
      )
      .max(50),
    descendants: z
      .array(
        z.strictObject({
          id: IdentifierDtoSchema,
          action: ConsoleActionKeyDtoSchema,
          createdAt: IsoDateTimeDtoSchema,
        }),
      )
      .max(200),
  }),
  replayable: z.boolean(),
});

export type ConsoleAnalyticsDto = z.infer<typeof ConsoleAnalyticsDtoSchema>;
export type ConsoleAnalyticsQueryDto = z.infer<
  typeof ConsoleAnalyticsQueryDtoSchema
>;
export type ConsoleAnalyticsRowDto = z.infer<
  typeof ConsoleAnalyticsRowDtoSchema
>;
export type ConsoleGenerationDetailDto = z.infer<
  typeof ConsoleGenerationDetailDtoSchema
>;
