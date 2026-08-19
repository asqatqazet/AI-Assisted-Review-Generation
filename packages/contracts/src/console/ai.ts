import { z } from "zod";

import { IdentifierDtoSchema, IsoDateTimeDtoSchema } from "../shared/primitives.js";
import { ConsoleActionKeyDtoSchema } from "./overview.js";
import { ConsoleScopeDtoSchema, MoneyDtoSchema } from "./primitives.js";

export const ConsolePromptStatusDtoSchema = z.enum([
  "draft",
  "candidate",
  "in-experiment",
  "retired",
]);

export const ConsolePromptVersionDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  action: ConsoleActionKeyDtoSchema,
  version: z.number().int().min(1),
  hash: z.string().min(1).max(128),
  status: ConsolePromptStatusDtoSchema,
  createdAt: IsoDateTimeDtoSchema,
  createdBy: z.string().max(320).nullable(),
  evaluationScore: z.number().min(0).max(1).nullable(),
});

export const ConsolePromptsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  prompts: z.array(ConsolePromptVersionDtoSchema).max(500),
});

export const ConsolePromptDetailDtoSchema = ConsolePromptVersionDtoSchema.extend({
  body: z.string().max(50_000),
  variables: z.array(z.string().min(1).max(80)).max(100),
  /** Historical versions are immutable; editing forks a new draft version. */
  readOnly: z.literal(true),
});

export const ConsolePromptComparisonDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  left: ConsolePromptDetailDtoSchema,
  right: ConsolePromptDetailDtoSchema,
});

export const ConsoleExperimentVariantDtoSchema = z.strictObject({
  promptVersionId: IdentifierDtoSchema,
  promptVersionHash: z.string().min(1).max(128),
  weightPct: z.number().int().min(0).max(100),
  generations: z.number().int().min(0),
  accepted: z.number().int().min(0),
  acceptanceRate: z.number().min(0).max(1),
});

export const ConsoleExperimentDtoSchema = z.strictObject({
  id: IdentifierDtoSchema,
  action: ConsoleActionKeyDtoSchema,
  status: z.enum(["draft", "running", "stopped"]),
  createdAt: IsoDateTimeDtoSchema,
  startedAt: IsoDateTimeDtoSchema.nullable(),
  stoppedAt: IsoDateTimeDtoSchema.nullable(),
  variants: z.array(ConsoleExperimentVariantDtoSchema).max(10),
  /**
   * A running experiment may only be stopped. Editing variants, weights or the
   * tested action mid-flight would make the collected results uninterpretable.
   */
  editable: z.boolean(),
  stoppable: z.boolean(),
  /**
   * Outcome counts come from the execution plane. When it is unreachable the
   * variants are still shown, but the counts are not presented as zero.
   */
  metricsAvailable: z.boolean(),
});

export const ConsoleExperimentsDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  editable: z.boolean(),
  experiments: z.array(ConsoleExperimentDtoSchema).max(200),
  availablePrompts: z.array(ConsolePromptVersionDtoSchema).max(500),
});

export const ConsoleBenchInputDtoSchema = z.strictObject({
  action: ConsoleActionKeyDtoSchema,
  styleId: IdentifierDtoSchema,
  promptVersionId: IdentifierDtoSchema,
  provider: IdentifierDtoSchema,
  keywordIds: z.array(IdentifierDtoSchema).max(100),
  freeText: z.string().max(4000),
  sourceText: z.string().max(20_000),
});

export const ConsoleBenchFormDtoSchema = z.strictObject({
  scope: ConsoleScopeDtoSchema,
  actions: z
    .array(
      z.strictObject({
        key: ConsoleActionKeyDtoSchema,
        label: z.string().min(1).max(120),
        requiredInputs: z.array(z.string().min(1).max(80)).max(20),
      }),
    )
    .max(50),
  styles: z
    .array(
      z.strictObject({
        id: IdentifierDtoSchema,
        name: z.string().min(1).max(120),
        supportedActions: z.array(ConsoleActionKeyDtoSchema).max(20),
      }),
    )
    .max(200),
  promptVersions: z.array(ConsolePromptVersionDtoSchema).max(500),
  providers: z
    .array(
      z.strictObject({
        key: IdentifierDtoSchema,
        displayName: z.string().min(1).max(120),
        isTestProvider: z.boolean(),
      }),
    )
    .max(50),
  keywords: z
    .array(
      z.strictObject({
        id: IdentifierDtoSchema,
        label: z.string().min(1).max(200),
      }),
    )
    .max(1000),
  prefill: ConsoleBenchInputDtoSchema.nullable(),
  /** ADM-ANA-04: a replay that lost a dependency must say so, not substitute. */
  missingReplayDependencies: z.array(z.string().min(1).max(120)).max(20),
});

export const ConsoleBenchResultDtoSchema = z.strictObject({
  generationId: IdentifierDtoSchema,
  output: z.string().max(50_000),
  claims: z
    .array(
      z.strictObject({
        id: IdentifierDtoSchema,
        text: z.string().max(2000),
        supportedBy: z.array(z.string().max(200)).max(20),
      }),
    )
    .max(200),
  removedClaims: z
    .array(
      z.strictObject({
        text: z.string().max(2000),
        reason: z.string().max(400),
      }),
    )
    .max(200),
  provider: IdentifierDtoSchema,
  model: IdentifierDtoSchema,
  latencyMs: z.number().int().min(0),
  estimatedCost: MoneyDtoSchema,
  /** Bench work is never production analytics, experiment traffic or billing. */
  isBench: z.literal(true),
});

export type ConsolePromptsDto = z.infer<typeof ConsolePromptsDtoSchema>;
export type ConsolePromptVersionDto = z.infer<
  typeof ConsolePromptVersionDtoSchema
>;
export type ConsolePromptComparisonDto = z.infer<
  typeof ConsolePromptComparisonDtoSchema
>;
export type ConsoleExperimentsDto = z.infer<typeof ConsoleExperimentsDtoSchema>;
export type ConsoleExperimentDto = z.infer<typeof ConsoleExperimentDtoSchema>;
export type ConsoleBenchFormDto = z.infer<typeof ConsoleBenchFormDtoSchema>;
export type ConsoleBenchInputDto = z.infer<typeof ConsoleBenchInputDtoSchema>;
export type ConsoleBenchResultDto = z.infer<typeof ConsoleBenchResultDtoSchema>;
