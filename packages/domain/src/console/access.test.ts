import { describe, expect, it } from "vitest";

import {
  authorizeConsoleScope,
  deriveConsoleCapabilities,
  deriveConsoleRole,
  type ConsoleGrants,
} from "./access.js";

const tenantGrant = {
  tenantId: "tenant-brightsmile",
  tenantSlug: "brightsmile",
  tenantName: "BrightSmile",
  roleKey: "tenant_admin",
  capabilities: ["console:read", "tenant:configure", "analytics:read"],
  locations: [
    {
      locationId: "location-downtown",
      locationSlug: "downtown",
      locationName: "Downtown",
      status: "active" as const,
    },
  ],
};

const tenantOperator: ConsoleGrants = {
  platformGrants: [],
  tenantGrants: [tenantGrant],
};

const platformAdmin: ConsoleGrants = {
  platformGrants: [
    {
      roleKey: "platform_admin",
      capabilities: [
        "console:read",
        "platform:admin",
        "provider:manage",
        "tenant:configure",
        "analytics:read",
        "ai:operate",
      ],
    },
  ],
  tenantGrants: [],
};

describe("ADM-AUTH-03 capability derivation", () => {
  it("derives role and capabilities from held Grants, not from a role name", () => {
    expect(deriveConsoleRole(tenantOperator)).toBe("tenant_operator");
    expect(deriveConsoleCapabilities(tenantOperator)).toEqual({
      canAccessPlatform: false,
      canSwitchTenant: false,
      canManageLocations: true,
      canManageConfiguration: true,
      canViewAnalytics: true,
      canManageAiOperations: false,
      canManageProviders: false,
    });
  });

  it("treats an operator holding several Tenant Grants as an agency operator", () => {
    const agency: ConsoleGrants = {
      platformGrants: [],
      tenantGrants: [
        tenantGrant,
        { ...tenantGrant, tenantId: "tenant-two", tenantSlug: "two" },
      ],
    };

    expect(deriveConsoleRole(agency)).toBe("agency_operator");
    expect(deriveConsoleCapabilities(agency).canSwitchTenant).toBe(true);
    expect(deriveConsoleCapabilities(agency).canAccessPlatform).toBe(false);
  });

  it("grants Platform scope only through a Platform Grant", () => {
    expect(deriveConsoleRole(platformAdmin)).toBe("platform_admin");
    expect(deriveConsoleCapabilities(platformAdmin).canAccessPlatform).toBe(true);
    expect(deriveConsoleCapabilities(platformAdmin).canManageProviders).toBe(true);
  });

  it("refuses Console access to an identity without console:read", () => {
    expect(
      authorizeConsoleScope({
        grants: {
          platformGrants: [],
          tenantGrants: [{ ...tenantGrant, capabilities: ["tenant:configure"] }],
        },
        request: { tenantId: "tenant-brightsmile", locationId: null },
      }),
    ).toEqual({ decision: "denied" });
  });
});

describe("ADM-AUTH-02/04 scope authorization", () => {
  it("authorizes a granted Tenant and its granted Location", () => {
    expect(
      authorizeConsoleScope({
        grants: tenantOperator,
        request: { tenantId: "tenant-brightsmile", locationId: null },
      }),
    ).toEqual({
      decision: "tenant",
      tenantId: "tenant-brightsmile",
      source: "grant",
    });

    expect(
      authorizeConsoleScope({
        grants: tenantOperator,
        request: {
          tenantId: "tenant-brightsmile",
          locationId: "location-downtown",
        },
      }),
    ).toEqual({
      decision: "location",
      tenantId: "tenant-brightsmile",
      locationId: "location-downtown",
      source: "grant",
    });
  });

  it("denies another Tenant and another Tenant's Location identically", () => {
    expect(
      authorizeConsoleScope({
        grants: tenantOperator,
        request: { tenantId: "tenant-other", locationId: null },
      }),
    ).toEqual({ decision: "denied" });

    expect(
      authorizeConsoleScope({
        grants: tenantOperator,
        request: {
          tenantId: "tenant-brightsmile",
          locationId: "location-of-another-tenant",
        },
      }),
    ).toEqual({ decision: "denied" });
  });

  it("denies Platform scope to a Tenant operator", () => {
    expect(
      authorizeConsoleScope({
        grants: tenantOperator,
        request: { tenantId: null, locationId: null },
      }),
    ).toEqual({ decision: "denied" });
  });

  it("lets a Platform administrator address Platform scope and any Tenant", () => {
    expect(
      authorizeConsoleScope({
        grants: platformAdmin,
        request: { tenantId: null, locationId: null },
        requiredCapability: "platform:admin",
      }),
    ).toEqual({ decision: "platform" });

    expect(
      authorizeConsoleScope({
        grants: platformAdmin,
        request: { tenantId: "tenant-unrelated", locationId: null },
      }),
    ).toEqual({
      decision: "tenant",
      tenantId: "tenant-unrelated",
      source: "platform",
    });
  });

  it("denies a Platform-only capability to an operator who lacks it", () => {
    expect(
      authorizeConsoleScope({
        grants: tenantOperator,
        request: { tenantId: "tenant-brightsmile", locationId: null },
        requiredCapability: "platform:admin",
      }),
    ).toEqual({ decision: "denied" });

    expect(
      authorizeConsoleScope({
        grants: tenantOperator,
        request: { tenantId: "tenant-brightsmile", locationId: null },
        requiredCapability: "ai:operate",
      }),
    ).toEqual({ decision: "denied" });
  });

  it("rejects a Location requested without a Tenant", () => {
    expect(
      authorizeConsoleScope({
        grants: platformAdmin,
        request: { tenantId: null, locationId: "location-downtown" },
      }),
    ).toEqual({ decision: "denied" });
  });
});
