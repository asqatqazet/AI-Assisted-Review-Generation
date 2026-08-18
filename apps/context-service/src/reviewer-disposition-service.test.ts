import type { PostgresReviewSessionReader } from "@review/db/admission";
import { describe, expect, it } from "vitest";

import { createReviewerDispositionService } from "./reviewer-disposition-service.js";

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

describe("US-03.6 Context reviewer Disposition authorization", () => {
  it("derives scope from the browser-bound Review Session and signs exact immutable claims", async () => {
    let signed: unknown;
    const reader = {
      read: async () => storedSession,
      disconnect: async () => undefined,
    } satisfies PostgresReviewSessionReader;
    const service = createReviewerDispositionService({
      reader,
      authority: {
        signDispositionPermit: async (claims) => {
          signed = claims;
          return "signed-disposition-permit";
        },
      },
      hashCapability: async (value) => `hash:${value}`,
      newPermitJti: () => "permit-jti-a",
      now: () => new Date("2026-08-18T14:00:00.000Z"),
    });

    await expect(
      service.prepareReviewerDisposition({
        reviewSessionHandle: "review-session-handle",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "disposition-a",
        draftId: "draft-a",
        generationId: "generation-a",
        finalTextHash: "sha256:final-text",
      }),
    ).resolves.toEqual({
      status: "authorized",
      permit: "signed-disposition-permit",
      scope: {
        tenantId: "tenant-a",
        locationId: "location-a",
        reviewSessionId: "review-session-a",
        draftId: "draft-a",
        generationId: "generation-a",
        finalTextHash: "sha256:final-text",
        idempotencyKey: "disposition-a",
      },
    });
    expect(signed).toEqual({
      permitJti: "permit-jti-a",
      expiresAt: "2026-08-18T14:01:00.000Z",
      scope: {
        tenantId: "tenant-a",
        locationId: "location-a",
        reviewSessionId: "review-session-a",
        draftId: "draft-a",
        generationId: "generation-a",
        finalTextHash: "sha256:final-text",
        idempotencyKey: "disposition-a",
      },
    });
  });

  it("does not authorize a handle outside the browser capability", async () => {
    const service = createReviewerDispositionService({
      reader: {
        read: async () => null,
        disconnect: async () => undefined,
      },
      authority: {
        signDispositionPermit: async () => {
          throw new Error("must not sign");
        },
      },
      hashCapability: async (value) => `hash:${value}`,
      newPermitJti: () => "permit-jti-a",
    });

    await expect(
      service.prepareReviewerDisposition({
        reviewSessionHandle: "wrong-handle",
        browserCapability: "browser-capability-123456789",
        idempotencyKey: "disposition-a",
        draftId: "draft-a",
        generationId: "generation-a",
        finalTextHash: "sha256:final-text",
      }),
    ).resolves.toEqual({ status: "rejected" });
  });
});
