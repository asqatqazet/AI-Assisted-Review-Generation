import { describe, expect, it } from "vitest";

import { createReviewerDraftRevisionHandler } from "./reviewer-draft-revision-handler.js";

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

describe("US-02.3 Generation reviewer Draft revision handler", () => {
  it("verifies Context authority before recording a reviewer edit", async () => {
    const operations: string[] = [];
    const handler = createReviewerDraftRevisionHandler({
      verifier: {
        verifyDraftRevisionPermit: async (permit, receivedScope, text) => {
          operations.push("verify");
          expect({ permit, receivedScope, text }).toEqual({
            permit: "signed-draft-revision-permit",
            receivedScope: scope,
            text: "The team was exceptionally attentive.",
          });
          return { permitJti: "draft-revision-permit-a" };
        },
      },
      store: {
        saveRevision: async (input) => {
          operations.push("record");
          expect(input).toEqual({
            ...scope,
            permitJti: "draft-revision-permit-a",
            text: "The team was exceptionally attentive.",
          });
          return { status: "recorded", revision: 2 };
        },
      },
    });

    await expect(
      handler({
        operation: "record-reviewer-draft-revision",
        permit: "signed-draft-revision-permit",
        scope,
        text: "The team was exceptionally attentive.",
      }),
    ).resolves.toEqual({
      operation: "record-reviewer-draft-revision",
      status: "recorded",
      revision: 2,
    });
    expect(operations).toEqual(["verify", "record"]);
  });

  it("returns an optimistic conflict without overwriting a newer revision", async () => {
    const handler = createReviewerDraftRevisionHandler({
      verifier: {
        verifyDraftRevisionPermit: async () => ({
          permitJti: "draft-revision-permit-a",
        }),
      },
      store: {
        saveRevision: async () => ({ status: "conflict", revision: 3 }),
      },
    });

    await expect(
      handler({
        operation: "record-reviewer-draft-revision",
        permit: "signed-draft-revision-permit",
        scope,
        text: "A stale edit.",
      }),
    ).resolves.toEqual({
      operation: "record-reviewer-draft-revision",
      status: "conflict",
      revision: 3,
    });
  });
});
