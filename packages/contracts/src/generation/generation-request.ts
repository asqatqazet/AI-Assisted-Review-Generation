import { z } from "zod";

import { EffectiveConfigurationSnapshotDtoSchema } from "../context/effective-configuration-snapshot.js";
import { IdentifierDtoSchema } from "../shared/primitives.js";

const BaseCommandDtoSchema = z.strictObject({
  reviewSessionId: IdentifierDtoSchema,
  reviewFormatVersionIds: z.array(IdentifierDtoSchema).min(1),
  idempotencyKey: z.string().min(1).max(200),
});

export const GenerateCommandDtoSchema = BaseCommandDtoSchema.extend({
  kind: z.literal("generate"),
  assertionIds: z.array(IdentifierDtoSchema).min(1),
  rating: z.number().int().min(1).max(5),
});

export const ParaphraseCommandDtoSchema = BaseCommandDtoSchema.extend({
  kind: z.literal("paraphrase"),
  sourceTextRevisionId: IdentifierDtoSchema,
});

export const ReformatCommandDtoSchema = BaseCommandDtoSchema.extend({
  kind: z.literal("reformat"),
  sourceGenerationId: IdentifierDtoSchema,
});

export const CondenseCommandDtoSchema = BaseCommandDtoSchema.extend({
  kind: z.literal("condense"),
  sourceGenerationId: IdentifierDtoSchema,
  targetMaxChars: z.number().int().positive(),
});

export const ExpandCommandDtoSchema = BaseCommandDtoSchema.extend({
  kind: z.literal("expand"),
  sourceGenerationId: IdentifierDtoSchema,
  targetMinChars: z.number().int().positive(),
});

export const ReviseWordingCommandDtoSchema = BaseCommandDtoSchema.extend({
  kind: z.literal("revise-wording"),
  sourceGenerationId: IdentifierDtoSchema,
  presentationInstruction: z.string().min(1),
});

export const GenerationCommandDtoSchema = z.discriminatedUnion("kind", [
  GenerateCommandDtoSchema,
  ParaphraseCommandDtoSchema,
  ReformatCommandDtoSchema,
  CondenseCommandDtoSchema,
  ExpandCommandDtoSchema,
  ReviseWordingCommandDtoSchema,
]);

export const ResampleGenerationCommandDtoSchema = z.strictObject({
  kind: z.literal("resample"),
  reviewSessionId: IdentifierDtoSchema,
  sourceGenerationId: IdentifierDtoSchema,
  idempotencyKey: z.string().min(1).max(200),
});

export const GenerateRequestDtoSchema = z.strictObject({
  permit: z.string().min(1),
  snapshot: EffectiveConfigurationSnapshotDtoSchema,
  command: z.union([GenerationCommandDtoSchema, ResampleGenerationCommandDtoSchema]),
});

export type GenerationCommandDto = z.infer<typeof GenerationCommandDtoSchema>;
export type ResampleGenerationCommandDto = z.infer<
  typeof ResampleGenerationCommandDtoSchema
>;
export type GenerateRequestDto = z.infer<typeof GenerateRequestDtoSchema>;

