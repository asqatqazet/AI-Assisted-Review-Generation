import { describe, expect, it } from "vitest";

import {
  resetLocationOverride,
  resolveEffectiveConfig,
  type ConfigurationResolutionError,
  type FactOption,
  type LocationConfiguration,
  type PlatformConfiguration,
  type TenantConfiguration,
} from "./effective-config.js";

const factOption = (overrides: Partial<FactOption> = {}): FactOption => ({
  id: "fact-1",
  version: "fact-1-v1",
  owner: { scope: "tenant", tenantId: "tenant-a" },
  categoryId: "category-service",
  proposition: "The service was attentive.",
  polarity: "positive",
  locale: "en-GB",
  active: true,
  sortOrder: 10,
  ...overrides,
});

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
    minimumFactSelections: 1,
    maximumCustomerAssertionChars: 500,
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

describe("resolveEffectiveConfig override lifecycle", () => {
  it("rejects unknown Location override keys", () => {
    expect(() =>
      resolveEffectiveConfig({
        platform,
        tenant,
        location: {
          ...location,
          overrides: { requireDisclosure: false, surpriseSetting: true },
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ConfigurationResolutionError>>({
        code: "unknown-location-override",
      }),
    );
  });

  it("rejects a Location resolved against a different Tenant", () => {
    expect(() =>
      resolveEffectiveConfig({
        platform,
        tenant,
        location: { ...location, tenantId: "tenant-b" },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ConfigurationResolutionError>>({
        code: "location-tenant-mismatch",
      }),
    );
  });

  it("deletes an override when it is reset", () => {
    const overridden: LocationConfiguration = {
      ...location,
      overrides: { requireDisclosure: false },
    };

    const reset = resetLocationOverride(overridden, "requireDisclosure");

    expect(reset.overrides).not.toHaveProperty("requireDisclosure");
    expect(
      resolveEffectiveConfig({ platform, tenant, location: reset }).value
        .requireDisclosure,
    ).toBe(true);
  });

  it("inherits a later Tenant change after an override is reset", () => {
    const reset = resetLocationOverride(
      { ...location, overrides: { requireDisclosure: false } },
      "requireDisclosure",
    );
    const changedTenant: TenantConfiguration = {
      ...tenant,
      revision: "tenant-r8",
      settings: { ...tenant.settings, requireDisclosure: false },
    };

    const result = resolveEffectiveConfig({
      platform,
      tenant: changedTenant,
      location: reset,
    });

    expect(result.value.requireDisclosure).toBe(false);
    expect(result.provenance.requireDisclosure).toEqual({
      scope: "tenant",
      sourceId: "tenant-a",
      revision: "tenant-r8",
    });
  });

  it("keeps an explicit equal-valued override insulated from later Tenant changes", () => {
    const explicitlyOverridden: LocationConfiguration = {
      ...location,
      overrides: { requireDisclosure: true },
    };
    const changedTenant: TenantConfiguration = {
      ...tenant,
      revision: "tenant-r8",
      settings: { ...tenant.settings, requireDisclosure: false },
    };

    const result = resolveEffectiveConfig({
      platform,
      tenant: changedTenant,
      location: explicitlyOverridden,
    });

    expect(result.value.requireDisclosure).toBe(true);
    expect(result.provenance.requireDisclosure.scope).toBe("location");
  });
});

describe("resolveEffectiveConfig Fact Option merge", () => {
  it("sorts Tenant Fact Options by sortOrder", () => {
    const result = resolveEffectiveConfig({
      platform,
      tenant: {
        ...tenant,
        factOptions: [
          factOption({ id: "fact-later", sortOrder: 20 }),
          factOption({ id: "fact-earlier", sortOrder: 10 }),
        ],
      },
      location,
    });

    expect(result.value.factOptions.map(({ id }) => id)).toEqual([
      "fact-earlier",
      "fact-later",
    ]);
  });

  it("places Location additions after the Tenant set regardless of sortOrder", () => {
    const result = resolveEffectiveConfig({
      platform,
      tenant: {
        ...tenant,
        factOptions: [factOption({ id: "tenant-fact", sortOrder: 100 })],
      },
      location: {
        ...location,
        factOptionAdditions: [
          factOption({
            id: "location-fact",
            sortOrder: 1,
            owner: {
              scope: "location",
              tenantId: "tenant-a",
              locationId: "location-a",
            },
          }),
        ],
      },
    });

    expect(result.value.factOptions.map(({ id }) => id)).toEqual([
      "tenant-fact",
      "location-fact",
    ]);
  });

  it("sorts Location additions by sortOrder within their scope", () => {
    const locationOwner: FactOption["owner"] = {
      scope: "location",
      tenantId: "tenant-a",
      locationId: "location-a",
    };
    const result = resolveEffectiveConfig({
      platform,
      tenant,
      location: {
        ...location,
        factOptionAdditions: [
          factOption({ id: "location-later", sortOrder: 20, owner: locationOwner }),
          factOption({ id: "location-earlier", sortOrder: 10, owner: locationOwner }),
        ],
      },
    });

    expect(result.value.factOptions.map(({ id }) => id)).toEqual([
      "location-earlier",
      "location-later",
    ]);
  });

  it("rejects a Tenant Fact Option owned by another Tenant", () => {
    expect(() =>
      resolveEffectiveConfig({
        platform,
        tenant: {
          ...tenant,
          factOptions: [
            factOption({
              owner: { scope: "tenant", tenantId: "tenant-b" },
            }),
          ],
        },
        location,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ConfigurationResolutionError>>({
        code: "invalid-fact-option-owner",
      }),
    );
  });

  it("rejects a Location addition owned by another Location", () => {
    expect(() =>
      resolveEffectiveConfig({
        platform,
        tenant,
        location: {
          ...location,
          factOptionAdditions: [
            factOption({
              owner: {
                scope: "location",
                tenantId: "tenant-a",
                locationId: "location-b",
              },
            }),
          ],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ConfigurationResolutionError>>({
        code: "invalid-fact-option-owner",
      }),
    );
  });

  it("rejects duplicate Fact Option identities across scopes", () => {
    expect(() =>
      resolveEffectiveConfig({
        platform,
        tenant: {
          ...tenant,
          factOptions: [factOption({ id: "duplicate-fact" })],
        },
        location: {
          ...location,
          factOptionAdditions: [
            factOption({
              id: "duplicate-fact",
              owner: {
                scope: "location",
                tenantId: "tenant-a",
                locationId: "location-a",
              },
            }),
          ],
        },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ConfigurationResolutionError>>({
        code: "duplicate-fact-option",
      }),
    );
  });
});
