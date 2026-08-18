import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";
import {
  ConsoleCapabilitiesDtoSchema,
  ConsoleRoleDtoSchema,
} from "./primitives.js";

const ConsoleLocationOptionDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  slug: IdentifierDtoSchema,
  name: z.string().min(1).max(200),
  active: z.boolean(),
});

const ConsoleTenantOptionDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  slug: IdentifierDtoSchema,
  name: z.string().min(1).max(200),
  locations: z.array(ConsoleLocationOptionDtoSchema).max(500),
});

/**
 * One authorized answer to "who am I and what may I open". Role, Tenant
 * membership and capabilities are all resolved from current Access Grants, so
 * nothing the browser sends can widen them.
 */
export const ConsoleBootstrapDtoSchema = z.strictObject({
  user: z.strictObject({
    id: IdentifierDtoSchema,
    displayName: z.string().min(1).max(320),
  }),
  role: ConsoleRoleDtoSchema,
  tenants: z.array(ConsoleTenantOptionDtoSchema).max(100),
  activeContext: z.strictObject({
    tenantId: IdentifierDtoSchema.nullable(),
    locationId: IdentifierDtoSchema.nullable(),
  }),
  capabilities: ConsoleCapabilitiesDtoSchema,
});

export type ConsoleBootstrapDto = z.infer<typeof ConsoleBootstrapDtoSchema>;
export type ConsoleTenantOptionDto = z.infer<
  typeof ConsoleTenantOptionDtoSchema
>;
export type ConsoleLocationOptionDto = z.infer<
  typeof ConsoleLocationOptionDtoSchema
>;
