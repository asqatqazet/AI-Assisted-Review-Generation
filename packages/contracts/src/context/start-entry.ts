import { z } from "zod";

export const StartEntryRequestDtoSchema = z.strictObject({
  rating: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  action: z.enum(["generate", "paraphrase"]),
  csrfToken: z.string().min(32),
});

export type StartEntryRequestDto = z.infer<typeof StartEntryRequestDtoSchema>;
