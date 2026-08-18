import { z } from "zod";

export const BffErrorDtoSchema = z.strictObject({
  code: z.string().min(1).max(100),
  message: z.string().min(1),
  retryable: z.boolean(),
  fieldErrors: z.record(z.string(), z.array(z.string().min(1)).min(1)).optional(),
  requestId: z.string().min(1).max(200),
});

export type BffErrorDto = z.infer<typeof BffErrorDtoSchema>;
