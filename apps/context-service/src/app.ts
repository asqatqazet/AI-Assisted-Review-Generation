import {
  buildConfigSnapshot,
  type FactOption,
  type LocationConfiguration,
  type PlatformConfiguration,
  type PriceRate,
  type PromptVersion,
  type ProviderRouting,
  type ResolvedConfigSnapshot,
  type ReviewFormatVersion,
  type TenantConfiguration,
} from "@review/domain/configuration";
import { Hono } from "hono";

export interface ContextServiceStore {
  getPlatform(): PlatformConfiguration;
  updatePlatform(defaults: Partial<PlatformConfiguration["defaults"]>): PlatformConfiguration;
  getTenant(tenantId: string): { tenant: TenantConfiguration; tenantName: string } | undefined;
  updateTenant(
    tenantId: string,
    settings: Partial<TenantConfiguration["settings"]>,
  ): TenantConfiguration;
  getLocation(locationId: string): { location: LocationConfiguration; locationName: string } | undefined;
  updateLocation(
    locationId: string,
    overrides: Partial<LocationConfiguration["overrides"]>,
  ): LocationConfiguration;
  provisionTenant(params: {
    tenantId: string;
    tenantName: string;
    locationId: string;
    locationName: string;
  }): { tenant: TenantConfiguration; location: LocationConfiguration };
  getReviewFormats(): readonly ReviewFormatVersion[];
  getPromptVersions(): readonly PromptVersion[];
  getPriceRates(): readonly PriceRate[];
  getProviderRouting(): ProviderRouting;
}

export function createInMemoryContextStore(): ContextServiceStore {
  let platform: PlatformConfiguration = {
    id: "platform-default",
    revision: "platform-r1",
    defaults: {
      locale: "en-GB",
      toneGuidelines: "Neutral and plain.",
      entryMode: "invite",
      requireDisclosure: false,
      requireVerifiedExperience: false,
      maxReviewFormatsPerRequest: 2,
      bannedTerms: [],
      enabledReviewFormatVersionIds: ["format-concise-v1"],
      enabledCommands: ["generate", "reformat"],
      monthlyBudgetMicros: 1_000_000,
      alertThresholdPct: 80,
    },
  };

  const tenants = new Map<string, { tenant: TenantConfiguration; tenantName: string }>();
  const locations = new Map<string, { location: LocationConfiguration; locationName: string }>();

  // Default seed tenant
  tenants.set("tenant-a", {
    tenantName: "Apex Dental",
    tenant: {
      id: "tenant-a",
      revision: "tenant-r1",
      settings: {
        toneGuidelines: "Warm and professional.",
        requireDisclosure: true,
        maxReviewFormatsPerRequest: 2,
        bannedTerms: ["best ever"],
        enabledReviewFormatVersionIds: ["format-concise-v1"],
        enabledCommands: ["generate", "reformat"],
      },
      factOptions: [
        {
          id: "fact-1",
          version: "fact-1-v1",
          owner: { scope: "tenant", tenantId: "tenant-a" },
          categoryId: "service",
          proposition: "Attentive hygienist.",
          polarity: "positive",
          locale: "en-GB",
          active: true,
          sortOrder: 1,
        },
      ],
    },
  });

  locations.set("location-a", {
    locationName: "Central Clinic",
    location: {
      id: "location-a",
      tenantId: "tenant-a",
      revision: "location-r1",
      overrides: {},
      factOptionAdditions: [],
    },
  });

  const reviewFormats: ReviewFormatVersion[] = [
    {
      id: "format-concise-v1",
      key: "concise-blurb",
      version: "1.0.0",
      displayName: "Concise blurb",
      targetPlatform: "google",
      locale: "any",
      description: { "en-GB": "Brief review." },
      sample: { "en-GB": "Attentive hygienist." },
      constraints: {
        minChars: 40,
        maxChars: 420,
        paragraphs: 1,
        emojiPolicy: "none",
        secondPerson: false,
      },
      supportedCommands: ["generate", "reformat"],
    },
  ];

  const promptVersions: PromptVersion[] = [
    {
      hash: "prompt-gen-v1",
      key: "review.generate",
      commandKind: "generate",
      body: "Draft an authentic review.",
      variables: ["tone", "locale"],
    },
  ];

  const priceRates: PriceRate[] = [
    {
      id: "rate-gemini-flash-lite-2026-08",
      provider: "gemini",
      model: "gemini-3.5-flash-lite",
      inputPerMillionMicros: 3_000_000,
      outputPerMillionMicros: 15_000_000,
      currency: "EUR",
      unit: "token",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveTo: null,
    },
  ];

  const providerRouting: ProviderRouting = {
    version: "routing-v1",
    primaryProvider: "gemini",
    primaryModel: "gemini-3.5-flash-lite",
  };

  return {
    getPlatform: () => platform,
    updatePlatform: (defaults) => {
      platform = {
        ...platform,
        revision: `platform-r${Date.now()}`,
        defaults: { ...platform.defaults, ...defaults },
      };
      return platform;
    },
    getTenant: (id) => tenants.get(id),
    updateTenant: (id, settings) => {
      const existing = tenants.get(id);
      if (!existing) {
        throw new Error(`Tenant ${id} not found.`);
      }
      const updatedTenant: TenantConfiguration = {
        ...existing.tenant,
        revision: `tenant-r${Date.now()}`,
        settings: { ...existing.tenant.settings, ...settings },
      };
      tenants.set(id, { ...existing, tenant: updatedTenant });
      return updatedTenant;
    },
    getLocation: (id) => locations.get(id),
    updateLocation: (id, overrides) => {
      const existing = locations.get(id);
      if (!existing) {
        throw new Error(`Location ${id} not found.`);
      }
      const updatedLocation: LocationConfiguration = {
        ...existing.location,
        revision: `location-r${Date.now()}`,
        overrides: { ...existing.location.overrides, ...overrides },
      };
      locations.set(id, { ...existing, location: updatedLocation });
      return updatedLocation;
    },
    provisionTenant: ({ tenantId, tenantName, locationId, locationName }) => {
      const tenant: TenantConfiguration = {
        id: tenantId,
        revision: `tenant-r${Date.now()}`,
        settings: { ...platform.defaults },
        factOptions: [] as readonly FactOption[],
      };
      const location: LocationConfiguration = {
        id: locationId,
        tenantId,
        revision: `location-r${Date.now()}`,
        overrides: {},
        factOptionAdditions: [],
      };
      tenants.set(tenantId, { tenant, tenantName });
      locations.set(locationId, { location, locationName });
      return { tenant, location };
    },
    getReviewFormats: () => reviewFormats,
    getPromptVersions: () => promptVersions,
    getPriceRates: () => priceRates,
    getProviderRouting: () => providerRouting,
  };
}

