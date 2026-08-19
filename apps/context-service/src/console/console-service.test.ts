import type {
  ConsoleQueryDto,
  ConsoleCommandDto,
  ConsoleRequestInvocationResultDto,
} from "@review/contracts/console";
import type { OperatorAccessProjectionDto } from "@review/contracts/context";
import { decodeQrPayload, encodeQrCode } from "@review/domain/console";
import { beforeEach, describe, expect, it } from "vitest";

import { createConsoleService } from "./console-service.js";
import {
  createFakeConsoleStore,
  defaultTenantSettings,
  type FakeConsoleData,
} from "./console-store.test-support.js";

const identity = {
  issuer: "https://issuer.example.test",
  subject: "operator-1",
  email: "operator@example.test",
};

const tenantCapabilities = [
  "console:read",
  "tenant:configure",
  "analytics:read",
];

function grants(
  overrides: Partial<Extract<OperatorAccessProjectionDto, { status: "authorized" }>> = {},
): OperatorAccessProjectionDto {
  return {
    status: "authorized",
    operator: { id: "operator-1", email: identity.email },
    platformGrants: [],
    tenantGrants: [
      {
        tenantId: "tenant-bright",
        tenantSlug: "brightsmile",
        tenantName: "BrightSmile",
        roleKey: "tenant_admin",
        capabilities: tenantCapabilities,
        locations: [
          {
            locationId: "location-downtown",
            locationSlug: "downtown",
            locationName: "Downtown",
            status: "active",
          },
        ],
      },
    ],
    ...overrides,
  };
}

