import { describe, expect, it } from "vitest";

import { GenerateRequestDtoSchema } from "./generation-request.js";

const snapshot = {
  snapshotId: "snap-01",
  schemaVersion: 1,
  tenantId: "tenant-a",
  locationId: "location-a",
  locale: "en-GB",
  tenantName: "Brightsmile Dental",
  locationName: "Downtown Clinic",
  provenance: {
    locale: { scope: "tenant", sourceId: "tenant-a", revision: "tenant-r7" },
  },
  policy: {
    requireDisclosure: true,
    requireVerifiedExperience: true,
    maxReviewFormatsPerRequest: 2,
    bannedTerms: ["guaranteed"],
  },
  factOptions: [],
  reviewFormats: [],
  promptVersions: [],
  priceRates: [],
  providerRouting: { primaryProvider: "anthropic", primaryModel: "model-a" },
};

describe("GenerateRequestDtoSchema", () => {
  it("accepts a bound snapshot as a value on a valid Generate command", () => {
    const result = GenerateRequestDtoSchema.parse({
      permit: "signed-permit",
      snapshot,
      command: {
        kind: "generate",
        reviewSessionId: "session-a",
        assertionIds: ["assertion-a"],
        rating: 5,
        reviewFormatVersionIds: ["format-a@1"],
        idempotencyKey: "request-1",
      },
    });

    expect(result.snapshot.tenantId).toBe("tenant-a");
    expect(result.command.kind).toBe("generate");
  });

  it("rejects a Generate command without assertions", () => {
    const result = GenerateRequestDtoSchema.safeParse({
      permit: "signed-permit",
      snapshot,
      command: {
        kind: "generate",
        assertionIds: [],
        rating: 5,
        reviewSessionId: "session-a",
        reviewFormatVersionIds: ["format-a@1"],
        idempotencyKey: "request-1",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a request that replaces the snapshot value with a lookup reference", () => {
    const result = GenerateRequestDtoSchema.safeParse({
      permit: "signed-permit",
      snapshotId: "snap-01",
      command: {
        kind: "generate",
        reviewSessionId: "session-a",
        assertionIds: ["assertion-a"],
        rating: 5,
        reviewFormatVersionIds: ["format-a@1"],
        idempotencyKey: "request-1",
      },
    });

    expect(result.success).toBe(false);
  });
});
