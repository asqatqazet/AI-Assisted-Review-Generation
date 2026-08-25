import {
  ActivateGenerationInvocationDtoSchema,
  ActivateGenerationInvocationResultDtoSchema,
  AdvanceEntryInvocationDtoSchema,
  AdvanceEntryInvocationResultDtoSchema,
  ConsumePublicSourceRateLimitInvocationDtoSchema,
  ConsumePublicSourceRateLimitInvocationResultDtoSchema,
  type ContextFunctionInvocationDto,
  ForgetReviewSessionInvocationDtoSchema,
  ForgetReviewSessionInvocationResultDtoSchema,
  ListReconciliationCandidatesInvocationDtoSchema,
  ListReconciliationCandidatesInvocationResultDtoSchema,
  PrepareEntryInvocationDtoSchema,
  PrepareEntryInvocationResultDtoSchema,
  PrepareReviewerDispositionInvocationDtoSchema,
  PrepareReviewerDispositionInvocationResultDtoSchema,
  PrepareReviewerGenerationInvocationDtoSchema,
  PrepareReviewerGenerationInvocationResultDtoSchema,
  ReadEntryChallengeInvocationDtoSchema,
  ReadEntryChallengeInvocationResultDtoSchema,
  ReadReviewSessionInvocationDtoSchema,
  ReadReviewSessionInvocationResultDtoSchema,
  SaveReviewSessionProgressInvocationDtoSchema,
  SaveReviewSessionProgressInvocationResultDtoSchema,
  ReleaseReconciledGenerationInvocationDtoSchema,
  ReleaseReconciledGenerationInvocationResultDtoSchema,
  ResolveOperatorAccessInvocationDtoSchema,
  ResolveOperatorAccessInvocationResultDtoSchema,
  SettleGenerationInvocationDtoSchema,
  SettleGenerationInvocationResultDtoSchema,
  VerifyEntryInvocationDtoSchema,
  VerifyEntryInvocationResultDtoSchema,
} from "@review/contracts/context";
import {
  AuthorizeConsoleBenchInvocationDtoSchema,
  AuthorizeConsoleBenchInvocationResultDtoSchema,
  AuthorizeConsoleReadInvocationDtoSchema,
  AuthorizeConsoleReadInvocationResultDtoSchema,
  ConsoleRequestInvocationDtoSchema,
  ConsoleRequestInvocationResultDtoSchema,
} from "@review/contracts/console";

import type { ConsolePort } from "../ports/console.port.js";
import type {
  ConsoleBenchAuthorizationPort,
  ConsoleExecutionAuthorizationPort,
} from "../ports/console-execution.port.js";
import type { ContextPort } from "../ports/context.port.js";
import type { OperatorContextPort } from "../ports/operator-context.port.js";
import type { PublicSourceRateLimitPort } from "../ports/public-source-rate-limit.port.js";
import type { ReviewerGenerationContextPort } from "../ports/reviewer-generation.port.js";
import type { ReviewerDispositionContextPort } from "../ports/reviewer-disposition.port.js";
import type { ReconciliationContextPort } from "../reconciliation.js";

export interface ContextFunctionInvoker {
  invoke(request: ContextFunctionInvocationDto): Promise<unknown>;
}

export function createInvokedPublicSourceRateLimitPort(
  invoker: ContextFunctionInvoker,
): PublicSourceRateLimitPort {
  return {
    async consume(input) {
      const request = ConsumePublicSourceRateLimitInvocationDtoSchema.parse({
        operation: "consume-public-source-rate-limit",
        input,
      });
      const response =
        ConsumePublicSourceRateLimitInvocationResultDtoSchema.parse(
          await invoker.invoke(request),
        );
      return response.result;
    },
  };
}