function freshData(): FakeConsoleData {
  return {
    tenants: [
      {
        id: "tenant-bright",
        slug: "brightsmile",
        name: "BrightSmile",
        locale: "en-GB",
        settings: defaultTenantSettings("en-GB"),
        keywordCategories: [
          { key: "service", label: "Service", sortOrder: 0 },
          { key: "facility", label: "Facility", sortOrder: 1 },
        ],
        category: "Dental",
        plan: "growth",
        monthlyBudgetMicros: 1_000_000,
        monthToDateSpendMicros: 820_000,
        status: "active",
      },
      {
        id: "tenant-hafen",
        slug: "speicher-neun",
        name: "Speicher Neun",
        locale: "de-DE",
        settings: defaultTenantSettings("de-DE"),
        keywordCategories: [{ key: "kueche", label: "Küche", sortOrder: 0 }],
        category: "Restaurant",
        plan: "lite",
        monthlyBudgetMicros: 500_000,
        monthToDateSpendMicros: 10_000,
        status: "active",
      },
    ],
    locations: [
      {
        id: "location-downtown",
        tenantId: "tenant-bright",
        slug: "downtown",
        name: "Downtown",
        address: {
          line1: "1 High Street",
          line2: "",
          postalCode: "BS1 1AA",
          city: "Bristol",
          country: "GB",
        },
        active: true,
        overrides: {},
      },
      {
        id: "location-hafencity",
        tenantId: "tenant-hafen",
        slug: "hafencity",
        name: "HafenCity",
        address: {
          line1: "Kaiserkai 1",
          line2: "",
          postalCode: "20457",
          city: "Hamburg",
          country: "DE",
        },
        active: true,
        overrides: { entryMode: "open-qr" },
      },
    ],
    contextVersions: [
      {
        tenantId: "tenant-bright",
        id: "context-1",
        version: 1,
        createdAt: "2026-08-01T09:00:00.000Z",
        createdBy: "operator-1",
        context: "Family dental practice, open since 2004.",
        bannedTerms: ["painless"],
      },
    ],
    keywords: [
      {
        tenantId: "tenant-bright",
        locationId: null,
        id: "keyword-tenant-1",
        label: "Friendly staff",
        categoryKey: "service",
        categoryLabel: "Service",
        polarity: "positive",
        ownerScope: "tenant",
        active: true,
        sortOrder: 1,
        deletable: true,
      },
      {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
        id: "keyword-location-1",
        label: "Step-free entrance",
        categoryKey: "facility",
        categoryLabel: "Facility",
        polarity: "positive",
        ownerScope: "location",
        active: true,
        sortOrder: 0,
        deletable: true,
      },
    ],
    styles: [
      {
        tenantId: "tenant-bright",
        id: "style-concise",
        key: "concise-blurb",
        name: "Concise blurb",
        version: "1.0.0",
        locale: "en-GB",
        targetPlatform: "google",
        maxChars: 420,
        supportedActions: ["generate", "paraphrase", "condense"],
        manifest: JSON.stringify({
          key: "concise-blurb",
          version: "1.0.0",
          targetPlatform: "google",
          locale: "en-GB",
          constraints: { minChars: 80, maxChars: 420, emojiPolicy: "none" },
          supportedActions: ["generate", "paraphrase", "condense"],
        }),
        enabled: true,
        sortOrder: 0,
        enabledActions: ["generate", "paraphrase"],
        validationStatus: "valid",
      },
      {
        tenantId: "tenant-bright",
        id: "style-german",
        key: "sachlich",
        name: "Sachlich",
        version: "1.0.0",
        locale: "de-DE",
        targetPlatform: "google",
        maxChars: 500,
        supportedActions: ["generate"],
        manifest: "{}",
        enabled: false,
        sortOrder: 1,
        enabledActions: [],
        validationStatus: "valid",
      },
    ],
    actions: [
      {
        tenantId: "tenant-bright",
        key: "generate",
        label: "Generate",
        enabled: true,
        requiredInputs: ["rating", "assertions"],
        groundingRule: "Every Claim maps to a confirmed Assertion.",
        relativeCost: "medium",
        isEntryAction: true,
      },
      {
        tenantId: "tenant-bright",
        key: "paraphrase",
        label: "Paraphrase",
        enabled: false,
        requiredInputs: ["sourceText"],
        groundingRule: "Claims are a subset of the reviewer's own text.",
        relativeCost: "low",
        isEntryAction: true,
      },
      {
        tenantId: "tenant-bright",
        key: "condense",
        label: "Condense",
        enabled: true,
        requiredInputs: ["sourceGeneration"],
        groundingRule: "Claims are a subset of the source Generation.",
        relativeCost: "low",
        isEntryAction: false,
      },
    ],
    prompts: [
      {
        tenantId: "tenant-bright",
        id: "prompt-generate-1",
        action: "generate",
        version: 1,
        hash: "sha256:aaa",
        status: "candidate",
        createdAt: "2026-08-01T09:00:00.000Z",
        createdBy: "operator-1",
        evaluationScore: 1,
        body: "Write only what the reviewer confirmed.",
        variables: ["assertions"],
      },
      {
        tenantId: "tenant-bright",
        id: "prompt-generate-2",
        action: "generate",
        version: 2,
        hash: "sha256:bbb",
        status: "draft",
        createdAt: "2026-08-05T09:00:00.000Z",
        createdBy: "operator-1",
        evaluationScore: null,
        body: "Write only what the reviewer confirmed. Keep it short.",
        variables: ["assertions"],
      },
    ],
    experiments: [
      {
        tenantId: "tenant-bright",
        id: "experiment-running",
        action: "generate",
        status: "running",
        createdAt: "2026-08-10T09:00:00.000Z",
        startedAt: "2026-08-11T09:00:00.000Z",
        stoppedAt: null,
        variants: [
          {
            promptVersionId: "prompt-generate-1",
            promptVersionHash: "sha256:aaa",
            weightPct: 50,
            generations: 40,
            accepted: 26,
          },
          {
            promptVersionId: "prompt-generate-2",
            promptVersionHash: "sha256:bbb",
            weightPct: 50,
            generations: 38,
            accepted: 30,
          },
        ],
        metricsAvailable: true,
      },
    ],
    destinations: [
      {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
        destinationTypeId: "destination-google",
        platform: "google",
        displayName: "Google Maps",
        platformPlaceId: "ChIJ-downtown",
        targetUrl: "https://maps.example.test/downtown",
        enabled: true,
        configurationState: "valid",
      },
    ],
  };
}

