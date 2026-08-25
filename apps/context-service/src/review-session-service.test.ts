import type { PostgresReviewSessionReader } from "@review/db/admission";
import { describe, expect, it } from "vitest";

import { createReviewSessionService } from "./review-session-service.js";

describe("US-01.3 Context Review Session application module", () => {
  it("hashes browser secrets before reading a tenant-scoped projection", async () => {
    let received: unknown;
    const reader = {
      read: async (hashes) => {
        received = hashes;
        return {
          reviewSessionId: "internal-session-uuid",
          tenantId: "internal-tenant-uuid",
          locationId: "internal-location-uuid",
          tenantDisplayName: "Apex Dental",
          locationDisplayName: "Central Clinic",
          locale: "en-GB" as const,
          rating: 4 as const,
          action: "generate" as const,
          requirements: {
            minimumFactSelections: 1,
            maximumReviewFormatsPerGeneration: 1,
            maximumCustomerAssertionChars: 500,
          },
          factOptions: [],
          reviewFormats: [] as const,
          destinations: [] as const,
        };
      },
      disconnect: async () => undefined,
    } satisfies PostgresReviewSessionReader;
    const service = createReviewSessionService({ reader });

    await expect(
      service.readReviewSession({
        reviewSessionHandle: "review-session-demo",
        browserCapability: "browser-capability-with-enough-entropy",
      }),
    ).resolves.toEqual({
      status: "ready",
      reviewSessionHandle: "review-session-demo",
      tenantDisplayName: "Apex Dental",
      locationDisplayName: "Central Clinic",
      locale: "en-GB",
      rating: 4,
      action: "generate",
      requirements: {
        minimumFactSelections: 1,
        maximumReviewFormatsPerGeneration: 1,
        maximumCustomerAssertionChars: 500,
      },
      factOptions: [],
      reviewFormats: [],
      destinations: [],
    });
    expect(received).toEqual({
      routeHandleHash:
        "sha256:bd5312a1c09c2c78e4db03f80a7aa2e8018c52817b61d1fbb234ad56a8a595fc",
      browserCapabilityHash:
        "sha256:5b2fb1bae6ec175a1d631850a7dbaec61196721c721acea33f7e0acdd74f2be0",
    });
  });

  it("saves browser-bound progress through hashed capabilities and returns the next epoch", async () => {
    let received: unknown;
    const progressStore = {
      read: async () => ({ status: "unavailable" as const }),
      save: async (input: unknown) => {
        received = input;
        return {
          status: "saved" as const,
          progress: {
            epoch: 3,
            phase: "format" as const,
            selectedFactOptionIds: ["fact-attentive"],
            customerAssertion: "The reception was calm.",
            sourceText: "",
            selectedReviewFormatId: "format-concise-v1",
          },
        };
      },
      forget: async () => ({ status: "unavailable" as const }),
      disconnect: async () => undefined,
    };
    const service = createReviewSessionService({
      reader: {
        read: async () => null,
      },
      progressStore,
    });

    await expect(
      service.saveReviewSessionProgress({
        reviewSessionHandle: "review-session-demo",
        browserCapability: "browser-capability-with-enough-entropy",
        expectedEpoch: 2,
        progress: {
          phase: "format",
          selectedFactOptionIds: ["fact-attentive"],
          customerAssertion: "The reception was calm.",
          sourceText: "",
          selectedReviewFormatId: "format-concise-v1",
        },
      }),
    ).resolves.toEqual({
      status: "saved",
      progress: {
        epoch: 3,
        phase: "format",
        selectedFactOptionIds: ["fact-attentive"],
        customerAssertion: "The reception was calm.",
        sourceText: "",
        selectedReviewFormatId: "format-concise-v1",
      },
    });
    expect(received).toEqual({
      routeHandleHash:
        "sha256:bd5312a1c09c2c78e4db03f80a7aa2e8018c52817b61d1fbb234ad56a8a595fc",
      browserCapabilityHash:
        "sha256:5b2fb1bae6ec175a1d631850a7dbaec61196721c721acea33f7e0acdd74f2be0",
      expectedEpoch: 2,
      progress: {
        phase: "format",
        selectedFactOptionIds: ["fact-attentive"],
        customerAssertion: "The reception was calm.",
        sourceText: "",
        selectedReviewFormatId: "format-concise-v1",
      },
    });
  });

  it("revokes only the exact browser-bound Review Session capability", async () => {
    let received: unknown;
    const progressStore = {
      read: async () => ({ status: "unavailable" as const }),
      save: async () => ({ status: "unavailable" as const }),
      forget: async (input: unknown) => {
        received = input;
        return { status: "forgotten" as const };
      },
      disconnect: async () => undefined,
    };
    const service = createReviewSessionService({
      reader: { read: async () => null },
      progressStore,
    });

    await expect(
      service.forgetReviewSession({
        reviewSessionHandle: "review-session-demo",
        browserCapability: "browser-capability-with-enough-entropy",
      }),
    ).resolves.toEqual({ status: "forgotten" });
    expect(received).toEqual({
      routeHandleHash:
        "sha256:bd5312a1c09c2c78e4db03f80a7aa2e8018c52817b61d1fbb234ad56a8a595fc",
      browserCapabilityHash:
        "sha256:5b2fb1bae6ec175a1d631850a7dbaec61196721c721acea33f7e0acdd74f2be0",
    });
  });
});
