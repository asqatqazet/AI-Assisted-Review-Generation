import { describe, expect, it } from "vitest";

import { EffectiveConfigurationSnapshotDtoSchema } from "./effective-configuration-snapshot.js";

describe("Effective Configuration Snapshot wire value", () => {
  it("carries every resolved setting required by the execution plane", () => {
    const settings = {
      locale: "en-GB" as const,
      toneGuidelines: "Warm, specific and first person.",
      entryMode: "invite" as const,
      requireDisclosure: true,
      requireVerifiedExperience: true,
      maxReviewFormatsPerRequest: 1,
      bannedTerms: ["guaranteed"],
      enabledReviewFormatVersionIds: ["format-a@1"],
      enabledCommands: ["generate" as const],
      monthlyBudgetMicros: 1_000_000,
      alertThresholdPct: 80,
    };

    const parsed = EffectiveConfigurationSnapshotDtoSchema.parse({
      snapshotId: "snapshot-a",
      schemaVersion: 2,
      tenantId: "tenant-a",
      locationId: "location-a",
      tenantName: "Tenant A",
      locationName: "Location A",
      settings,
      provenance: {},
      factOptions: [],
      reviewFormats: [],
      promptVersions: [],
      priceRates: [],
      providerRouting: {
        version: "routing-v1",
        providerModelId: "provider-model-a",
        primaryProvider: "fake",
        primaryModel: "fake-v1",
      },
    });

    expect(parsed.settings).toEqual(settings);
  });
});