let data: FakeConsoleData;
let store: ReturnType<typeof createFakeConsoleStore>;

function service(access: OperatorAccessProjectionDto = grants()): ReturnType<
  typeof createConsoleService
> {
  return createConsoleService({
    store,
    executionStore: store,
    resolveAccess: async () => access,
    now: () => new Date("2026-08-18T12:00:00.000Z"),
  });
}

async function query(
  view: ConsoleQueryDto,
  scope: { tenantId: string | null; locationId: string | null },
  access?: OperatorAccessProjectionDto,
): Promise<ConsoleRequestInvocationResultDto["result"]> {
  return await service(access).request({
    identity,
    scope,
    publicOrigin: "https://review.example.test",
    request: { mode: "query", query: view },
  });
}

async function command(
  body: ConsoleCommandDto,
  scope: { tenantId: string | null; locationId: string | null },
  access?: OperatorAccessProjectionDto,
): Promise<ConsoleRequestInvocationResultDto["result"]> {
  return await service(access).request({
    identity,
    scope,
    publicOrigin: "https://review.example.test",
    request: { mode: "command", command: body },
  });
}

function viewData<T>(result: ConsoleRequestInvocationResultDto["result"]): T {
  if (result.status !== "view") {
    throw new Error(`Expected a view, received ${result.status}`);
  }
  return result.view.data as T;
}

beforeEach(() => {
  data = freshData();
  store = createFakeConsoleStore(data);
});

describe("ADM-AUTH-01/03 bootstrap", () => {
  it("resolves role, Tenants and capabilities from Grants", async () => {
    const result = await query({ view: "bootstrap" }, {
      tenantId: null,
      locationId: null,
    });

    expect(viewData(result)).toEqual({
      user: { id: "operator-1", displayName: identity.email },
      role: "tenant_operator",
      tenants: [
        {
          id: "tenant-bright",
          slug: "brightsmile",
          name: "BrightSmile",
          locations: [
            {
              id: "location-downtown",
              slug: "downtown",
              name: "Downtown",
              active: true,
            },
          ],
        },
      ],
      activeContext: { tenantId: "tenant-bright", locationId: null },
      capabilities: {
        canAccessPlatform: false,
        canSwitchTenant: false,
        canManageLocations: true,
        canManageConfiguration: true,
        canViewAnalytics: true,
        canManageAiOperations: false,
        canManageProviders: false,
      },
    });
  });

  it("refuses every Console request for an identity without a Grant", async () => {
    const result = await query(
      { view: "bootstrap" },
      { tenantId: null, locationId: null },
      { status: "unauthorized" },
    );

    expect(result).toEqual({ status: "not-found" });
  });
});

