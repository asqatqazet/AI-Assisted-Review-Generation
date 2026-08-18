import { describe, expect, it } from "vitest";

import { createReviewerDispositionHandler } from "./reviewer-disposition-handler.js";

const scope = {
  tenantId: "tenant-a",
  locationId: "location-a",
  reviewSessionId: "review-session-a",
  draftId: "draft-a",
  generationId: "generation-a",
  finalTextHash: "sha256:final-text",
  idempotencyKey: "disposition-a",
};

describe("US-03.6 Generation reviewer Disposition handler", () => {
  it("verifies Context authority before recording a reviewer revision", async () => {
    const operations: string[] = [];
    const handler = createReviewerDispositionHandler({
      verifier: {
        verifyDispositionPermit: async (permit, receivedScope, finalText) => {
          operations.push("verify");
          expect({ permit, receivedScope, finalText }).toEqual({
            permit: "signed-disposition-permit",
            receivedScope: scope,
            finalText: "The team was exceptionally attentive.",
          });
          return { permitJti: "permit-jti-a" };
        },
      },
      store: {
        record: async (input) => {
          operations.push("record");
          expect(input).toEqual({
            ...scope,
            permitJti: "permit-jti-a",
            finalText: "The team was exceptionally attentive.",
          });
          return {
            kind: "edited",
            revision: 2,
            normalizedEditDistance: 0.21,
          };
        },
      },
    });

    await expect(
      handler({
        operation: "record-reviewer-disposition",
        permit: "signed-disposition-permit",
        scope,
        finalText: "The team was exceptionally attentive.",
      }),
    ).resolves.toEqual({
      operation: "record-reviewer-disposition",
      status: "recorded",
      kind: "edited",
      revision: 2,
      normalizedEditDistance: 0.21,
    });
    expect(operations).toEqual(["verify", "record"]);
  });
});
