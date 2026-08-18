import { z } from "zod";

import { GenerationWorkloadDtoSchema } from "../generation/generation-request.js";
import {
  ReviewerGenerationCommandDtoSchema,
  ReviewerGenerationRejectionCodeDtoSchema,
} from "../generation/reviewer-stream.js";
import { ReviewerDispositionScopeDtoSchema } from "../generation/reviewer-disposition.js";
import { IdentifierDtoSchema } from "../shared/primitives.js";
import { PublicSurveyContextDtoSchema } from "./public-survey-context.js";
import { ReviewSessionProjectionDtoSchema } from "./review-session.js";

const BrowserCapabilityDtoSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);

export const PrepareEntryInvocationDtoSchema = z.strictObject({
  operation: z.literal("prepare-entry"),
  input: z.strictObject({
    tenantSlug: IdentifierDtoSchema,
    locationSlug: IdentifierDtoSchema,
    invitationToken: z.string().min(1).optional(),
    tableRef: z.string().min(1).optional(),
    browserCapability: BrowserCapabilityDtoSchema,
  }),
});

export const ReadEntryChallengeInvocationDtoSchema = z.strictObject({
  operation: z.literal("read-entry-challenge"),
  input: z.strictObject({
    entryChallengeHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
  }),
});

export const AdvanceEntryInvocationDtoSchema = z.strictObject({
  operation: z.literal("advance-entry"),
  input: z.strictObject({
    entryChallengeHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
    rating: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    action: z.enum(["generate", "paraphrase"]),
  }),
});

export const ReadReviewSessionInvocationDtoSchema = z.strictObject({
  operation: z.literal("read-review-session"),
  input: z.strictObject({
    reviewSessionHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
  }),
});

export const PrepareReviewerDispositionInvocationDtoSchema = z.strictObject({
  operation: z.literal("prepare-reviewer-disposition"),
  input: z.strictObject({
    reviewSessionHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
    idempotencyKey: z.string().min(1).max(200),
    draftId: IdentifierDtoSchema,
    generationId: IdentifierDtoSchema,
    finalTextHash: ReviewerDispositionScopeDtoSchema.shape.finalTextHash,
  }),
});

export const PrepareReviewerGenerationInvocationDtoSchema = z.strictObject({
  operation: z.literal("prepare-reviewer-generation"),
  input: z.strictObject({
    reviewSessionHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
    idempotencyKey: z.string().min(1).max(200),
    command: ReviewerGenerationCommandDtoSchema,
  }),
});

export const ActivateGenerationInvocationDtoSchema = z.strictObject({
  operation: z.literal("activate-generation"),
  input: z.strictObject({
    leaseId: IdentifierDtoSchema,
    leaseReceipt: z.string().min(1),
    workload: GenerationWorkloadDtoSchema,
  }),
});

export const SettleGenerationInvocationDtoSchema = z.strictObject({
  operation: z.literal("settle-generation"),
  input: z.strictObject({
    terminalReceipt: z.string().min(1),
    workload: GenerationWorkloadDtoSchema,
  }),
});

const ReconciliationCandidateDtoSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("never-leased"),
    permitJti: IdentifierDtoSchema,
    workload: GenerationWorkloadDtoSchema,
  }),
  z.strictObject({
    kind: z.literal("expired-lease"),
    permitJti: IdentifierDtoSchema,
    leaseId: IdentifierDtoSchema,
    workload: GenerationWorkloadDtoSchema,
  }),
]);

export const ListReconciliationCandidatesInvocationDtoSchema = z.strictObject({
  operation: z.literal("list-reconciliation-candidates"),
  input: z.strictObject({ limit: z.number().int().min(1).max(100) }),
});

export const ReleaseReconciledGenerationInvocationDtoSchema = z.strictObject({
  operation: z.literal("release-reconciled-generation"),
  input: z.discriminatedUnion("outcome", [
    z.strictObject({
      outcome: z.literal("no-lease"),
      permitJti: IdentifierDtoSchema,
      signedStatusReceipt: z.string().min(1),
      workload: GenerationWorkloadDtoSchema,
    }),
    z.strictObject({
      outcome: z.literal("cancelled"),
      permitJti: IdentifierDtoSchema,
      leaseId: IdentifierDtoSchema,
      signedStatusReceipt: z.string().min(1),
      workload: GenerationWorkloadDtoSchema,
    }),
  ]),
});

export const ContextFunctionInvocationDtoSchema = z.discriminatedUnion(
  "operation",
  [
    PrepareEntryInvocationDtoSchema,
    ReadEntryChallengeInvocationDtoSchema,
    AdvanceEntryInvocationDtoSchema,
    ReadReviewSessionInvocationDtoSchema,
    PrepareReviewerDispositionInvocationDtoSchema,
    PrepareReviewerGenerationInvocationDtoSchema,
    ActivateGenerationInvocationDtoSchema,
    SettleGenerationInvocationDtoSchema,
    ListReconciliationCandidatesInvocationDtoSchema,
    ReleaseReconciledGenerationInvocationDtoSchema,
  ],
);

