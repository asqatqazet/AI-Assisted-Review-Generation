import {
  PrepareReviewerDraftRevisionInvocationDtoSchema,
  PrepareReviewerDraftRevisionInvocationResultDtoSchema,
} from "@review/contracts/context";
import {
  RecordReviewerDraftRevisionInvocationDtoSchema,
  RecordReviewerDraftRevisionResultDtoSchema,
} from "@review/contracts/generation";

import type { ReviewerDraftRevisionContextPort } from "../ports/reviewer-draft-revision.port.js";
import type { ReviewerDraftRevisionExecutionPort } from "../ports/reviewer-draft-revision.port.js";
import type { ContextFunctionInvoker } from "./context-function.port.js";
import type { GenerationFunctionInvoker } from "./generation-function.port.js";

export function createInvokedReviewerDraftRevisionContextPort(
  invoker: ContextFunctionInvoker,
): ReviewerDraftRevisionContextPort {
  return {
    async authorize(input) {
      const request = PrepareReviewerDraftRevisionInvocationDtoSchema.parse({
        operation: "prepare-reviewer-draft-revision",
        input,
      });
      const response =
        PrepareReviewerDraftRevisionInvocationResultDtoSchema.parse(
          await invoker.invoke(request),
        );
      return response.result;
    },
  };
}

export function createInvokedReviewerDraftRevisionExecutionPort(
  invoker: GenerationFunctionInvoker,
): ReviewerDraftRevisionExecutionPort {
  return {
    async record(input) {
      const request = RecordReviewerDraftRevisionInvocationDtoSchema.parse({
        operation: "record-reviewer-draft-revision",
        ...input,
      });
      const response = RecordReviewerDraftRevisionResultDtoSchema.parse(
        await invoker.invoke(request),
      );
      return { status: response.status, revision: response.revision };
    },
  };
}
