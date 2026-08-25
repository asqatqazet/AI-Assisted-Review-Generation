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
            stage: "entry",
            provisionalSelection: null,
            context: {
              tenantDisplayName: "Apex Dental",
              locationDisplayName: "Central Clinic",
              locale: "en-GB",
              entryMode: "open-qr",
              ratingRequired: true,
              requirements: {
                minimumFactSelections: 1,
          maximumReviewFormatsPerGeneration: 1,
          maximumCustomerAssertionChars: 500,
              },
              factOptions: [],
              reviewFormats: [],
              destinations: [],
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
        verify: async () => ({ status: "unavailable" }),
      },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });

    await expect(
      service.prepareEntry({
        tenantSlug: "apex-dental",
        locationSlug: "central",
        browserCapability: "browser-capability-123456789",
        configurationReleaseId: "018fd2d8-7f24-4d21-8b10-7dd983cfc487",
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
        configurationReleaseId: "018fd2d8-7f24-4d21-8b10-7dd983cfc487",
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
        reviewSessionExpiresAt: "2026-09-16T12:00:00.000Z",
        browserBindingExpiresAt: "2026-08-18T12:00:00.000Z",
      },
    ]);
  });

  it("hashes an Invitation Token and display-only table reference before persistence", async () => {
    const operations: unknown[] = [];
    const service = createEntryService({
      newHandle: () => "entry-route-invite",
      hashCapability: async (value) => `sha256:${value}`,
      store: {
        prepare: async (input) => {
          operations.push(input);
          return { status: "prepared" };
        },
        read: async () => ({ status: "unavailable" }),
        advance: async () => ({ status: "unavailable" }),
        verify: async () => ({ status: "unavailable" }),
      },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });

    await expect(
      service.prepareEntry({
        tenantSlug: "apex-dental",
        locationSlug: "central",
        invitationToken: "raw-invitation-token",
        tableRef: "Table 12-A",
        browserCapability: "browser-capability-123456789",
      }),
    ).resolves.toEqual({
      status: "prepared",
      entryChallengeHandle: "entry-route-invite",
    });
    expect(operations).toEqual([
      {
        tenantSlug: "apex-dental",
        locationSlug: "central",
        invitationTokenHash: "sha256:raw-invitation-token",
        routeHandleHash: "sha256:entry-route-invite",
        browserCapabilityHash: "sha256:browser-capability-123456789",
        tableRefHash: "sha256:Table 12-A",
        expiresAt: "2026-08-17T12:05:00.000Z",
      },
    ]);
  });

  it("keeps a verification-required selection pending with separate session and browser lifetimes", async () => {
    const operations: unknown[] = [];
    const handles = ["candidate-review-route", "verified-review-route"];
    const service = createEntryService({
      newHandle: () => handles.shift()!,
      hashCapability: async (value) => `sha256:${value}`,
      store: {
        prepare: async () => ({ status: "unavailable" }),
        read: async () => ({ status: "unavailable" }),
        advance: async (input) => {
          operations.push(input);
          return { status: "verification-required" };
        },
        verify: async (input) => {
          operations.push(input);
          return {
            status: "admitted",
            reviewSessionId: "review-session-a",
            tenantId: "tenant-a",
            locationId: "location-a",
          };
        },
      },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
    });

    await expect(
      service.advanceEntry({
        entryChallengeHandle: "entry-route-invite",
        browserCapability: "browser-capability-123456789",
        rating: 4,
        action: "paraphrase",
      }),
    ).resolves.toEqual({ status: "verification-required" });
    await expect(
      service.verifyEntry({
        entryChallengeHandle: "entry-route-invite",
        browserCapability: "browser-capability-123456789",
        verificationEvidence: "Booking-A7",
      }),
    ).resolves.toEqual({
      status: "admitted",
      reviewSessionHandle: "verified-review-route",
    });
    expect(operations).toEqual([
      {
        routeHandleHash: "sha256:entry-route-invite",
        browserCapabilityHash: "sha256:browser-capability-123456789",
        reviewSessionRouteHandleHash: "sha256:candidate-review-route",
        rating: 4,
        action: "PARAPHRASE",
        reviewSessionExpiresAt: "2026-09-16T12:00:00.000Z",
        browserBindingExpiresAt: "2026-08-18T12:00:00.000Z",
      },
      {
        routeHandleHash: "sha256:entry-route-invite",
        browserCapabilityHash: "sha256:browser-capability-123456789",
        reviewSessionRouteHandleHash: "sha256:verified-review-route",
        verificationEvidenceHash: "sha256:Booking-A7",
        reviewSessionExpiresAt: "2026-09-16T12:00:00.000Z",
        browserBindingExpiresAt: "2026-08-18T12:00:00.000Z",
      },
    ]);
  });

  it("returns the browser-bound pending selection when a challenge is refreshed", async () => {
    const service = createEntryService({
      newHandle: () => "unused",
      hashCapability: async (value) => `sha256:${value}`,
      store: {
        prepare: async () => ({ status: "unavailable" }),
        read: async () => ({
          status: "ready",
          stage: "verification-unavailable",
          provisionalSelection: { rating: 2, action: "paraphrase" },
          context: {
            tenantDisplayName: "Apex Dental",
            locationDisplayName: "Central Clinic",
            locale: "en-GB",
            entryMode: "invite",
            ratingRequired: true,
            requirements: {
              minimumFactSelections: 1,
              maximumReviewFormatsPerGeneration: 1,
              maximumCustomerAssertionChars: 500,
            },
            factOptions: [],
            reviewFormats: [],
            destinations: [],
          },
        }),
        advance: async () => ({ status: "unavailable" }),
        verify: async () => ({ status: "unavailable" }),
      },
    });

    await expect(
      service.readEntryChallenge({
        entryChallengeHandle: "entry-route-invite",
        browserCapability: "browser-capability-123456789",
      }),
    ).resolves.toMatchObject({
      status: "ready",
      stage: "verification-unavailable",
      provisionalSelection: { rating: 2, action: "paraphrase" },
    });
  });
});
