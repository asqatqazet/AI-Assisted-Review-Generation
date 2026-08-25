import { z } from "zod";

import { GenerationWorkloadDtoSchema } from "../generation/generation-request.js";
import { ReviewerDraftRevisionScopeDtoSchema } from "../generation/reviewer-draft-revision.js";
import {
  ReviewerGenerationCommandDtoSchema,
  ReviewerGenerationRejectionCodeDtoSchema,
} from "../generation/reviewer-stream.js";
import { ReviewerDispositionScopeDtoSchema } from "../generation/reviewer-disposition.js";
import { IdentifierDtoSchema } from "../shared/primitives.js";
import { PublicSurveyContextDtoSchema } from "./public-survey-context.js";
import {
  ReviewSessionProgressInputDtoSchema,
  ReviewSessionProgressDtoSchema,
  ReviewSessionProjectionDtoSchema,
} from "./review-session.js";
import {
  ResolveOperatorAccessInvocationDtoSchema,
} from "./operator-access.js";
import {
  AuthorizeConsoleBenchInvocationDtoSchema,
  AuthorizeConsoleReadInvocationDtoSchema,
  ConsoleRequestInvocationDtoSchema,
} from "../console/console-function.js";

const BrowserCapabilityDtoSchema = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);

export const PublicSourceRateLimitPolicyDtoSchema = z.enum([
  "entry-prepare",
  "entry-start",
  "generation",
]);

export const ConsumePublicSourceRateLimitInvocationDtoSchema = z.strictObject({
  operation: z.literal("consume-public-source-rate-limit"),
  input: z.strictObject({
    policy: PublicSourceRateLimitPolicyDtoSchema,
    sourceAddress: z.union([z.ipv4(), z.ipv6()]),
  }),
});

export const PrepareEntryInvocationDtoSchema = z.strictObject({
  operation: z.literal("prepare-entry"),
  input: z.strictObject({
    tenantSlug: IdentifierDtoSchema,
    locationSlug: IdentifierDtoSchema,
    invitationToken: z.string().min(1).optional(),
    tableRef: z.string().regex(/^[\w .-]{1,12}$/u).optional(),
    browserCapability: BrowserCapabilityDtoSchema,
    configurationReleaseId: z.uuid().optional(),
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

export const VerifyEntryInvocationDtoSchema = z.strictObject({
  operation: z.literal("verify-entry"),
  input: z.strictObject({
    entryChallengeHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
    verificationEvidence: z.string().trim().min(1).max(500),
  }),
});

export const ReadReviewSessionInvocationDtoSchema = z.strictObject({
  operation: z.literal("read-review-session"),
  input: z.strictObject({
    reviewSessionHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
  }),
});

export const SaveReviewSessionProgressInvocationDtoSchema = z.strictObject({
  operation: z.literal("save-review-session-progress"),
  input: z.strictObject({
    reviewSessionHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
    expectedEpoch: z.number().int().positive(),
    progress: ReviewSessionProgressInputDtoSchema,
  }),
});

export const ForgetReviewSessionInvocationDtoSchema = z.strictObject({
  operation: z.literal("forget-review-session"),
  input: z.strictObject({
    reviewSessionHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
  }),
});

export const PrepareReviewerDraftRevisionInvocationDtoSchema = z.strictObject({
  operation: z.literal("prepare-reviewer-draft-revision"),
  input: z.strictObject({
    reviewSessionHandle: IdentifierDtoSchema,
    browserCapability: BrowserCapabilityDtoSchema,
    idempotencyKey: z.string().min(1).max(200),
    draftId: IdentifierDtoSchema,
    generationId: IdentifierDtoSchema,
    expectedRevision: z.number().int().positive(),
    textHash: ReviewerDraftRevisionScopeDtoSchema.shape.textHash,
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
    VerifyEntryInvocationDtoSchema,
    ReadReviewSessionInvocationDtoSchema,
    SaveReviewSessionProgressInvocationDtoSchema,
    ForgetReviewSessionInvocationDtoSchema,
    PrepareReviewerDraftRevisionInvocationDtoSchema,
    PrepareReviewerDispositionInvocationDtoSchema,
    PrepareReviewerGenerationInvocationDtoSchema,
    ActivateGenerationInvocationDtoSchema,
    SettleGenerationInvocationDtoSchema,
    ListReconciliationCandidatesInvocationDtoSchema,
    ReleaseReconciledGenerationInvocationDtoSchema,
    ConsumePublicSourceRateLimitInvocationDtoSchema,
    ResolveOperatorAccessInvocationDtoSchema,
    AuthorizeConsoleBenchInvocationDtoSchema,
    AuthorizeConsoleReadInvocationDtoSchema,
    ConsoleRequestInvocationDtoSchema,
  ],
);

/**
 * The Context deployable is packaged once but runs behind two IAM/database
 * identities. These narrowed contracts prevent a caller from treating either
 * Lambda alias as the old combined authority.
 */
export const ReviewerContextFunctionInvocationDtoSchema = z.discriminatedUnion(
  "operation",
  [
    PrepareEntryInvocationDtoSchema,
    ReadEntryChallengeInvocationDtoSchema,
    AdvanceEntryInvocationDtoSchema,
    VerifyEntryInvocationDtoSchema,
    ReadReviewSessionInvocationDtoSchema,
    SaveReviewSessionProgressInvocationDtoSchema,
    ForgetReviewSessionInvocationDtoSchema,
    PrepareReviewerDraftRevisionInvocationDtoSchema,
    PrepareReviewerDispositionInvocationDtoSchema,
    PrepareReviewerGenerationInvocationDtoSchema,
    ActivateGenerationInvocationDtoSchema,
    SettleGenerationInvocationDtoSchema,
    ListReconciliationCandidatesInvocationDtoSchema,
    ReleaseReconciledGenerationInvocationDtoSchema,
    ConsumePublicSourceRateLimitInvocationDtoSchema,
  ],
);

export const ConsoleContextFunctionInvocationDtoSchema = z.discriminatedUnion(
  "operation",
  [
    ResolveOperatorAccessInvocationDtoSchema,
    AuthorizeConsoleBenchInvocationDtoSchema,
    AuthorizeConsoleReadInvocationDtoSchema,
    ConsoleRequestInvocationDtoSchema,
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
      stage: z
        .enum(["entry", "verification-required", "verification-unavailable"])
        .optional(),
      provisionalSelection: z
        .strictObject({
          rating: z.union([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5),
          ]),
          action: z.enum(["generate", "paraphrase"]),
        })
        .nullable()
        .optional(),
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
    z.strictObject({ status: z.literal("verification-required") }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export const VerifyEntryInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("verify-entry"),
  result: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("admitted"),
      reviewSessionHandle: IdentifierDtoSchema,
    }),
    z.strictObject({ status: z.literal("verification-unavailable") }),
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

export const SaveReviewSessionProgressInvocationResultDtoSchema =
  z.strictObject({
    operation: z.literal("save-review-session-progress"),
    result: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("saved"),
        progress: ReviewSessionProgressDtoSchema,
      }),
      z.strictObject({
        status: z.literal("conflict"),
        progress: ReviewSessionProgressDtoSchema,
      }),
      z.strictObject({ status: z.literal("unavailable") }),
    ]),
  });

export const ForgetReviewSessionInvocationResultDtoSchema = z.strictObject({
  operation: z.literal("forget-review-session"),
  result: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("forgotten") }),
    z.strictObject({ status: z.literal("unavailable") }),
  ]),
});

