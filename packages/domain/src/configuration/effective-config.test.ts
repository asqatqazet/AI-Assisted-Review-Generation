import { describe, expect, it } from "vitest";

import {
  resolveEffectiveConfig,
  type LocationConfiguration,
  type PlatformConfiguration,
  type TenantConfiguration,
} from "./effective-config.js";

const platform: PlatformConfiguration = {
  id: "platform",
  revision: "platform-r1",
  defaults: {
    locale: "en-GB",
    toneGuidelines: "Neutral and plain.",
    entryMode: "invite",
    requireDisclosure: false,
    requireVerifiedExperience: false,
    maxReviewFormatsPerRequest: 1,
    bannedTerms: [],
    enabledReviewFormatVersionIds: [],
    enabledCommands: ["generate"],
    monthlyBudgetMicros: 1_000_000,
    alertThresholdPct: 80,
  },
};

const tenant: TenantConfiguration = {
  id: "tenant-a",
  revision: "tenant-r7",
  settings: {
    toneGuidelines: "Calm and first person.",
    requireDisclosure: true,
    maxReviewFormatsPerRequest: 2,
  },
  factOptions: [],
};

const location: LocationConfiguration = {
  id: "location-a",
  tenantId: "tenant-a",
  revision: "location-r3",
  overrides: {},
  factOptionAdditions: [],
};

describe("resolveEffectiveConfig scope precedence", () => {
  it.each([
    {
      name: "uses a Platform default when no narrower scope sets the field",
      tenantValue: tenant,
      locationValue: location,
      expectedValue: "invite",
      expectedScope: "platform",
      expectedRevision: "platform-r1",
    },
    {
      name: "uses a Tenant value over its Platform default",
      tenantValue: tenant,
      locationValue: location,
      expectedValue: true,
      expectedScope: "tenant",
      expectedRevision: "tenant-r7",
    },
    {
      name: "uses a Location value over its Tenant value",
      tenantValue: tenant,
      locationValue: {
        ...location,
        overrides: { requireDisclosure: false },
      },
      expectedValue: false,
      expectedScope: "location",
      expectedRevision: "location-r3",
    },
    {
      name: "retains Location ownership when an override equals its parent",
      tenantValue: tenant,
      locationValue: {
        ...location,
        overrides: { requireDisclosure: true },
      },
      expectedValue: true,
      expectedScope: "location",
      expectedRevision: "location-r3",
    },
  ])("$name", ({ tenantValue, locationValue, expectedValue, expectedScope, expectedRevision }) => {
    const result = resolveEffectiveConfig({
      platform,
      tenant: tenantValue,
      location: locationValue,
    });

    const field = expectedValue === "invite" ? "entryMode" : "requireDisclosure";
    expect(result.value[field]).toBe(expectedValue);
    expect(result.provenance[field]).toEqual({
      scope: expectedScope,
      sourceId:
        expectedScope === "platform"
          ? "platform"
          : expectedScope === "tenant"
            ? "tenant-a"
            : "location-a",
      revision: expectedRevision,
    });
  });
});