export const PrepareEntryInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("prepare-entry"),
  result: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("prepared"),
      entryChallengeHandle: IdentifierDtoSchema,
    }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export const ReadEntryChallengeInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("read-entry-challenge"),
  result: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("ready"),
      context: PublicSurveyContextDtoSchema,
    }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export const AdvanceEntryInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("advance-entry"),
  result: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("admitted"),
      reviewSessionHandle: IdentifierDtoSchema,
    }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export const ReadReviewSessionInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("read-review-session"),
  result: z.union([
    ReviewSessionProjectionDtoSchema,
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export const PrepareReviewerDispositionInvocationResultDtoSchema =
  z.strictObject({
    operation: z.literal("prepare-reviewer-disposition"),
    result: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("authorized"),
        permit: z.string().min(1),
        scope: ReviewerDispositionScopeDtoSchema,
      }),
      z.strictObject({ status: z.literal("rejected") }),
    ]),
  });

export const PrepareReviewerGenerationInvocationResultDtoSchema =
  z.strictObject({
    operation: z.literal("prepare-reviewer-generation"),
    result: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("prepared"),
        permit: z.string().min(1),
        workload: GenerationWorkloadDtoSchema,
      }),
      z.strictObject({
        status: z.literal("rejected"),
        code: ReviewerGenerationRejectionCodeDtoSchema,
        retryable: z.boolean(),
      }),
    ]),
  });

export const ActivateGenerationInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("activate-generation"),
  result: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("activated"),
      activation: z.string().min(1),
    }),
    z.strictObject({ status: z.literal("rejected") }),
  ]),
});

export const SettleGenerationInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("settle-generation"),
  result: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("settled") }),
    z.strictObject({ status: z.literal("rejected") }),
  ]),
});

export const ListReconciliationCandidatesInvocationResultDtoSchema =
  z.strictObject({
    operation: z.literal("list-reconciliation-candidates"),
    result: z.strictObject({
      candidates: z.array(ReconciliationCandidateDtoSchema).max(100),
    }),
  });

export const ReleaseReconciledGenerationInvocationResultDtoSchema =
  z.strictObject({
    operation: z.literal("release-reconciled-generation"),
    result: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("released") }),
      z.strictObject({ status: z.literal("rejected") }),
    ]),
  });

export type ContextFunctionInvocationDto = z.infer<
  typeof ContextFunctionInvocationDtoSchema
>;
export type PrepareEntryInvocationDto = z.infer<
  typeof PrepareEntryInvocationDtoSchema
>;
export type ReadEntryChallengeInvocationDto = z.infer<
  typeof ReadEntryChallengeInvocationDtoSchema
>;
export type AdvanceEntryInvocationDto = z.infer<
  typeof AdvanceEntryInvocationDtoSchema
>;
export type ReadReviewSessionInvocationDto = z.infer<
  typeof ReadReviewSessionInvocationDtoSchema
>;
export type PrepareReviewerDispositionInvocationDto = z.infer<
  typeof PrepareReviewerDispositionInvocationDtoSchema
>;
export type PrepareReviewerGenerationInvocationDto = z.infer<
  typeof PrepareReviewerGenerationInvocationDtoSchema
>;
export type ActivateGenerationInvocationDto = z.infer<
  typeof ActivateGenerationInvocationDtoSchema
>;
export type SettleGenerationInvocationDto = z.infer<
  typeof SettleGenerationInvocationDtoSchema
>;
export type ListReconciliationCandidatesInvocationDto = z.infer<
  typeof ListReconciliationCandidatesInvocationDtoSchema
>;
export type ReleaseReconciledGenerationInvocationDto = z.infer<
  typeof ReleaseReconciledGenerationInvocationDtoSchema
>;
export type PrepareEntryInvocationResultDto = z.infer<
  typeof PrepareEntryInvocationResultDtoSchema
>;
export type ReadEntryChallengeInvocationResultDto = z.infer<
  typeof ReadEntryChallengeInvocationResultDtoSchema
>;
export type AdvanceEntryInvocationResultDto = z.infer<
  typeof AdvanceEntryInvocationResultDtoSchema
>;
export type ReadReviewSessionInvocationResultDto = z.infer<
  typeof ReadReviewSessionInvocationResultDtoSchema
>;
export type PrepareReviewerDispositionInvocationResultDto = z.infer<
  typeof PrepareReviewerDispositionInvocationResultDtoSchema
>;
export type PrepareReviewerGenerationInvocationResultDto = z.infer<
  typeof PrepareReviewerGenerationInvocationResultDtoSchema
>;
export type ActivateGenerationInvocationResultDto = z.infer<
  typeof ActivateGenerationInvocationResultDtoSchema
>;
export type SettleGenerationInvocationResultDto = z.infer<
  typeof SettleGenerationInvocationResultDtoSchema
>;
export type ListReconciliationCandidatesInvocationResultDto = z.infer<
  typeof ListReconciliationCandidatesInvocationResultDtoSchema
>;
export type ReleaseReconciledGenerationInvocationResultDto = z.infer<
  typeof ReleaseReconciledGenerationInvocationResultDtoSchema
>;