export const PrepareReviewerDraftRevisionInvocationResultDtoSchema =
  z.strictObject({
    operation: z.literal("prepare-reviewer-draft-revision"),
    result: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("authorized"),
        permit: z.string().min(1),
        scope: ReviewerDraftRevisionScopeDtoSchema,
      }),
      z.strictObject({ status: z.literal("rejected") }),
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

export const ConsumePublicSourceRateLimitInvocationResultDtoSchema =
  z.strictObject({
    operation: z.literal("consume-public-source-rate-limit"),
    result: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("allowed") }),
      z.strictObject({
        status: z.literal("limited"),
        retryAfterSeconds: z.number().int().min(1).max(86_400),
      }),
    ]),
  });

export type ContextFunctionInvocationDto = z.infer<
  typeof ContextFunctionInvocationDtoSchema
>;
export type ReviewerContextFunctionInvocationDto = z.infer<
  typeof ReviewerContextFunctionInvocationDtoSchema
>;
export type ConsoleContextFunctionInvocationDto = z.infer<
  typeof ConsoleContextFunctionInvocationDtoSchema
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
export type VerifyEntryInvocationDto = z.infer<
  typeof VerifyEntryInvocationDtoSchema
>;
export type ReadReviewSessionInvocationDto = z.infer<
  typeof ReadReviewSessionInvocationDtoSchema
>;
export type SaveReviewSessionProgressInvocationDto = z.infer<
  typeof SaveReviewSessionProgressInvocationDtoSchema
>;
export type ForgetReviewSessionInvocationDto = z.infer<
  typeof ForgetReviewSessionInvocationDtoSchema
>;
export type PrepareReviewerDraftRevisionInvocationDto = z.infer<
  typeof PrepareReviewerDraftRevisionInvocationDtoSchema
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
export type ConsumePublicSourceRateLimitInvocationDto = z.infer<
  typeof ConsumePublicSourceRateLimitInvocationDtoSchema
>;
export type PublicSourceRateLimitPolicyDto = z.infer<
  typeof PublicSourceRateLimitPolicyDtoSchema
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
export type VerifyEntryInvocationResultDto = z.infer<
  typeof VerifyEntryInvocationResultDtoSchema
>;
export type ReadReviewSessionInvocationResultDto = z.infer<
  typeof ReadReviewSessionInvocationResultDtoSchema
>;
export type SaveReviewSessionProgressInvocationResultDto = z.infer<
  typeof SaveReviewSessionProgressInvocationResultDtoSchema
>;
export type ForgetReviewSessionInvocationResultDto = z.infer<
  typeof ForgetReviewSessionInvocationResultDtoSchema
>;
export type PrepareReviewerDraftRevisionInvocationResultDto = z.infer<
  typeof PrepareReviewerDraftRevisionInvocationResultDtoSchema
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
export type ConsumePublicSourceRateLimitInvocationResultDto = z.infer<
  typeof ConsumePublicSourceRateLimitInvocationResultDtoSchema
>;
