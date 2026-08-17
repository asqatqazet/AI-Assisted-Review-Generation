import { z } from "zod";

import { EffectiveConfigurationSnapshotDtoSchema } from "../shared/effective-configuration-snapshot.js";
import { IdentifierDtoSchema, IsoDateTimeDtoSchema } from "../shared/primitives.js";

const BoundHashDtoSchema = z.string().min(1).max(200);

export const GenerationActionDtoSchema = z.enum([
  "generate",
  "paraphrase",
  "reformat",
  "condense",
  "expand",
  "revise-wording",
  "resample",
]);

export const GenerateChildCommandDtoSchema = z.strictObject({
  kind: z.literal("generate"),
  assertionIds: z.array(IdentifierDtoSchema).min(1),
  rating: z.number().int().min(1).max(5),
});

export const ParaphraseChildCommandDtoSchema = z.strictObject({
  kind: z.literal("paraphrase"),
  sourceTextRevisionId: IdentifierDtoSchema,
});

export const ReformatChildCommandDtoSchema = z.strictObject({
  kind: z.literal("reformat"),
  sourceGenerationId: IdentifierDtoSchema,
});

export const CondenseChildCommandDtoSchema = z.strictObject({
  kind: z.literal("condense"),
  sourceGenerationId: IdentifierDtoSchema,
  targetMaxChars: z.number().int().positive(),
});

export const ExpandChildCommandDtoSchema = z.strictObject({
  kind: z.literal("expand"),
  sourceGenerationId: IdentifierDtoSchema,
  targetMinChars: z.number().int().positive(),
});

export const ReviseWordingChildCommandDtoSchema = z.strictObject({
  kind: z.literal("revise-wording"),
  sourceGenerationId: IdentifierDtoSchema,
  presentationInstruction: z.string().min(1),
});

export const ResampleChildCommandDtoSchema = z.strictObject({
  kind: z.literal("resample"),
  sourceGenerationId: IdentifierDtoSchema,
});

export const GenerationChildCommandDtoSchema = z.discriminatedUnion("kind", [
  GenerateChildCommandDtoSchema,
  ParaphraseChildCommandDtoSchema,
  ReformatChildCommandDtoSchema,
  CondenseChildCommandDtoSchema,
  ExpandChildCommandDtoSchema,
  ReviseWordingChildCommandDtoSchema,
  ResampleChildCommandDtoSchema,
]);

export const GenerationWorkloadBindingsDtoSchema = z.strictObject({
  tenantId: IdentifierDtoSchema,
  locationId: IdentifierDtoSchema,
  reviewSessionId: IdentifierDtoSchema,
  generationBatchId: IdentifierDtoSchema,
  generationId: IdentifierDtoSchema,
  action: GenerationActionDtoSchema,
  reviewFormatVersionId: IdentifierDtoSchema,
  assertionSetHash: BoundHashDtoSchema,
  requestHash: BoundHashDtoSchema,
  snapshotId: IdentifierDtoSchema,
  snapshotHash: BoundHashDtoSchema,
  providerModelId: IdentifierDtoSchema,
  priceRateId: IdentifierDtoSchema,
  idempotencyKey: z.string().min(1).max(200),
});

export const GenerationWorkloadDtoSchema = z
  .strictObject({
    bindings: GenerationWorkloadBindingsDtoSchema,
    snapshot: EffectiveConfigurationSnapshotDtoSchema,
    command: GenerationChildCommandDtoSchema,
  })
  .superRefine((workload, context) => {
    const checks: readonly [boolean, string, readonly (string | number)[]][] = [
      [
        workload.bindings.tenantId === workload.snapshot.tenantId,
        "Tenant binding does not match the supplied snapshot",
        ["bindings", "tenantId"],
      ],
      [
        workload.bindings.locationId === workload.snapshot.locationId,
        "Location binding does not match the supplied snapshot",
        ["bindings", "locationId"],
      ],
      [
        workload.bindings.snapshotId === workload.snapshot.snapshotId,
        "Snapshot binding does not match the supplied snapshot",
        ["bindings", "snapshotId"],
      ],
      [
        workload.bindings.action === workload.command.kind,
        "Action binding does not match the supplied command",
        ["bindings", "action"],
      ],
      [
        workload.bindings.providerModelId ===
          workload.snapshot.providerRouting.providerModelId,
        "Provider Model binding does not match the supplied snapshot",
        ["bindings", "providerModelId"],
      ],
    ];

    for (const [valid, message, path] of checks) {
      if (!valid) {
        context.addIssue({ code: "custom", message, path: [...path] });
      }
    }

    const boundRate = workload.snapshot.priceRates.find(
      (rate) => rate.id === workload.bindings.priceRateId,
    );
    if (
      boundRate === undefined ||
      boundRate.providerModelId !== workload.bindings.providerModelId ||
      boundRate.provider !== workload.snapshot.providerRouting.primaryProvider ||
      boundRate.model !== workload.snapshot.providerRouting.primaryModel
    ) {
      context.addIssue({
        code: "custom",
        message: "Price Rate binding does not match the routed Provider Model",
        path: ["bindings", "priceRateId"],
      });
    }
  });

