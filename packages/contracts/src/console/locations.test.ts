import { describe, expect, it } from "vitest";

import {
  ConsoleLocationSettingsDtoSchema,
  ConsoleTenantSettingsDtoSchema,
} from "./locations.js";

const scope = {
  type: "location" as const,
  tenant: { id: "tenant-a", slug: "tenant-a", name: "Tenant A" },
  location: { id: "location-a", slug: "location-a", name: "Location A" },
};

describe("configuration value provenance", () => {
  it("represents a Tenant field inherited from a genuine Platform default", () => {
    expect(
      ConsoleTenantSettingsDtoSchema.safeParse({
        scope: { type: "tenant", tenant: scope.tenant },
        editable: true,
        configuration: { etag: '"configuration:a"', draft: null },
        settings: [
          {
            key: "requireDisclosure",
            label: "Review disclosure",
            description: "Disclosure policy",
            group: "Drafting policy",
            kind: "boolean",
            ownerScope: "tenant",
            source: "platform",
            value: true,
            platformDefault: true,
            tenantValue: null,
            editable: true,
          },
        ],
        keywordCategories: [],
      }).success,
    ).toBe(true);
  });

  it("preserves Platform, Tenant and Location values for a Location field", () => {
    expect(
      ConsoleLocationSettingsDtoSchema.safeParse({
        scope,
        editable: true,
        configuration: { etag: '"configuration:a"', draft: null },
        settings: [
          {
            key: "requireDisclosure",
            label: "Review disclosure",
            description: "Disclosure policy",
            group: "Drafting policy",
            kind: "boolean",
            ownerScope: "tenant",
            source: "location",
            effectiveValue: false,
            platformDefault: true,
            tenantValue: true,
            locationOverride: false,
            overridable: true,
          },
        ],
      }).success,
    ).toBe(true);
  });
});
