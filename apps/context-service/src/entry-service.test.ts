import { describe, expect, it } from "vitest";

import { createEntryService } from "./entry-service.js";

describe("US-01.3 persisted Context entry service", () => {
  it("keeps raw route and browser capabilities outside PostgreSQL", async () => {
    const operations: unknown[] = [];
    const handles = ["entry-route-a", "review-route-a"];
    const service = createEntryService({
      newHandle: () => handles.shift()!,
      hashCapability: async (value) => `sha256:${value}`,
      store: {
        prepare: async (input) => {
          operations.push(input);
          return { status: "prepared" };
        },
        read: async (input) => {
          operations.push(input);
          return {
            status: "ready",
            context: {
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              entryMode: "open-qr",
              ratingRequired: true,
              factOptions: [],
              reviewFormats: [],
            },
          };
        },
        advance: async (input) => {
          operations.push(input);
          return {
            status: "admitted",
            reviewSessionId: "session-a",
            tenantId: "tenant-a",
            locationId: "location-a",
          };
        },
      },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });

    await expect(
      service.prepareEntry({
        tenantSlug: "apex-dental",
        locationSlug: "central",
        browserCapability: "browser-capability-123456789",
      }),
    ).resolves.toEqual({
      status: "prepared",
      entryChallengeHandle: "entry-route-a",
    });
    await expect(
      service.readEntryChallenge({
        entryChallengeHandle: "entry-route-a",
        browserCapability: "browser-capability-123456789",
      }),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(
      service.advanceEntry({
        entryChallengeHandle: "entry-route-a",
        browserCapability: "browser-capability-123456789",
        rating: 4,
        action: "generate",
      }),
    ).resolves.toEqual({
      status: "admitted",
      reviewSessionHandle: "review-route-a",
    });

    expect(operations).toEqual([
      {
        tenantSlug: "apex-dental",
        locationSlug: "central",
        routeHandleHash: "sha256:entry-route-a",
        browserCapabilityHash: "sha256:browser-capability-123456789",
        expiresAt: "2026-08-17T12:05:00.000Z",
      },
      {
        routeHandleHash: "sha256:entry-route-a",
        browserCapabilityHash: "sha256:browser-capability-123456789",
      },
      {
        routeHandleHash: "sha256:entry-route-a",
        browserCapabilityHash: "sha256:browser-capability-123456789",
        reviewSessionRouteHandleHash: "sha256:review-route-a",
        rating: 4,
        action: "GENERATE",
        reviewSessionExpiresAt: "2026-08-17T13:00:00.000Z",
      },
    ]);
  });
});
