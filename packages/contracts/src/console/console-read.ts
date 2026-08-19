import { z } from "zod";

import { IdentifierDtoSchema, IsoDateTimeDtoSchema } from "../shared/primitives.js";
import {
  ConsoleAnalyticsDtoSchema,
  ConsoleAnalyticsQueryDtoSchema,
  ConsoleGenerationDetailDtoSchema,
} from "./analytics.js";
import { ConsoleOverviewDtoSchema } from "./overview.js";

/**
 * Generation history lives under the execution-plane database role, which the
 * Context service cannot read. Context stays the only authorizer: it resolves
 * Access Grants, then issues this short-lived receipt naming the scope it
 * authorized. The BFF carries the receipt across; the Generation service
 * verifies Context's signature before reading anything.
 *
 * The BFF is a courier here, exactly as it is for a paid-work permit. Nothing
 * it asserts about scope is trusted.
 */
export const ConsoleReadScopeDtoSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("platform") }),
  z.strictObject({ type: z.literal("tenant"), tenantId: IdentifierDtoSchema }),
  z.strictObject({
    type: z.literal("location"),
    tenantId: IdentifierDtoSchema,
    locationId: IdentifierDtoSchema,
  }),
]);

export const ConsoleReadQueryDtoSchema = z.discriminatedUnion("view", [
  z.strictObject({
    view: z.literal("overview"),
    from: IsoDateTimeDtoSchema,
    to: IsoDateTimeDtoSchema,
  }),
  z.strictObject({
    view: z.literal("analytics"),
    query: ConsoleAnalyticsQueryDtoSchema,
  }),
  z.strictObject({
    view: z.literal("generation-detail"),
    generationId: IdentifierDtoSchema,
  }),
]);

export const ConsoleReadInvocationDtoSchema = z.strictObject({
  operation: z.literal("console-read"),
  input: z.strictObject({
    /** Signed by Context over the authorized scope, the query and an expiry. */
    receipt: z.string().min(1).max(4000),
    scope: ConsoleReadScopeDtoSchema,
    query: ConsoleReadQueryDtoSchema,
    /** Raw removed candidates need a privileged audit capability. */
    mayReadRawCandidates: z.boolean(),
  }),
});

export const ConsoleReadInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("console-read"),
  result: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("not-found") }),
    z.strictObject({
      status: z.literal("overview"),
      data: ConsoleOverviewDtoSchema.omit({ scope: true }),
    }),
    z.strictObject({
      status: z.literal("analytics"),
      rows: ConsoleAnalyticsDtoSchema.shape.rows,
    }),
    z.strictObject({
      status: z.literal("generation-detail"),
      generation: ConsoleGenerationDetailDtoSchema.shape.generation,
      lineage: ConsoleGenerationDetailDtoSchema.shape.lineage,
    }),
  ]),
});

export type ConsoleReadScopeDto = z.infer<typeof ConsoleReadScopeDtoSchema>;
export type ConsoleReadQueryDto = z.infer<typeof ConsoleReadQueryDtoSchema>;
export type ConsoleReadInvocationDto = z.infer<
  typeof ConsoleReadInvocationDtoSchema
>;
export type ConsoleReadInvocationResultDto = z.infer<
  typeof ConsoleReadInvocationResultDtoSchema
>;
