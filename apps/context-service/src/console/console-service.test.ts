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
        platformDefaults: defaultTenantSettings("en-GB"),
        tenantValues: defaultTenantSettings("en-GB"),
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
        platformDefaults: defaultTenantSettings("de-DE"),
        tenantValues: defaultTenantSettings("de-DE"),
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
        hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
        hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
            promptVersionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            weightPct: 50,
            generations: 40,
            accepted: 26,
          },
          {
            promptVersionId: "prompt-generate-2",
            promptVersionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
  ifMatch?: string,
): Promise<ConsoleRequestInvocationResultDto["result"]> {
  return await service(access).request({
    identity,
    scope,
    publicOrigin: "https://review.example.test",
    ...(ifMatch === undefined ? {} : { ifMatch }),
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

describe("US-04.2 Tenant configuration publication", () => {
  it("saves a Draft without changing published settings", async () => {
    const before = viewData<{
      configuration: { etag: string; draft: unknown };
      settings: { key: string; value: unknown }[];
    }>(
      await query({ view: "tenant-settings" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    expect(
      await command(
        {
          command: "save-tenant-settings",
          changes: [{ key: "toneGuidelines", value: "Calm and precise." }],
        },
        { tenantId: "tenant-bright", locationId: null },
        undefined,
        before.configuration.etag,
      ),
    ).toEqual({ status: "command", result: { outcome: "accepted" } });

    const after = viewData<{
      configuration: {
        etag: string;
        draft: { changes: { key: string; value: unknown }[] } | null;
      };
      settings: { key: string; value: unknown }[];
    }>(
      await query({ view: "tenant-settings" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );
    expect(
      after.settings.find((setting) => setting.key === "toneGuidelines")?.value,
    ).toBe("Plain, factual, first person.");
    expect(after.configuration.etag).not.toBe(before.configuration.etag);
    expect(after.configuration.draft?.changes).toEqual([
      { key: "toneGuidelines", value: "Calm and precise." },
    ]);
  });

  it("binds the ETag to one Draft revision so a stale tab cannot overwrite or cancel it", async () => {
    const initial = viewData<{
      configuration: { etag: string };
    }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );

    await expect(
      command(
        {
          command: "save-tenant-settings",
          changes: [{ key: "toneGuidelines", value: "First tab." }],
        },
        { tenantId: "tenant-bright", locationId: null },
        undefined,
        initial.configuration.etag,
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });

    const afterFirstSave = viewData<{
      configuration: { etag: string };
    }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    expect(afterFirstSave.configuration.etag).not.toBe(initial.configuration.etag);

    await expect(
      command(
        {
          command: "save-tenant-settings",
          changes: [{ key: "toneGuidelines", value: "Stale second tab." }],
        },
        { tenantId: "tenant-bright", locationId: null },
        undefined,
        initial.configuration.etag,
      ),
    ).resolves.toMatchObject({ status: "rejected", code: "CONFIG_CONFLICT" });

    await expect(
      command(
        { command: "cancel-configuration-draft" },
        { tenantId: "tenant-bright", locationId: null },
        undefined,
        initial.configuration.etag,
      ),
    ).resolves.toMatchObject({ status: "rejected", code: "CONFIG_CONFLICT" });

    await expect(
      command(
        {
          command: "save-tenant-settings",
          changes: [{ key: "requireDisclosure", value: false }],
        },
        { tenantId: "tenant-bright", locationId: null },
        undefined,
        afterFirstSave.configuration.etag,
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });

    const afterSecondSave = viewData<{
      configuration: {
        etag: string;
        draft: { changes: { key: string; value: unknown }[] } | null;
      };
    }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    expect(afterSecondSave.configuration.etag).not.toBe(
      afterFirstSave.configuration.etag,
    );
    expect(afterSecondSave.configuration.draft?.changes).toEqual([
      { key: "toneGuidelines", value: "First tab." },
      { key: "requireDisclosure", value: false },
    ]);
  });

  it("publishes one CAS revision and materializes every affected Location", async () => {
    data.locations.push({
      ...data.locations[0]!,
      id: "location-harbour",
      slug: "harbour",
      name: "Harbour",
    });
    const before = viewData<{
      configuration: { etag: string };
    }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );

    await command(
      {
        command: "save-tenant-settings",
        changes: [{ key: "toneGuidelines", value: "Calm and precise." }],
      },
      { tenantId: "tenant-bright", locationId: null },
      undefined,
      before.configuration.etag,
    );
    const withDraft = viewData<{
      configuration: { etag: string };
    }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    expect(
      await command(
        { command: "publish-configuration" },
        { tenantId: "tenant-bright", locationId: null },
        undefined,
        withDraft.configuration.etag,
      ),
    ).toEqual({ status: "command", result: { outcome: "accepted" } });

    const after = viewData<{
      configuration: { etag: string; draft: unknown };
      settings: { key: string; value: unknown }[];
    }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    expect(after.configuration).toEqual({
      etag: '"configuration:tenant-bright:tenant:2:draft:none"',
      draft: null,
    });
    expect(
      after.settings.find((setting) => setting.key === "toneGuidelines")?.value,
    ).toBe("Calm and precise.");
    expect(store.calls).toEqual(
      expect.arrayContaining([
        "materializeConfiguration:tenant-bright:location-downtown",
        "materializeConfiguration:tenant-bright:location-harbour",
      ]),
    );
  });

  it("requires ai:operate again when publishing a Draft that deploys a Prompt Version", async () => {
    const baseAccess = grants();
    if (baseAccess.status !== "authorized") {
      throw new Error("expected authorized fixture");
    }
    const aiAccess = grants({
      tenantGrants: [
        {
          ...baseAccess.tenantGrants[0]!,
          capabilities: [...tenantCapabilities, "ai:operate"],
        },
      ],
    });
    const before = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
        aiAccess,
      ),
    );

    await expect(
      command(
        {
          command: "stage-configuration-changes",
          changes: [
            {
              operation: "deploy-prompt-version",
              action: "generate",
              promptVersionId: "prompt-generate-1",
            },
          ],
        },
        { tenantId: "tenant-bright", locationId: null },
        aiAccess,
        before.configuration.etag,
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });

    const staged = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    await expect(
      command(
        { command: "publish-configuration" },
        { tenantId: "tenant-bright", locationId: null },
        undefined,
        staged.configuration.etag,
      ),
    ).resolves.toEqual({ status: "not-found" });
    expect(
      store.calls.some((call) => call.startsWith("publishConfiguration:")),
    ).toBe(false);
  });

  it("rejects a staged Prompt deployment whose immutable Action does not match", async () => {
    const baseAccess = grants();
    if (baseAccess.status !== "authorized") {
      throw new Error("expected authorized fixture");
    }
    const aiAccess = grants({
      tenantGrants: [
        {
          ...baseAccess.tenantGrants[0]!,
          capabilities: [...tenantCapabilities, "ai:operate"],
        },
      ],
    });
    const before = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
        aiAccess,
      ),
    );

    await expect(
      command(
        {
          command: "stage-configuration-changes",
          changes: [
            {
              operation: "deploy-prompt-version",
              action: "paraphrase",
              promptVersionId: "prompt-generate-1",
            },
          ],
        },
        { tenantId: "tenant-bright", locationId: null },
        aiAccess,
        before.configuration.etag,
      ),
    ).resolves.toMatchObject({ status: "rejected", code: "INVALID_VALUE" });
  });
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

  it("does not mint an execution receipt for a crossed Tenant/Location pair", async () => {
    const signed: unknown[] = [];
    const minted: unknown[] = [];
    const consoleService = createConsoleService({
      store,
      resolveAccess: async () => grants(),
      now: () => new Date("2026-08-18T12:00:00.000Z"),
      readAuthority: {
        signRead(input) {
          signed.push(input);
          return "signed-receipt";
        },
      },
      executionAuthorizationStore: {
        mint: async (input) => {
          minted.push(input);
          return null;
        },
      },
    });

    await expect(
      consoleService.authorizeRead({
        identity,
        scope: {
          tenantId: "tenant-bright",
          locationId: "location-hafencity",
        },
        query: {
          view: "analytics",
          query: {
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-18T00:00:00.000Z",
            sortKey: "generations",
            sortDirection: "desc",
          },
        },
      }),
    ).resolves.toEqual({ status: "not-found" });
    expect(signed).toEqual([]);
    expect(minted).toEqual([]);
  });

  it("signs only the opaque authorization PostgreSQL minted for current Grants", async () => {
    const minted: unknown[] = [];
    const signed: unknown[] = [];
    const consoleService = createConsoleService({
      store,
      resolveAccess: async () => grants(),
      now: () => new Date("2026-08-18T12:00:00.000Z"),
      executionAuthorizationStore: {
        mint: async (input) => {
          minted.push(input);
          return {
            authorizationId: "2ffad1ca-22f2-41ad-a9b3-07991a66cf76",
            expiresAt: "2026-08-18T12:00:30.000Z",
            readMode: "redacted",
          };
        },
      },
      readAuthority: {
        signRead(input) {
          signed.push(input);
          return "signed-receipt";
        },
      },
    });

    const query = {
      view: "analytics" as const,
      query: {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-18T00:00:00.000Z",
        sortKey: "generations" as const,
        sortDirection: "desc" as const,
      },
    };
    await expect(
      consoleService.authorizeRead({
        identity,
        scope: { tenantId: "tenant-bright", locationId: null },
        query,
      }),
    ).resolves.toEqual({
      status: "authorized",
      authorizationId: "2ffad1ca-22f2-41ad-a9b3-07991a66cf76",
      receipt: "signed-receipt",
      projectionScope: expect.objectContaining({ type: "tenant" }),
      query,
    });
    expect(minted).toEqual([
      {
        operatorId: "operator-1",
        scope: { type: "tenant", tenantId: "tenant-bright" },
        query,
        expiresAt: "2026-08-18T12:00:30.000Z",
      },
    ]);
    expect(signed).toEqual([
      {
        authorizationId: "2ffad1ca-22f2-41ad-a9b3-07991a66cf76",
        view: "analytics",
        readMode: "redacted",
        expiresAt: "2026-08-18T12:00:30.000Z",
      },
    ]);
  });
});

describe("ADM-LOC-01/03 Locations and inheritance", () => {
  it("projects the actual Platform, Tenant and Location source for each value", async () => {
    const tenantIndex = data.tenants.findIndex(
      (candidate) => candidate.id === "tenant-bright",
    );
    const tenant = data.tenants[tenantIndex];
    if (tenant === undefined) {
      throw new Error("Expected BrightSmile fixture");
    }
    const platformDefaults = {
      ...tenant.platformDefaults,
      requireDisclosure: true,
      requireVerifiedExperience: true,
    };
    const tenantValues = { requireDisclosure: false };
    data.tenants[tenantIndex] = {
      ...tenant,
      platformDefaults,
      tenantValues,
      settings: {
        ...platformDefaults,
        ...tenantValues,
      },
    };
    const locationIndex = data.locations.findIndex(
      (candidate) => candidate.id === "location-downtown",
    );
    const location = data.locations[locationIndex];
    if (location === undefined) {
      throw new Error("Expected Downtown fixture");
    }
    data.locations[locationIndex] = {
      ...location,
      overrides: { requireVerifiedExperience: false },
    };

    const tenantSettings = viewData<{
      settings: {
        key: string;
        source: string;
        platformDefault: unknown;
        tenantValue: unknown;
      }[];
    }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    expect(
      tenantSettings.settings.find(
        (setting) => setting.key === "requireVerifiedExperience",
      ),
    ).toMatchObject({
      source: "platform",
      platformDefault: true,
      tenantValue: null,
    });
    expect(
      tenantSettings.settings.find(
        (setting) => setting.key === "requireDisclosure",
      ),
    ).toMatchObject({
      source: "tenant",
      platformDefault: true,
      tenantValue: false,
    });

    const locationSettings = viewData<{
      settings: {
        key: string;
        source: string;
        platformDefault: unknown;
        tenantValue: unknown;
        locationOverride: unknown;
      }[];
    }>(
      await query(
        { view: "location-settings" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    );
    expect(
      locationSettings.settings.find(
        (setting) => setting.key === "requireVerifiedExperience",
      ),
    ).toMatchObject({
      source: "location",
      platformDefault: true,
      tenantValue: null,
      locationOverride: false,
    });
  });

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
    const before = viewData<{
      configuration: { etag: string };
      settings: { key: string; source: string }[];
    }>(
      await query({ view: "location-settings" }, {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
      }),
    );
    expect(
      before.settings.find((setting) => setting.key === "requireDisclosure"),
    ).toMatchObject({ source: "tenant", locationOverride: null });

    await expect(
      command(
        {
          command: "set-location-override",
          change: { key: "requireDisclosure", value: false },
        },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      code: "CONFIG_DRAFT_REQUIRED",
    });

    await expect(
      command(
        {
          command: "stage-configuration-changes",
          changes: [
            {
              operation: "set-location-override",
              change: { key: "requireDisclosure", value: false },
            },
          ],
        },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
        undefined,
        before.configuration.etag,
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });

    const staged = viewData<{
      configuration: { etag: string };
      settings: { key: string; source: string }[];
    }>(
      await query(
        { view: "location-settings" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    );
    expect(
      staged.settings.find((setting) => setting.key === "requireDisclosure"),
    ).toMatchObject({ source: "tenant", locationOverride: null });

    await expect(
      command(
        { command: "publish-configuration" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
        undefined,
        staged.configuration.etag,
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });

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
    const before = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "location-settings" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    );
    await command(
      {
        command: "stage-configuration-changes",
        changes: [
          {
            operation: "set-location-override",
            change: { key: "requireDisclosure", value: false },
          },
        ],
      },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
      undefined,
      before.configuration.etag,
    );
    const withSetDraft = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "location-settings" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    );
    await command(
      { command: "publish-configuration" },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
      undefined,
      withSetDraft.configuration.etag,
    );
    const afterSet = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "location-settings" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    );
    await command(
      {
        command: "stage-configuration-changes",
        changes: [
          { operation: "reset-location-override", key: "requireDisclosure" },
        ],
      },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
      undefined,
      afterSet.configuration.etag,
    );
    const withResetDraft = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "location-settings" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    );
    await command(
      { command: "publish-configuration" },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
      undefined,
      withResetDraft.configuration.etag,
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
        {
          command: "set-location-override",
          change: { key: "locale", value: "de-DE" } as never,
        },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    ).toMatchObject({ status: "rejected", code: "NOT_OVERRIDABLE" });
  });
});

describe("ADM-LOC-04/05 distribution", () => {
  it("withholds a QR an invite-only venue could not honour", async () => {
    const distribution = viewData<{
      liveUrl: string;
      qrSvg: string | null;
      qrUnavailableReason: string | null;
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
    // BrightSmile is invite-only, so a token-free code would always refuse the
    // person who scanned it and none is offered.
    expect(distribution.qrSvg).toBeNull();
    expect(distribution.qrUnavailableReason).toContain("invited reviewers only");
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

    const distribution = viewData<{
      entryMode: string;
      verifiesVisit: boolean;
      qrSvg: string | null;
    }>(
      await query(
        { view: "distribution" },
        { tenantId: "tenant-hafen", locationId: "location-hafencity" },
        hafenAccess,
      ),
    );

    expect(distribution.entryMode).toBe("open-qr");
    expect(distribution.verifiesVisit).toBe(false);
    // Scanning is an accepted way in here, so a real code is offered and it
    // decodes back to this venue's own survey URL.
    expect(distribution.qrSvg).toContain("<svg");
    expect(
      decodeQrPayload(
        encodeQrCode("https://review.example.test/s/speicher-neun/hafencity"),
      ),
    ).toBe("https://review.example.test/s/speicher-neun/hafencity");
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
    await expect(
      command(
        {
          command: "create-keyword",
          label: "Late opening",
          categoryKey: "service",
          polarity: "positive",
          ownerScope: "location",
        },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    ).resolves.toMatchObject({
      status: "rejected",
      code: "CONFIG_DRAFT_REQUIRED",
    });
    const before = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "location-settings" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    );
    await command(
      {
        command: "stage-configuration-changes",
        changes: [
          {
            operation: "create-fact-option",
            mutationId: "keyword-late-opening",
            label: "Late opening",
            categoryKey: "service",
            polarity: "positive",
            ownerScope: "location",
          },
        ],
      },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
      undefined,
      before.configuration.etag,
    );
    expect(
      data.keywords.find((keyword) => keyword.label === "Late opening"),
    ).toBeUndefined();
    const staged = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "location-settings" },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    );
    await command(
      { command: "publish-configuration" },
      { tenantId: "tenant-bright", locationId: "location-downtown" },
      undefined,
      staged.configuration.etag,
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
    ).toMatchObject({
      status: "rejected",
      code: "CONFIG_DRAFT_REQUIRED",
    });
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
    ).toMatchObject({ status: "rejected", code: "CONFIG_DRAFT_REQUIRED" });

    const before = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    await command(
      {
        command: "stage-configuration-changes",
        changes: [
          {
            operation: "set-action-enablement",
            action: "condense",
            enabled: false,
          },
        ],
      },
      { tenantId: "tenant-bright", locationId: null },
      undefined,
      before.configuration.etag,
    );
    const staged = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    await command(
      { command: "publish-configuration" },
      { tenantId: "tenant-bright", locationId: null },
      undefined,
      staged.configuration.etag,
    );
    expect(
      data.actions.find((action) => action.key === "condense")?.enabled,
    ).toBe(false);
  });
});

