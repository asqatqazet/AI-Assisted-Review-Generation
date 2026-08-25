import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";

export const ConfigurationEtagDtoSchema = z
  .string()
  .max(200)
  .regex(/^"[^"\r\n]{1,198}"$/);

/**
 * Console projections are money-bearing. The wire always carries an explicit
 * currency so no screen has to assume the Tenant's configured currency.
 */
export const MoneyDtoSchema = z.strictObject({
  amountMicros: z.number().int(),
  currency: z.string().length(3),
});

export const SummaryDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  slug: IdentifierDtoSchema,
  name: z.string().min(1).max(200),
});

/**
 * Every scoped Console read resolves to exactly one authorized scope. Platform
 * scope carries no Tenant, so a Tenant operator can never receive one.
 */
export const ConsoleScopeDtoSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("platform") }),
  z.strictObject({
    type: z.literal("tenant"),
    tenant: SummaryDtoSchema,
  }),
  z.strictObject({
    type: z.literal("location"),
    tenant: SummaryDtoSchema,
    location: SummaryDtoSchema,
  }),
]);

/**
 * What the browser asks for. It is a request, never an authority: the Context
 * service re-resolves current Access Grants before honouring it.
 */
export const ConsoleScopeRequestDtoSchema = z.strictObject({
  tenantId: IdentifierDtoSchema.nullable(),
  locationId: IdentifierDtoSchema.nullable(),
});

export const ConsoleCapabilitiesDtoSchema = z.strictObject({
  canAccessPlatform: z.boolean(),
  canSwitchTenant: z.boolean(),
  canManageLocations: z.boolean(),
  canManageConfiguration: z.boolean(),
  canViewAnalytics: z.boolean(),
  canManageAiOperations: z.boolean(),
  canManageProviders: z.boolean(),
});

export const ConsoleRoleDtoSchema = z.enum([
  "tenant_operator",
  "agency_operator",
  "platform_admin",
]);

export type MoneyDto = z.infer<typeof MoneyDtoSchema>;
export type SummaryDto = z.infer<typeof SummaryDtoSchema>;
export type ConsoleScopeDto = z.infer<typeof ConsoleScopeDtoSchema>;
export type ConsoleScopeRequestDto = z.infer<typeof ConsoleScopeRequestDtoSchema>;
export type ConsoleCapabilitiesDto = z.infer<typeof ConsoleCapabilitiesDtoSchema>;
export type ConsoleRoleDto = z.infer<typeof ConsoleRoleDtoSchema>;