export interface ContextServiceOptions {
  readonly store?: ContextServiceStore;
}

export function createContextServiceApp(options: ContextServiceOptions = {}): Hono {
  const store = options.store ?? createInMemoryContextStore();
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", service: "context-service" }));

  app.get("/context/:tenantId/:locationId", (c) => {
    const tenantId = c.req.param("tenantId");
    const locationId = c.req.param("locationId");

    const tenantRecord = store.getTenant(tenantId);
    if (!tenantRecord) {
      return c.json({ error: `Tenant ${tenantId} not found.` }, 404);
    }

    const locationRecord = store.getLocation(locationId);
    if (!locationRecord) {
      return c.json({ error: `Location ${locationId} not found.` }, 404);
    }

    const snapshot: ResolvedConfigSnapshot = buildConfigSnapshot({
      platform: store.getPlatform(),
      tenant: tenantRecord.tenant,
      tenantName: tenantRecord.tenantName,
      location: locationRecord.location,
      locationName: locationRecord.locationName,
      reviewFormats: store.getReviewFormats(),
      promptVersions: store.getPromptVersions(),
      priceRates: store.getPriceRates(),
      providerRouting: store.getProviderRouting(),
    });

    const strongEtag = `"${snapshot.snapshotId}"`;
    const ifNoneMatch = c.req.header("If-None-Match");

    if (
      ifNoneMatch !== undefined &&
      (ifNoneMatch === strongEtag || ifNoneMatch === snapshot.snapshotId)
    ) {
      c.header("ETag", strongEtag);
      return c.body(null, 304);
    }

    c.header("ETag", strongEtag);
    return c.json(snapshot, 200);
  });

  app.post("/admin/platform/settings", async (c) => {
    const role = c.req.header("x-role");
    if (role !== "platform_admin") {
      return c.json({ error: "Forbidden: platform_admin role required." }, 403);
    }

    const body = (await c.req.json()) as Partial<PlatformConfiguration["defaults"]>;
    const updated = store.updatePlatform(body);
    return c.json(updated, 200);
  });

  app.post("/admin/tenants/:tenantId/settings", async (c) => {
    const role = c.req.header("x-role");
    if (role !== "tenant_admin" && role !== "platform_admin") {
      return c.json({ error: "Forbidden: tenant_admin role required." }, 403);
    }

    const tenantId = c.req.param("tenantId");
    const body = (await c.req.json()) as Partial<TenantConfiguration["settings"]>;
    const updated = store.updateTenant(tenantId, body);
    return c.json(updated, 200);
  });

  app.post("/admin/tenants/:tenantId/locations/:locationId/overrides", async (c) => {
    const role = c.req.header("x-role");
    if (
      role !== "location_manager" &&
      role !== "tenant_admin" &&
      role !== "platform_admin"
    ) {
      return c.json({ error: "Forbidden: location_manager role required." }, 403);
    }

    const locationId = c.req.param("locationId");
    const body = (await c.req.json()) as Partial<LocationConfiguration["overrides"]>;
    const updated = store.updateLocation(locationId, body);
    return c.json(updated, 200);
  });

  app.post("/admin/tenants/provision", async (c) => {
    const role = c.req.header("x-role");
    if (role !== "platform_admin") {
      return c.json({ error: "Forbidden: platform_admin role required." }, 403);
    }

    const body = (await c.req.json()) as {
      tenantId: string;
      tenantName: string;
      locationId: string;
      locationName: string;
    };

    const provisioned = store.provisionTenant(body);
    return c.json(
      {
        tenantId: provisioned.tenant.id,
        locationId: provisioned.location.id,
        status: "created",
      },
      201,
    );
  });

  return app;
}
