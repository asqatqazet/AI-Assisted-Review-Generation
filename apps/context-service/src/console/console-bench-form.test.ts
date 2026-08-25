import type { EffectiveConfigurationSnapshotDto } from "@review/contracts/shared";
import { describe, expect, it } from "vitest";

import { projectPublishedConsoleBenchForm } from "./console-bench-form.js";

const snapshot = {
  snapshotId: "snapshot-a",
  schemaVersion: 2,
  tenantId: "tenant-a",
  locationId: "location-a",
  tenantName: "Tenant A",
  locationName: "Location A",
  settings: {
    locale: "en-GB",
    toneGuidelines: "Warm.",
    entryMode: "invite",
    requireDisclosure: false,
    requireVerifiedExperience: false,
    maxReviewFormatsPerRequest: 1,
    minimumFactSelections: 1,
    maximumCustomerAssertionChars: 4000,
    bannedTerms: [],
    enabledReviewFormatVersionIds: ["format-generate", "format-expand"],
    enabledCommands: ["generate", "expand"],
    monthlyBudgetMicros: 0,
    alertThresholdPct: 80,
  },
  provenance: {},
  factOptions: [
    {
      id: "fact-tenant",
      version: "fact-tenant@1",
      label: "Warm welcome",
      owner: { scope: "tenant", tenantId: "tenant-a" },
      proposition: "Attentive team.",
      categoryId: "service",
      polarity: "positive",
      locale: "en-GB",
      active: true,
      sortOrder: 1,
    },
    {
      id: "fact-other-location",
      version: "fact-other-location@1",
      owner: {
        scope: "location",
        tenantId: "tenant-a",
        locationId: "location-b",
      },
      proposition: "Other Location.",
      categoryId: "service",
      polarity: "positive",
      locale: "en-GB",
      active: true,
      sortOrder: 2,
    },
  ],
  reviewFormats: [
    {
      id: "format-generate",
      key: "short",
      version: "1.0.0",
      displayName: "Short",
      targetPlatform: "google",
      locale: "any",
      description: { "en-GB": "Short" },
      sample: { "en-GB": "Attentive team." },
      constraints: {
        minChars: 1,
        maxChars: 400,
        paragraphs: 1,
        emojiPolicy: "none",
        secondPerson: false,
      },
      supportedCommands: ["generate"],
    },
    {
      id: "format-expand",
      key: "long",
      version: "1.0.0",
      displayName: "Long",
      targetPlatform: "google",
      locale: "any",
      description: { "en-GB": "Long" },
      sample: { "en-GB": "Long review." },
      constraints: {
        minChars: 1,
        maxChars: 1000,
        paragraphs: 1,
        emojiPolicy: "none",
        secondPerson: false,
      },
      supportedCommands: ["expand"],
    },
  ],
  promptVersions: [
    {
      id: "prompt-generate",
      hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      key: "review.generate",
      commandKind: "generate",
      body: "Use assertions.",
      variables: [],
    },
    {
      id: "prompt-expand",
      hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      key: "review.expand",
      commandKind: "expand",
      body: "Expand.",
      variables: [],
    },
  ],
  priceRates: [
    {
      id: "price-fake",
      providerModelId: "provider-model-fake",
      provider: "fake",
      model: "fake-v1",
      inputPerMillionMicros: 0,
      outputPerMillionMicros: 0,
      currency: "EUR",
      unit: "token",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-02-01T00:00:00.000Z",
    },
  ],
  providerRouting: {
    version: "routing-v1",
    providerModelId: "provider-model-fake",
    primaryProvider: "fake",
    primaryModel: "fake-v1",
  },
} satisfies EffectiveConfigurationSnapshotDto;

describe("published Console Bench form", () => {
  it("offers only executable Actions and exact-scope sources from one snapshot", () => {
    expect(
      projectPublishedConsoleBenchForm({
        snapshot,
        tenantId: "tenant-a",
        locationId: "location-a",
        now: new Date("2026-08-24T10:00:00.000Z"),
      }),
    ).toEqual({
      actions: [
        {
          key: "generate",
          label: "Generate",
          requiredInputs: ["factOptionsOrFreeText"],
        },
      ],
      styles: [
        {
          id: "format-generate",
          name: "Short",
          supportedActions: ["generate"],
        },
      ],
      promptVersions: [
        {
          id: "prompt-generate",
          action: "generate",
          key: "review.generate",
          hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
      providers: [
        { key: "fake", displayName: "FakeProvider", isTestProvider: true },
      ],
      keywords: [{ id: "fact-tenant", label: "Warm welcome" }],
    });
  });

  it("closes when the snapshot is not an active zero-cost FakeProvider route", () => {
    expect(
      projectPublishedConsoleBenchForm({
        snapshot: {
          ...snapshot,
          providerRouting: {
            ...snapshot.providerRouting,
            primaryProvider: "openai",
            primaryModel: "gpt-5-mini",
          },
        },
        tenantId: "tenant-a",
        locationId: "location-a",
        now: new Date("2026-08-24T10:00:00.000Z"),
      }),
    ).toBeNull();
  });
});