export const PrepareGenerationInvocationDtoSchema = z.strictObject({
  operation: z.literal("prepare"),
  permit: z.string().min(1),
  workload: GenerationWorkloadDtoSchema,
});

export const ExecuteGenerationInvocationDtoSchema = z.strictObject({
  operation: z.literal("execute"),
  leaseId: IdentifierDtoSchema,
  activation: z.string().min(1),
  workload: GenerationWorkloadDtoSchema,
});

export const GenerationExecutionScopeDtoSchema = z.strictObject({
  tenantId: IdentifierDtoSchema,
  locationId: IdentifierDtoSchema,
  reviewSessionId: IdentifierDtoSchema,
  generationBatchId: IdentifierDtoSchema,
  generationId: IdentifierDtoSchema,
  permitJti: IdentifierDtoSchema,
});

export const GenerationStatusInvocationDtoSchema = z.strictObject({
  operation: z.literal("status"),
  scope: GenerationExecutionScopeDtoSchema,
});

export const CancelExpiredLeaseInvocationDtoSchema = z.strictObject({
  operation: z.literal("cancel-expired-lease"),
  leaseId: IdentifierDtoSchema,
  scope: GenerationExecutionScopeDtoSchema,
});

export const GenerationFunctionInvocationDtoSchema = z.discriminatedUnion(
  "operation",
  [
    PrepareGenerationInvocationDtoSchema,
    ExecuteGenerationInvocationDtoSchema,
    GenerationStatusInvocationDtoSchema,
    CancelExpiredLeaseInvocationDtoSchema,
  ],
);

export const PrepareGenerationResultDtoSchema = z.strictObject({
  operation: z.literal("prepare"),
  status: z.enum(["leased", "existing"]),
  leaseId: IdentifierDtoSchema,
  leaseExpiresAt: IsoDateTimeDtoSchema,
  leaseReceipt: z.string().min(1),
});

export const GenerationStatusResultDtoSchema = z.strictObject({
  operation: z.literal("status"),
  state: z.enum(["no-lease", "leased", "running", "cancelled", "terminal"]),
  signedStatusReceipt: z.string().min(1),
});

export const CancelExpiredLeaseResultDtoSchema = z.strictObject({
  operation: z.literal("cancel-expired-lease"),
  state: z.enum(["cancelled", "running", "terminal", "no-lease"]),
  signedStatusReceipt: z.string().min(1),
});

export type GenerationActionDto = z.infer<typeof GenerationActionDtoSchema>;
export type GenerationChildCommandDto = z.infer<
  typeof GenerationChildCommandDtoSchema
>;
export type GenerationWorkloadDto = z.infer<typeof GenerationWorkloadDtoSchema>;
export type PrepareGenerationInvocationDto = z.infer<
  typeof PrepareGenerationInvocationDtoSchema
>;
export type ExecuteGenerationInvocationDto = z.infer<
  typeof ExecuteGenerationInvocationDtoSchema
>;
export type GenerationStatusInvocationDto = z.infer<
  typeof GenerationStatusInvocationDtoSchema
>;
export type CancelExpiredLeaseInvocationDto = z.infer<
  typeof CancelExpiredLeaseInvocationDtoSchema
>;
export type GenerationFunctionInvocationDto = z.infer<
  typeof GenerationFunctionInvocationDtoSchema
>;
