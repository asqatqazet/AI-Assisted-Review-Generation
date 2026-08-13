import {
  buildConfigSnapshot,
  type BuildConfigSnapshotInput,
} from "@review/domain/configuration";
import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";
import { ConfigCache } from "./config-cache.js";
import type { VenueDataLookup } from "./entry-resolver.js";
import { computeEditDistance } from "./outcome.js";

const snapshotInput: BuildConfigSnapshotInput = {
  platform: {
    id: "platform",
    revision: "platform-r1",
    defaults: {
      locale: "en-GB",
      toneGuidelines: "Neutral and plain.",
      entryMode: "invite",
      requireDisclosure: true,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 2,
      bannedTerms: [],
      enabledReviewFormatVersionIds: [],
      enabledCommands: ["generate"],
      monthlyBudgetMicros: 1_000_000,
      alertThresholdPct: 80,
    },
  },
  tenant: {
    id: "tenant-apex",
    revision: "tenant-r1",
    settings: {
      toneGuidelines: "Warm and professional.",
      requireDisclosure: true,
      maxReviewFormatsPerRequest: 2,
      bannedTerms: [],
      enabledReviewFormatVersionIds: [],
      enabledCommands: ["generate"],
    },
    factOptions: [],
  },
  location: {
    id: "loc-central",
    tenantId: "tenant-apex",
    revision: "location-r1",
    overrides: {},
    factOptionAdditions: [],
  },
  tenantName: "Apex Dental",
  locationName: "Central Clinic",
  reviewFormats: [],
  promptVersions: [],
  priceRates: [
    {
      id: "rate-anthropic-sonnet-2026-08",
      provider: "anthropic",
      model: "claude-sonnet",
      inputPerMillionMicros: 3_000_000,
      outputPerMillionMicros: 15_000_000,
      currency: "EUR",
      unit: "token",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveTo: null,
    },
  ],
  providerRouting: {
    primaryProvider: "anthropic",
    primaryModel: "claude-sonnet",
  },
};

const defaultSnapshot = buildConfigSnapshot(snapshotInput);

const mockVenueLookup: VenueDataLookup = {
  findTenantBySlug: (slug) =>
    slug === "apex-dental"
      ? { id: "tenant-apex", name: "Apex Dental", status: "ACTIVE" }
      : undefined,
  findLocationBySlug: (tenantId, slug) =>
    tenantId === "tenant-apex" && slug === "central"
      ? {
          id: "loc-central",
          name: "Central Clinic",
          status: "ACTIVE",
          entryMode: "invite",
        }
      : undefined,
  findVisitToken: (token) =>
    token === "valid-token-123"
      ? {
          id: "tok-1",
          visitId: "visit-1",
          tenantId: "tenant-apex",
          locationId: "loc-central",
          expiresAt: new Date(Date.now() + 3600_000),
          consumedAt: null,
        }
      : undefined,
};

describe("TS-17 Web BFF Integration Suite", () => {
  it("serves entry link survey configuration with ETag caching", async () => {
    let contextCalls = 0;
    const cache = new ConfigCache({
      fetchFn: async () => {
        contextCalls++;
        return new Response(JSON.stringify(defaultSnapshot), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: `"${defaultSnapshot.snapshotId}"`,
          },
        });
      },
    });

    const app = createWebBffApp({
      venueLookup: mockVenueLookup,
      configCache: cache,
    });

    const res1 = await app.request("/s/apex-dental/central?v=valid-token-123");
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.tenantName).toBe("Apex Dental");
    expect(data1.staleConfig).toBe(false);
    expect(contextCalls).toBe(1);

    // Subsequent request uses 304 cache
    const res2 = await app.request("/s/apex-dental/central?v=valid-token-123");
    expect(res2.status).toBe(200);
  });

  it("serves stale config when context service fails after successful initial read", async () => {
    let serviceOnline = true;
    const cache = new ConfigCache({
      fetchFn: async () => {
        if (!serviceOnline) {
          throw new Error("Context Service 503");
        }
        return new Response(JSON.stringify(defaultSnapshot), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: `"${defaultSnapshot.snapshotId}"`,
          },
        });
      },
    });

    const app = createWebBffApp({
      venueLookup: mockVenueLookup,
      configCache: cache,
    });

    // Prime cache
    await app.request("/s/apex-dental/central?v=valid-token-123");

    // Service goes offline
    serviceOnline = false;

    const res = await app.request("/s/apex-dental/central?v=valid-token-123");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.staleConfig).toBe(true);
  });

  it("records outcome and computes normalized edit distance with stripped disclosure", async () => {
    const app = createWebBffApp();

    const originalDraft =
      "The hygienist was thorough and gentle.\n\nAI-assisted review generated for Apex Dental.";
    const editedSubmission =
      "The hygienist was extremely thorough and gentle.\n\nAI-assisted review generated for Apex Dental.";

    const res = await app.request("/api/outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationId: "gen-123",
        disposition: "edited",
        originalDraft,
        submittedText: editedSubmission,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("recorded");
    expect(data.outcome.disposition).toBe("edited");
    expect(data.outcome.normalizedEditDistance).toBeGreaterThan(0);
    expect(data.outcome.normalizedEditDistance).toBeLessThan(1);
  });

  it("computes normalized edit distance correctly", () => {
    const original = "Great service and clean clinic.";
    const identical = "Great service and clean clinic.";
    expect(computeEditDistance(original, identical)).toBe(0);

    const edited = "Great service and very clean clinic.";
    const dist = computeEditDistance(original, edited);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(0.3);
  });
});
