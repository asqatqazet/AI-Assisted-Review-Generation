import { describe, expect, it } from "vitest";

import { EntryChallengeProjectionDtoSchema } from "./index.js";

const publicProjection = {
  status: "ready",
  entryChallengeHandle: "entry-challenge-demo",
  csrfToken: "csrf-token-with-at-least-thirty-two-characters",
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
} as const;

describe("Entry Challenge projection contract", () => {
  it("accepts the public projection and rejects internal scope identifiers", () => {
    expect([
      EntryChallengeProjectionDtoSchema.safeParse(publicProjection).success,
      EntryChallengeProjectionDtoSchema.safeParse({
        ...publicProjection,
        tenantId: "tenant-apex",
        locationId: "location-central",
      }).success,
    ]).toEqual([true, false]);
  });
});
