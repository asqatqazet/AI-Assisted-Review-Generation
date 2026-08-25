import { describe, expect, it } from "vitest";

import {
  ForgetReviewSessionInvocationDtoSchema,
  ForgetReviewSessionInvocationResultDtoSchema,
  PrepareReviewerDraftRevisionInvocationDtoSchema,
  PrepareReviewerDraftRevisionInvocationResultDtoSchema,
  ReviewSessionProgressDtoSchema,
  SaveReviewSessionProgressInvocationDtoSchema,
} from "./index.js";

describe("US-02.3 Review Session progress contract", () => {
  it("carries only browser-resumable input under a server epoch", () => {
    expect(
      ReviewSessionProgressDtoSchema.parse({
        epoch: 3,
        phase: "format",
        selectedFactOptionIds: ["fact-service", "fact-food"],
        customerAssertion: "The table was clean.",
        sourceText: "",
        selectedReviewFormatId: "format-short-v1",
      }),
    ).toEqual({
      epoch: 3,
      phase: "format",
      selectedFactOptionIds: ["fact-service", "fact-food"],
      customerAssertion: "The table was clean.",
      sourceText: "",
      selectedReviewFormatId: "format-short-v1",
    });

    expect(
      ReviewSessionProgressDtoSchema.safeParse({
        epoch: 3,
        phase: "format",
        selectedFactOptionIds: ["fact-service", "fact-service"],
        customerAssertion: "",
        sourceText: "",
        selectedReviewFormatId: null,
      }).success,
    ).toBe(false);
  });

  it("does not let the browser supply Tenant, Location, Draft text or authority", () => {
    expect(
      SaveReviewSessionProgressInvocationDtoSchema.safeParse({
        operation: "save-review-session-progress",
        input: {
          reviewSessionHandle: "review-session-a",
          browserCapability: "browser-capability-with-enough-entropy",
          expectedEpoch: 2,
          progress: {
            phase: "format",
            selectedFactOptionIds: ["fact-service"],
            customerAssertion: "",
            sourceText: "",
            selectedReviewFormatId: "format-short-v1",
          },
          tenantId: "tenant-a",
          draftText: "typed text must not become grounding",
        },
      }).success,
    ).toBe(false);
  });

  it("forgets only the Review Session selected by two browser capabilities", () => {
    expect(
      ForgetReviewSessionInvocationDtoSchema.parse({
        operation: "forget-review-session",
        input: {
          reviewSessionHandle: "review-session-a",
          browserCapability: "browser-capability-with-enough-entropy",
        },
      }),
    ).toEqual({
      operation: "forget-review-session",
      input: {
        reviewSessionHandle: "review-session-a",
        browserCapability: "browser-capability-with-enough-entropy",
      },
    });

    expect(
      ForgetReviewSessionInvocationDtoSchema.safeParse({
        operation: "forget-review-session",
        input: {
          reviewSessionHandle: "review-session-a",
          browserCapability: "browser-capability-with-enough-entropy",
          tenantId: "tenant-a",
          reviewSessionId: "internal-session-id",
        },
      }).success,
    ).toBe(false);

    expect(
      ForgetReviewSessionInvocationResultDtoSchema.parse({
        operation: "forget-review-session",
        result: { status: "forgotten" },
      }),
    ).toEqual({
      operation: "forget-review-session",
      result: { status: "forgotten" },
    });
  });

  it("authorizes a Draft revision without accepting browser scope authority", () => {
    expect(
      PrepareReviewerDraftRevisionInvocationDtoSchema.parse({
        operation: "prepare-reviewer-draft-revision",
        input: {
          reviewSessionHandle: "review-session-a",
          browserCapability: "browser-capability-with-enough-entropy",
          idempotencyKey: "draft-save-a",
          draftId: "draft-a",
          generationId: "generation-a",
          expectedRevision: 1,
          textHash: `sha256:${"a".repeat(64)}`,
        },
      }),
    ).toBeDefined();

    expect(
      PrepareReviewerDraftRevisionInvocationDtoSchema.safeParse({
        operation: "prepare-reviewer-draft-revision",
        input: {
          reviewSessionHandle: "review-session-a",
          browserCapability: "browser-capability-with-enough-entropy",
          idempotencyKey: "draft-save-a",
          draftId: "draft-a",
          generationId: "generation-a",
          expectedRevision: 1,
          textHash: `sha256:${"a".repeat(64)}`,
          tenantId: "tenant-a",
        },
      }).success,
    ).toBe(false);

    expect(
      PrepareReviewerDraftRevisionInvocationResultDtoSchema.parse({
        operation: "prepare-reviewer-draft-revision",
        result: { status: "rejected" },
      }),
    ).toEqual({
      operation: "prepare-reviewer-draft-revision",
      result: { status: "rejected" },
    });
  });
});
