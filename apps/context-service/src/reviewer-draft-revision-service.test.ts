import { describe, expect, it } from "vitest";

import { createReviewerDraftRevisionService } from "./reviewer-draft-revision-service.js";

const storedSession = {
  reviewSessionId: "review-session-a",
  tenantId: "tenant-a",
  locationId: "location-a",
  tenantDisplayName: "Apex Dental",
  locationDisplayName: "Central Clinic",
  locale: "en-GB" as const,
  rating: 4 as const,
  action: "generate" as const,
  requirements: {
    minimumFactSelections: 1,
    maximumReviewFormatsPerGeneration: 1 as const,
    maximumCustomerAssertionChars: 500,
  },
  factOptions: [],
  reviewFormats: [],
  destinations: [],
};
const textHash = `sha256:${"a".repeat(64)}`;

describe("US-02.3 Context reviewer Draft revision authorization", () => {
  it("derives scope from the browser binding and signs the expected revision and text hash", async () => {
    let signed: unknown;
    const service = createReviewerDraftRevisionService({
      reader: {
        read: async () => storedSession,
      },
      authority: {
        signDraftRevisionPermit: async (claims) => {
          signed = claims;
          return "signed-draft-revision-permit";
        },
      },
      hashCapability: async (value) => `hash:${value}`,
      newPermitJti: () => "draft-revision-permit-a",
      now: () => new Date("2026-08-23T20:00:00.000Z"),
    });

    await expect(
      service.prepareReviewerDraftRevision({
        reviewSessionHandle: "review-session-handle",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "draft-save-a",
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        textHash,
      }),
    ).resolves.toEqual({
      status: "authorized",
      permit: "signed-draft-revision-permit",
      scope: {
        tenantId: "tenant-a",
        locationId: "location-a",
        reviewSessionId: "review-session-a",
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        textHash,
        idempotencyKey: "draft-save-a",
      },
    });
    expect(signed).toEqual({
      permitJti: "draft-revision-permit-a",
      expiresAt: "2026-08-23T20:01:00.000Z",
      scope: {
        tenantId: "tenant-a",
        locationId: "location-a",
        reviewSessionId: "review-session-a",
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        textHash,
        idempotencyKey: "draft-save-a",
      },
    });
  });

  it("does not authorize a Draft through an unrelated browser binding", async () => {
    const service = createReviewerDraftRevisionService({
      reader: { read: async () => null },
      authority: {
        signDraftRevisionPermit: async () => {
          throw new Error("must not sign");
        },
      },
      hashCapability: async (value) => `hash:${value}`,
      newPermitJti: () => "draft-revision-permit-a",
    });

    await expect(
      service.prepareReviewerDraftRevision({
        reviewSessionHandle: "wrong-handle",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "draft-save-a",
        draftId: "draft-a",
        generationId: "generation-a",
        expectedRevision: 1,
        textHash,
      }),
    ).resolves.toEqual({ status: "rejected" });
  });
});