describe("ADM-AUTH-04 Tenant isolation", () => {
  it("answers another Tenant's id exactly like an unknown one", async () => {
    const otherTenant = await query({ view: "locations" }, {
      tenantId: "tenant-hafen",
      locationId: null,
    });
    const unknownTenant = await query({ view: "locations" }, {
      tenantId: "tenant-does-not-exist",
      locationId: null,
    });

    expect(otherTenant).toEqual({ status: "not-found" });
    expect(unknownTenant).toEqual({ status: "not-found" });
  });

  it("refuses another Tenant's Location under the operator's own Tenant", async () => {
    expect(
      await query({ view: "location-settings" }, {
        tenantId: "tenant-bright",
        locationId: "location-hafencity",
      }),
    ).toEqual({ status: "not-found" });
  });

  it("refuses Platform views to a Tenant operator", async () => {
    for (const view of [
      "platform-tenants",
      "platform-providers",
      "platform-styles",
      "platform-settings",
    ] as const) {
      expect(
        await query({ view }, { tenantId: null, locationId: null }),
      ).toEqual({ status: "not-found" });
      expect(
        await query({ view }, { tenantId: "tenant-bright", locationId: null }),
      ).toEqual({ status: "not-found" });
    }
  });

  it("refuses AI views to an operator without the ai:operate capability", async () => {
    expect(
      await query({ view: "experiments" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    ).toEqual({ status: "not-found" });
  });
});

describe("ADM-LOC-01/03 Locations and inheritance", () => {
  it("lists Locations with the effective entry mode and its source", async () => {
    const result = viewData<{ locations: unknown[] }>(
      await query({ view: "locations" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    expect(result.locations).toEqual([
      expect.objectContaining({
        id: "location-downtown",
        entryMode: "invite",
        entryModeSource: "tenant",
      }),
    ]);
  });

  it("refuses a duplicate slug inside the Tenant", async () => {
    expect(
      await command(
        {
          command: "create-location",
          name: "Downtown Annexe",
          slug: "downtown",
          address: {
            line1: "2 High Street",
            line2: "",
            postalCode: "BS1 1AB",
            city: "Bristol",
            country: "GB",
          },
          entryMode: null,
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "SLUG_TAKEN" });
  });

  it("shows a venue inheriting until it holds its own override", async () => {
    const before = viewData<{ settings: { key: string; source: string }[] }>(
      await query({ view: "location-settings" }, {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
      }),
    );
    expect(
      before.settings.find((setting) => setting.key === "requireDisclosure"),
    ).toMatchObject({ source: "tenant", locationOverride: null });

    await command(
      {
        command: "set-location-override",
        key: "requireDisclosure",
        value: false,
      },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
    );

    const after = viewData<{ settings: { key: string; source: string }[] }>(
      await query({ view: "location-settings" }, {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
      }),
    );
    expect(
      after.settings.find((setting) => setting.key === "requireDisclosure"),
    ).toMatchObject({
      source: "location",
      effectiveValue: false,
      tenantValue: true,
      locationOverride: false,
    });
  });

  it("resets by deleting the override row, not by copying the Tenant value", async () => {
    await command(
      {
        command: "set-location-override",
        key: "requireDisclosure",
        value: false,
      },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
    );
    await command(
      { command: "reset-location-override", key: "requireDisclosure" },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
    );

    const location = data.locations.find(
      (candidate) => candidate.id === "location-downtown",
    );
    expect(Object.hasOwn(location!.overrides, "requireDisclosure")).toBe(false);

    const settings = viewData<{ settings: { key: string; source: string }[] }>(
      await query({ view: "location-settings" }, {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
      }),
    );
    expect(
      settings.settings.find((setting) => setting.key === "requireDisclosure"),
    ).toMatchObject({ source: "tenant", locationOverride: null });
  });

  it("refuses to override a Tenant-owned field", async () => {
    expect(
      await command(
        { command: "set-location-override", key: "locale", value: "de-DE" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    ).toMatchObject({ status: "rejected", code: "NOT_OVERRIDABLE" });
  });
});

describe("ADM-LOC-04/05 distribution", () => {
  it("hands over a QR that resolves the venue's own survey URL", async () => {
    const distribution = viewData<{
      liveUrl: string;
      qrSvg: string;
      verifiesVisit: boolean;
    }>(
      await query({ view: "distribution" }, {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
      }),
    );

    expect(distribution.liveUrl).toBe(
      "https://review.example.test/s/brightsmile/downtown",
    );
    expect(decodeQrPayload(encodeQrCode(distribution.liveUrl))).toBe(
      distribution.liveUrl,
    );
    expect(distribution.qrSvg).toContain("<svg");
    expect(distribution.verifiesVisit).toBe(true);
  });

  it("reports that an open-QR venue proves no visit", async () => {
    const hafenAccess = grants({
      tenantGrants: [
        {
          tenantId: "tenant-hafen",
          tenantSlug: "speicher-neun",
          tenantName: "Speicher Neun",
          roleKey: "tenant_admin",
          capabilities: tenantCapabilities,
          locations: [
            {
              locationId: "location-hafencity",
              locationSlug: "hafencity",
              locationName: "HafenCity",
              status: "active",
            },
          ],
        },
      ],
    });

    const distribution = viewData<{ entryMode: string; verifiesVisit: boolean }>(
      await query(
        { view: "distribution" },
        { tenantId: "tenant-hafen", locationId: "location-hafencity" },
        hafenAccess,
      ),
    );

    expect(distribution.entryMode).toBe("open-qr");
    expect(distribution.verifiesVisit).toBe(false);
  });

  it("keeps external destination ids on the venue", async () => {
    const destinations = viewData<{ destinations: { platformPlaceId: string }[] }>(
      await query({ view: "destinations" }, {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
      }),
    );

    expect(destinations.destinations).toEqual([
      expect.objectContaining({
        platformPlaceId: "ChIJ-downtown",
        configurationState: "valid",
      }),
    ]);
  });
});

describe("ADM-CFG-01 immutable business context", () => {
  it("publishes a new version instead of rewriting the current one", async () => {
    await command(
      {
        command: "publish-context-version",
        context: "Family dental practice, open since 2004. Two surgeries.",
        bannedTerms: ["painless", "guaranteed"],
      },
      { tenantId: "tenant-bright", locationId: null },
    );

    const context = viewData<{
      current: { version: number; context: string };
      history: { version: number }[];
    }>(
      await query({ view: "context" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    expect(context.current.version).toBe(2);
    expect(context.current.context).toContain("Two surgeries");
    expect(context.history.map((entry) => entry.version)).toEqual([2, 1]);
    expect(
      data.contextVersions.find((version) => version.version === 1)?.context,
    ).toBe("Family dental practice, open since 2004.");
  });
});

describe("ADM-CFG-02 keyword taxonomy", () => {
  it("shows Tenant keywords and this venue's additions with their owning scope", async () => {
    const keywords = viewData<{
      categories: { key: string }[];
      keywords: { id: string; ownerScope: string }[];
    }>(
      await query({ view: "keywords" }, {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
      }),
    );

    expect(keywords.categories.map((category) => category.key)).toEqual([
      "service",
      "facility",
    ]);
    expect(keywords.keywords).toEqual([
      expect.objectContaining({ id: "keyword-location-1", ownerScope: "location" }),
      expect.objectContaining({ id: "keyword-tenant-1", ownerScope: "tenant" }),
    ]);
  });

  it("adds a keyword into the scope the operator chose", async () => {
    await command(
      {
        command: "create-keyword",
        label: "Late opening",
        categoryKey: "service",
        polarity: "positive",
        ownerScope: "location",
      },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
    );

    expect(
      data.keywords.find((keyword) => keyword.label === "Late opening"),
    ).toMatchObject({ ownerScope: "location", locationId: "location-downtown" });
  });

  it("refuses a category that is not part of the Tenant taxonomy", async () => {
    expect(
      await command(
        {
          command: "create-keyword",
          label: "Ambience",
          categoryKey: "kueche",
          polarity: "positive",
          ownerScope: "tenant",
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "INVALID_VALUE" });
  });
});

describe("ADM-CFG-03/04 Review Format enablement", () => {
  it("explains why a style incompatible with the Tenant locale cannot be enabled", async () => {
    const styles = viewData<{ styles: { id: string; incompatibility: string | null }[] }>(
      await query({ view: "styles" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    expect(
      styles.styles.find((style) => style.id === "style-german")?.incompatibility,
    ).toContain("de-DE");
    expect(
      styles.styles.find((style) => style.id === "style-concise")?.incompatibility,
    ).toBeNull();
  });

  it("refuses to enable an incompatible style", async () => {
    expect(
      await command(
        {
          command: "set-style-enablement",
          styleId: "style-german",
          enabled: true,
          enabledActions: ["generate"],
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "STYLE_INCOMPATIBLE" });
  });

  it("refuses to enable an Action the style does not support", async () => {
    expect(
      await command(
        {
          command: "set-style-enablement",
          styleId: "style-concise",
          enabled: true,
          enabledActions: ["expand"],
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "STYLE_INCOMPATIBLE" });
  });

  it("keeps the manifest read-only in Tenant scope and validates rule by rule", async () => {
    const detail = viewData<{ manifestEditable: boolean; manifest: string }>(
      await query(
        { view: "style-detail", styleId: "style-concise" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    expect(detail.manifestEditable).toBe(false);

    const validation = await command(
      { command: "validate-style", styleId: "style-german" },
      { tenantId: "tenant-bright", locationId: null },
    );

    expect(validation).toMatchObject({
      status: "command",
      result: { outcome: "style-validation" },
    });
    if (validation.status !== "command" || validation.result.outcome !== "style-validation") {
      throw new Error("expected style validation");
    }
    expect(validation.result.validation.status).toBe("fail");
    expect(
      validation.result.validation.rules.some((rule) => rule.status === "fail"),
    ).toBe(true);
    // Validation must not silently repair the stored manifest.
    expect(
      data.styles.find((style) => style.id === "style-german")?.manifest,
    ).toBe("{}");
  });
});

describe("ADM-CFG-05 Action policy", () => {
  it("marks the last enabled entry Action as undisableable and refuses to disable it", async () => {
    const actions = viewData<{
      actions: { key: string; disableBlockedReason: string | null }[];
    }>(
      await query({ view: "actions" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    expect(
      actions.actions.find((action) => action.key === "generate")
        ?.disableBlockedReason,
    ).toContain("last entry Action");

    expect(
      await command(
        { command: "set-action-enablement", action: "generate", enabled: false },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "ACTION_REQUIRED_BY_ENTRY" });
  });

  it("allows disabling a non-entry Action", async () => {
    expect(
      await command(
        { command: "set-action-enablement", action: "condense", enabled: false },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toEqual({ status: "command", result: { outcome: "accepted" } });
  });
});

describe("execution-plane views without an execution-plane reader", () => {
  it("answers not-found rather than inventing empty Generation history", async () => {
    const controlPlaneOnly = createConsoleService({
      store,
      resolveAccess: async () => grants(),
      now: () => new Date("2026-08-18T12:00:00.000Z"),
    });
    const scope = { tenantId: "tenant-bright", locationId: null };

    for (const view of [
      { view: "overview" },
      {
        view: "analytics",
        query: {
          from: "2026-07-01T00:00:00.000Z",
          to: "2026-08-01T00:00:00.000Z",
          sortKey: "generations",
          sortDirection: "desc",
        },
      },
      { view: "generation-detail", generationId: "generation-1" },
    ] as const) {
      await expect(
        controlPlaneOnly.request({
          identity,
          scope,
          publicOrigin: "https://review.example.test",
          request: { mode: "query", query: view },
        }),
      ).resolves.toEqual({ status: "not-found" });
    }
  });

  it("still serves every configuration view the control plane owns", async () => {
    const controlPlaneOnly = createConsoleService({
      store,
      resolveAccess: async () => grants(),
      now: () => new Date("2026-08-18T12:00:00.000Z"),
    });

    for (const view of [
      { view: "bootstrap" },
      { view: "locations" },
      { view: "tenant-settings" },
      { view: "context" },
      { view: "keywords" },
      { view: "styles" },
      { view: "actions" },
    ] as const) {
      const result = await controlPlaneOnly.request({
        identity,
        scope: { tenantId: "tenant-bright", locationId: null },
        publicOrigin: "https://review.example.test",
        request: { mode: "query", query: view },
      });
      expect(result.status).toBe("view");
    }
  });
});
