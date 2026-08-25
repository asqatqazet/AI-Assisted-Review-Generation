import { describe, expect, it } from "vitest";

import {
  createInvokedReviewerDraftRevisionContextPort,
  createInvokedReviewerDraftRevisionExecutionPort,
} from "./reviewer-draft-revision-function.ports.js";

describe("reviewer Draft revision private Function adapters", () => {
  it("asks Context to derive and sign scope from browser capabilities", async () => {
    let received: unknown;
    const port = createInvokedReviewerDraftRevisionContextPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "prepare-reviewer-draft-revision",
          result: { status: "rejected" },
        };
      },
    });

    await expect(
      port.authorize({
        reviewSessionHandle: "review-session-handle",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "draft-save-a",
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        textHash: `sha256:${"a".repeat(64)}`,
      }),
    ).resolves.toEqual({ status: "rejected" });
    expect(received).toEqual({
      operation: "prepare-reviewer-draft-revision",
      input: {
        reviewSessionHandle: "review-session-handle",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "draft-save-a",
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        textHash: `sha256:${"a".repeat(64)}`,
      },
    });
  });

  it("records only the Context-signed revision through Generation", async () => {
    let received: unknown;
    const port = createInvokedReviewerDraftRevisionExecutionPort({
      invoke: async (request) => {
        received = request;
        return {
          operation: "record-reviewer-draft-revision",
          status: "recorded",
          revision: 2,
        };
      },
    });
    const scope = {
      tenantId: "tenant-a",
      locationId: "location-a",
      reviewSessionId: "review-session-a",
      draftId: "draft-a",
      generationId: "generation-a",
      expectedRevision: 1,
      textHash: `sha256:${"a".repeat(64)}`,
      idempotencyKey: "draft-save-a",
    };

    await expect(
      port.record({
        permit: "signed-draft-revision-permit",
        scope,
        text: "The team was exceptionally attentive.",
      }),
    ).resolves.toEqual({ status: "recorded", revision: 2 });
    expect(received).toEqual({
      operation: "record-reviewer-draft-revision",
      permit: "signed-draft-revision-permit",
      scope,
      text: "The team was exceptionally attentive.",
    });
  });
});
