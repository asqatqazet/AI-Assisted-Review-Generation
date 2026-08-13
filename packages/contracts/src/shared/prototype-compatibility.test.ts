import { describe, expect, it } from "vitest";

import {
  PrototypeLocationDtoSchema,
  PrototypeStyleManifestDtoSchema,
  PrototypeTenantDtoSchema,
} from "./prototype-compatibility.js";

describe("prototype compatibility DTOs", () => {
  it("parses the load-bearing fixture fields at the wire seam", () => {
    const tenant = PrototypeTenantDtoSchema.parse({
      slug: "brightsmile",
      locale: "en-GB",
      plan: "Practice",
      status: "active",
      createdAt: "2026-02-03",
      business: {
        name: "Brightsmile Dental",
        category: "Dental practice",
        description: "A three-surgery practice.",
        toneGuidelines: "Plain and calm.",
      },
      entryMode: "invite",
      policy: {
        requireDisclosure: true,
        requireVerifiedExperience: true,
        maxDraftsPerSession: 2,
        bannedTerms: ["guaranteed"],
      },
      keywordCategories: [{ id: "service", label: "Service" }],
      enabledStyles: ["concise-blurb"],
      enabledActions: ["generate"],
      contextVersion: 7,
      monthlyBudgetMicros: 40_000_000,
      monthToDateCostMicros: 26_480_000,
      alertThresholdPct: 90,
    });

    const location = PrototypeLocationDtoSchema.parse({
      slug: "downtown",
      tenantSlug: "brightsmile",
      name: "Downtown Clinic",
      address: "18 Bayham Street",
      active: true,
      entryMode: null,
      destinations: ["google"],
      platformIds: { googlePlaceId: "place-a" },
      overrides: {},
      keywordAdditions: [],
      counters: { issued: 1, opened: 1, completed: 1 },
    });

    const format = PrototypeStyleManifestDtoSchema.parse({
      key: "concise-blurb",
      version: "1.4.0",
      displayName: "Concise blurb",
      targetPlatform: "google",
      locale: "any",
      description: { "en-GB": "Two or three sentences." },
      constraints: {
        minChars: 40,
        maxChars: 420,
        paragraphs: 1,
        emojiPolicy: "none",
        secondPerson: false,
      },
      supportedActions: ["generate", "paraphrase"],
      sample: { "en-GB": "A grounded example." },
    });

    expect([tenant.slug, location.slug, format.key]).toEqual([
      "brightsmile",
      "downtown",
      "concise-blurb",
    ]);
  });
});
