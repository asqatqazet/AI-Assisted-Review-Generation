import { z } from "zod";

import { IdentifierDtoSchema } from "../shared/primitives.js";

export const OperatorIdentityDtoSchema = z.strictObject({
  issuer: z.string().url().startsWith("https://").max(500),
  subject: z.string().min(1).max(255),
  email: z.string().email().max(320),
});

const CapabilityDtoSchema = z.string().regex(/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/);

export const OperatorAccessProjectionDtoSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unauthorized") }),
  z.strictObject({
    status: z.literal("authorized"),
    operator: z.strictObject({
      id: IdentifierDtoSchema,
      email: z.string().email().max(320),
    }),
    platformGrants: z.array(
      z.strictObject({
        roleKey: IdentifierDtoSchema,
        capabilities: z.array(CapabilityDtoSchema).max(100),
      }),
    ).max(20),
    tenantGrants: z.array(
      z.strictObject({
        tenantId: IdentifierDtoSchema,
        tenantSlug: IdentifierDtoSchema,
        tenantName: z.string().min(1).max(200),
        roleKey: IdentifierDtoSchema,
        capabilities: z.array(CapabilityDtoSchema).max(100),
        locations: z.array(
          z.strictObject({
            locationId: IdentifierDtoSchema,
            locationSlug: IdentifierDtoSchema,
            locationName: z.string().min(1).max(200),
            status: z.enum(["active", "inactive"]),
          }),
        ).max(500),
      }),
    ).max(100),
  }),
]);

export const ResolveOperatorAccessInvocationDtoSchema = z.strictObject({
  operation: z.literal("resolve-operator-access"),
  input: z.strictObject({ identity: OperatorIdentityDtoSchema }),
});

export const ResolveOperatorAccessInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("resolve-operator-access"),
  result: OperatorAccessProjectionDtoSchema,
});

export type OperatorIdentityDto = z.infer<typeof OperatorIdentityDtoSchema>;
export type OperatorAccessProjectionDto = z.infer<
  typeof OperatorAccessProjectionDtoSchema
>;
export type ResolveOperatorAccessInvocationDto = z.infer<
  typeof ResolveOperatorAccessInvocationDtoSchema
>;
export type ResolveOperatorAccessInvocationResultDto = z.infer<
  typeof ResolveOperatorAccessInvocationResultDtoSchema
>;