describe("execution-plane views without an execution-plane reader", () => {
  it("says the view is not deployed rather than inventing empty history", async () => {
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
      // An authorized operator gets an explanation about the deployment, not
      // the not-found an unauthorized one would see.
      await expect(
        controlPlaneOnly.request({
          identity,
          scope,
          publicOrigin: "https://review.example.test",
          request: { mode: "query", query: view },
        }),
      ).resolves.toMatchObject({
        status: "rejected",
        code: "VIEW_NOT_AVAILABLE",
      });
    }

    // An operator with no Grant for the Tenant still learns nothing.
    await expect(
      createConsoleService({
        store,
        resolveAccess: async () => grants(),
        now: () => new Date("2026-08-18T12:00:00.000Z"),
      }).request({
        identity,
        scope: { tenantId: "tenant-hafen", locationId: null },
        publicOrigin: "https://review.example.test",
        request: { mode: "query", query: { view: "overview" } },
      }),
    ).resolves.toEqual({ status: "not-found" });
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

describe("ADM-CFG-02 category management", () => {
  it("adds a category so the taxonomy grows without a release", async () => {
    await expect(
      command(
        { command: "create-keyword-category", key: "ambience", label: "Ambience" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });

    const keywords = viewData<{ categories: { key: string }[] }>(
      await query({ view: "keywords" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );
    expect(keywords.categories.map((category) => category.key)).toContain(
      "ambience",
    );
  });

  it("refuses a key the account already uses", async () => {
    expect(
      await command(
        { command: "create-keyword-category", key: "service", label: "Service" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "SLUG_TAKEN" });
  });

  it("refuses to touch another Tenant's taxonomy", async () => {
    expect(
      await command(
        { command: "create-keyword-category", key: "kueche", label: "Küche" },
        { tenantId: "tenant-hafen", locationId: null },
      ),
    ).toEqual({ status: "not-found" });
  });
});

describe("ADM-LOC-04 tenant-wide distribution", () => {
  it("offers every venue's own survey link in one view", async () => {
    await command(
      {
        command: "create-location",
        name: "Harbour",
        slug: "harbour",
        address: {
          line1: "2 Dock Road",
          line2: "",
          postalCode: "BS1 2AA",
          city: "Bristol",
          country: "GB",
        },
        entryMode: null,
      },
      { tenantId: "tenant-bright", locationId: null },
    );

    const overview = viewData<{
      locations: { locationId: string; name: string; liveUrl: string }[];
    }>(
      await query({ view: "distribution-overview" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    // Each venue carries its own link; none of them is the account's.
    expect(overview.locations).toEqual([
      expect.objectContaining({
        locationId: "location-downtown",
        name: "Downtown",
        liveUrl: "https://review.example.test/s/brightsmile/downtown",
      }),
      expect.objectContaining({
        name: "Harbour",
        liveUrl: "https://review.example.test/s/brightsmile/harbour",
      }),
    ]);
  });
});

  it("withholds the QR only for the venues that cannot honour a scan", async () => {
    // BrightSmile is invite-only, so its venue gets no code. This one is
    // overridden to open-qr and must get a real one.
    await command(
      {
        command: "create-location",
        name: "Market Stall",
        slug: "market-stall",
        address: {
          line1: "Market Square",
          line2: "",
          postalCode: "BS1 3AA",
          city: "Bristol",
          country: "GB",
        },
        entryMode: "open-qr",
      },
      { tenantId: "tenant-bright", locationId: null },
    );

    const overview = viewData<{
      locations: {
        name: string;
        qrSvg: string | null;
        qrUnavailableReason: string | null;
        verifiesVisit: boolean;
      }[];
    }>(
      await query({ view: "distribution-overview" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    const downtown = overview.locations.find((row) => row.name === "Downtown");
    const stall = overview.locations.find((row) => row.name === "Market Stall");

    expect(downtown).toMatchObject({ qrSvg: null, verifiesVisit: true });
    expect(downtown?.qrUnavailableReason).toContain("invited reviewers only");
    expect(stall?.qrSvg).toContain("<svg");
    expect(stall).toMatchObject({
      qrUnavailableReason: null,
      verifiesVisit: false,
    });
  });

  it("withholds the QR of a venue that is no longer taking reviews", async () => {
    await command(
      {
        command: "create-location",
        name: "Closed Kiosk",
        slug: "closed-kiosk",
        address: {
          line1: "Old Pier",
          line2: "",
          postalCode: "BS1 4AA",
          city: "Bristol",
          country: "GB",
        },
        entryMode: "open-qr",
      },
      { tenantId: "tenant-bright", locationId: null },
    );
    await command(
      {
        command: "update-location",
        locationId: "location-closed-kiosk",
        name: "Closed Kiosk",
        address: {
          line1: "Old Pier",
          line2: "",
          postalCode: "BS1 4AA",
          city: "Bristol",
          country: "GB",
        },
        active: false,
      },
      { tenantId: "tenant-bright", locationId: null },
    );

    const overview = viewData<{
      locations: {
        name: string;
        active: boolean;
        qrSvg: string | null;
        qrUnavailableReason: string | null;
      }[];
    }>(
      await query({ view: "distribution-overview" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );
    const kiosk = overview.locations.find((row) => row.name === "Closed Kiosk");

    // Entry resolution refuses an inactive venue, so a printed code would send
    // every scanner to a dead end.
    expect(kiosk).toMatchObject({ active: false, qrSvg: null });
    expect(kiosk?.qrUnavailableReason).toContain("not currently taking");
  });

describe("US-04.2 publishing configuration to a venue", () => {
  it("rejects the legacy direct republish path in favour of Draft CAS publication", async () => {
    expect(
      await command({ command: "republish-configuration" }, {
        tenantId: "tenant-bright",
        locationId: "location-downtown",
      }),
    ).toEqual({
      status: "rejected",
      code: "INVALID_VALUE",
      message: "Direct republish is retired; save a Draft and publish it with its base revision.",
    });

    expect(store.calls).not.toContain(
      "republishConfiguration:tenant-bright:location-downtown",
    );
  });

  it("refuses to publish into a venue of another account", async () => {
    expect(
      await command({ command: "republish-configuration" }, {
        tenantId: "tenant-bright",
        locationId: "location-hafencity",
      }),
    ).toEqual({ status: "not-found" });
  });

  it("needs a venue, not just an account", async () => {
    expect(
      await command({ command: "republish-configuration" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    ).toEqual({ status: "not-found" });
  });
});