export function createInvokedOperatorContextPort(
  invoker: ContextFunctionInvoker,
): OperatorContextPort {
  return {
    async resolveAccess(identity) {
      const request = ResolveOperatorAccessInvocationDtoSchema.parse({
        operation: "resolve-operator-access",
        input: { identity },
      });
      const response = ResolveOperatorAccessInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}

export function createInvokedConsolePort(
  invoker: ContextFunctionInvoker,
): ConsolePort {
  return {
    async request(input) {
      const request = ConsoleRequestInvocationDtoSchema.parse({
        operation: "console-request",
        input,
      });
      const response = ConsoleRequestInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}

export function createInvokedConsoleExecutionAuthorizationPort(
  invoker: ContextFunctionInvoker,
): ConsoleExecutionAuthorizationPort {
  return {
    async authorize(input) {
      const request = AuthorizeConsoleReadInvocationDtoSchema.parse({
        operation: "authorize-console-read",
        input,
      });
      const response = AuthorizeConsoleReadInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}

export function createInvokedConsoleBenchAuthorizationPort(
  invoker: ContextFunctionInvoker,
): ConsoleBenchAuthorizationPort {
  return {
    async authorize(input) {
      const request = AuthorizeConsoleBenchInvocationDtoSchema.parse({
        operation: "authorize-console-bench",
        input,
      });
      const response = AuthorizeConsoleBenchInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}

export function createInvokedReviewerGenerationContextPort(
  invoker: ContextFunctionInvoker,
): ReviewerGenerationContextPort {
  return {
    async prepare(input) {
      const request = PrepareReviewerGenerationInvocationDtoSchema.parse({
        operation: "prepare-reviewer-generation",
        input,
      });
      const response = PrepareReviewerGenerationInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async activate(input) {
      const request = ActivateGenerationInvocationDtoSchema.parse({
        operation: "activate-generation",
        input,
      });
      const response = ActivateGenerationInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async settle(input) {
      const request = SettleGenerationInvocationDtoSchema.parse({
        operation: "settle-generation",
        input,
      });
      const response = SettleGenerationInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}

export function createInvokedReviewerDispositionContextPort(
  invoker: ContextFunctionInvoker,
): ReviewerDispositionContextPort {
  return {
    async authorize(input) {
      const request = PrepareReviewerDispositionInvocationDtoSchema.parse({
        operation: "prepare-reviewer-disposition",
        input,
      });
      const response = PrepareReviewerDispositionInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}

export function createInvokedReconciliationContextPort(
  invoker: ContextFunctionInvoker,
): ReconciliationContextPort {
  return {
    async settle(input) {
      const request = SettleGenerationInvocationDtoSchema.parse({
        operation: "settle-generation",
        input,
      });
      const response = SettleGenerationInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async listCandidates(input) {
      const request = ListReconciliationCandidatesInvocationDtoSchema.parse({
        operation: "list-reconciliation-candidates",
        input,
      });
      const response =
        ListReconciliationCandidatesInvocationResultDtoSchema.parse(
          await invoker.invoke(request),
        );
      return response.result.candidates;
    },

    async release(input) {
      const request = ReleaseReconciledGenerationInvocationDtoSchema.parse({
        operation: "release-reconciled-generation",
        input,
      });
      const response =
        ReleaseReconciledGenerationInvocationResultDtoSchema.parse(
          await invoker.invoke(request),
        );
      return response.result;
    },
  };
}

export function createInvokedContextPort(
  invoker: ContextFunctionInvoker,
  options: { readonly configurationReleaseId?: string } = {},
): ContextPort {
  return {
    async prepareEntry(input) {
      const request = PrepareEntryInvocationDtoSchema.parse({
        operation: "prepare-entry",
        input: {
          ...input,
          ...(options.configurationReleaseId === undefined
            ? {}
            : { configurationReleaseId: options.configurationReleaseId }),
        },
      });
      const response = PrepareEntryInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async readEntryChallenge(input) {
      const request = ReadEntryChallengeInvocationDtoSchema.parse({
        operation: "read-entry-challenge",
        input,
      });
      const response = ReadEntryChallengeInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async advanceEntry(input) {
      const request = AdvanceEntryInvocationDtoSchema.parse({
        operation: "advance-entry",
        input,
      });
      const response = AdvanceEntryInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async verifyEntry(input) {
      const request = VerifyEntryInvocationDtoSchema.parse({
        operation: "verify-entry",
        input,
      });
      const response = VerifyEntryInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async readReviewSession(input) {
      const request = ReadReviewSessionInvocationDtoSchema.parse({
        operation: "read-review-session",
        input,
      });
      const response = ReadReviewSessionInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },

    async saveReviewSessionProgress(input) {
      const request = SaveReviewSessionProgressInvocationDtoSchema.parse({
        operation: "save-review-session-progress",
        input,
      });
      const response =
        SaveReviewSessionProgressInvocationResultDtoSchema.parse(
          await invoker.invoke(request),
        );
      return response.result;
    },

    async forgetReviewSession(input) {
      const request = ForgetReviewSessionInvocationDtoSchema.parse({
        operation: "forget-review-session",
        input,
      });
      const response = ForgetReviewSessionInvocationResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return response.result;
    },
  };
}
