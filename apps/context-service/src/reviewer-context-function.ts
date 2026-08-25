import { ReviewerContextFunctionInvocationDtoSchema } from "@review/contracts/context";

import {
  createContextFunctionHandler,
  type ContextEntryService,
  type ContextPublicSourceRateLimiter,
} from "./context-function.js";

/**
 * Reviewer Lambda interface. Parsing the narrowed contract before delegating
 * means Console operations are rejected before any application module runs.
 */
export function createReviewerContextFunctionHandler({
  entryService,
  publicSourceRateLimiter,
}: {
  readonly entryService: ContextEntryService;
  readonly publicSourceRateLimiter: ContextPublicSourceRateLimiter;
}): (event: unknown) => Promise<unknown> {
  const handler = createContextFunctionHandler({
    entryService,
    publicSourceRateLimiter,
  });
  return async (event) => {
    ReviewerContextFunctionInvocationDtoSchema.parse(event);
    return await handler(event);
  };
}
