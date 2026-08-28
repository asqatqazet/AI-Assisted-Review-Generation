import type {
  GenerationWorkloadDto,
  ReviewerDraftDto,
  ReviewerGenerationCommandDto,
} from "@review/contracts/generation";

export type ReviewerGenerationRejectionCode =
  | "GROUNDING_REJECTED"
  | "POLICY_REJECTED"
  | "FORMAT_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "BUDGET_EXCEEDED"
  | "CANCELLED"
  | "GENERATION_FAILED";

export interface ReviewerGenerationContextPort {
  prepare(input: {
    readonly reviewSessionHandle: string;
    readonly browserCapability: string;
    readonly idempotencyKey: string;
    readonly command: ReviewerGenerationCommandDto;
  }): Promise<
    | {
        readonly status: "prepared";
        readonly permit: string;
        readonly workload: GenerationWorkloadDto;
      }
    | {
        readonly status: "rejected";
        readonly code: ReviewerGenerationRejectionCode;
        readonly retryable: boolean;
        readonly retryAfterSeconds?: number | undefined;
      }
  >;
  activate(input: {
    readonly leaseId: string;
    readonly leaseReceipt: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<
    | { readonly status: "activated"; readonly activation: string }
    | { readonly status: "rejected" }
  >;
  settle(input: {
    readonly terminalReceipt: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<
    { readonly status: "settled" } | { readonly status: "rejected" }
  >;
}

export type ReviewerGenerationExecutionEvent =
  | {
      readonly type: "progress";
      readonly phase: "queued" | "generating" | "validating" | "persisting";
      readonly elapsedSeconds: number;
    }
  | { readonly type: "heartbeat"; readonly elapsedSeconds: number }
  | {
      readonly type: "terminal";
      readonly status: "completed";
      readonly terminalReceipt: string;
      readonly draft: ReviewerDraftDto;
    }
  | {
      readonly type: "terminal";
      readonly status: "rejected";
      readonly terminalReceipt: string;
      readonly code: ReviewerGenerationRejectionCode;
      readonly retryable: boolean;
      readonly retryAfterSeconds?: number | undefined;
    };

export interface ReviewerGenerationExecutionPort {
  prepare(input: {
    readonly permit: string;
    readonly workload: GenerationWorkloadDto;
  }): Promise<{
    readonly leaseId: string;
    readonly leaseReceipt: string;
  }>;
  execute(input: {
    readonly leaseId: string;
    readonly activation: string;
    readonly workload: GenerationWorkloadDto;
    readonly signal: AbortSignal;
  }): AsyncIterable<ReviewerGenerationExecutionEvent>;
}
