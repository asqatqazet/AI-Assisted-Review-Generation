import { z } from "zod";

import { GenerationWorkloadDtoSchema } from "../generation/generation-request.js";
import { ConsoleBenchResultDtoSchema } from "./ai.js";

export type { ConsoleBenchResultDto } from "./ai.js";

/**
 * The BFF is only a courier for this invocation. Generation trusts the signed
 * immutable workload, never a scope or configuration assertion from the BFF.
 */
export const ConsoleBenchInvocationDtoSchema = z.strictObject({
  operation: z.literal("console-bench"),
  input: z.strictObject({
    receipt: z.string().min(1).max(4000),
    workload: GenerationWorkloadDtoSchema,
  }),
});

export const ConsoleBenchInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("console-bench"),
  result: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("not-found") }),
    z.strictObject({
      status: z.literal("completed"),
      result: ConsoleBenchResultDtoSchema,
    }),
  ]),
});

export type ConsoleBenchInvocationDto = z.infer<
  typeof ConsoleBenchInvocationDtoSchema
>;
export type ConsoleBenchInvocationResultDto = z.infer<
  typeof ConsoleBenchInvocationResultDtoSchema
>;
