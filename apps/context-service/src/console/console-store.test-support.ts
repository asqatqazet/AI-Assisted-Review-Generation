import type {
  ConsoleActionKeyDto,
  ConsoleKeywordDto,
  ConsoleReviewDestinationDto,
  ConsoleSettingValueDto,
} from "@review/contracts/console";

import type {
  ConsoleActionRecord,
  ConsoleControlPlaneStoreFactory,
  ConsoleContextVersionRecord,
  ConsoleExperimentRecord,
  ConsoleLocationRecord,
  ConsolePromptRecord,
  ConsoleStore,
  ConsoleStyleRecord,
  ConsoleTenantRecord,
} from "./store.port.js";

/**
 * In-memory Console store used by service tests. It stands in for PostgreSQL
 * at the persistence seam only; every authorization decision under test still
 * runs in the real service.
 */
export interface FakeConsoleData {
  tenants: (ConsoleTenantRecord & {
    readonly category: string;
    readonly plan: string;
    readonly monthlyBudgetMicros: number;
    readonly monthToDateSpendMicros: number;
    readonly status: "active" | "suspended" | "deactivated";
  })[];
  locations: ConsoleLocationRecord[];
  contextVersions: (ConsoleContextVersionRecord & { readonly tenantId: string })[];
  keywords: (ConsoleKeywordDto & {
    readonly tenantId: string;
    readonly locationId: string | null;
    readonly categoryKey: string;
  })[];
  styles: (ConsoleStyleRecord & { readonly tenantId: string })[];
  actions: (ConsoleActionRecord & { readonly tenantId: string })[];
  prompts: (ConsolePromptRecord & { readonly tenantId: string })[];
  experiments: (ConsoleExperimentRecord & { readonly tenantId: string })[];
  destinations: (ConsoleReviewDestinationDto & {
    readonly tenantId: string;
    readonly locationId: string;
  })[];
}

export type FakeConsoleStore = ConsoleStore &
  ConsoleControlPlaneStoreFactory & {
    readonly data: FakeConsoleData;
    readonly calls: string[];
  };

export function createFakeConsoleStore(
  data: FakeConsoleData,
  calls: string[] = [],
): FakeConsoleStore {
  const record = (name: string): void => {
    calls.push(name);
  };
  const tenantOf = (tenantId: string): FakeConsoleData["tenants"][number] | undefined =>
    data.tenants.find((tenant) => tenant.id === tenantId);

  const store: FakeConsoleStore = {
    data,
    calls,
    // One in-memory store stands in for every operator; authorization is the
    // service's job and stays under test.
    forOperator: () => store,

    async readTenant(tenantId) {
      record(`readTenant:${tenantId}`);
      return tenantOf(tenantId) ?? null;
    },

    async listLocations(tenantId) {
      return data.locations.filter((location) => location.tenantId === tenantId);
    },

    async readLocation(tenantId, locationId) {
      record(`readLocation:${tenantId}:${locationId}`);
      return (
        data.locations.find(
          (location) =>
            location.tenantId === tenantId && location.id === locationId,
        ) ?? null
      );
    },

    async createLocation(input) {
      if (
        data.locations.some(
          (location) =>
            location.tenantId === input.tenantId &&
            location.slug === input.slug,
        )
      ) {
        return { status: "slug-taken" };
      }
      data.locations.push({
        id: `location-${input.slug}`,
        tenantId: input.tenantId,
        slug: input.slug,
        name: input.name,
        address: input.address,
        active: true,
        overrides:
          input.entryMode === null ? {} : { entryMode: input.entryMode },
      });
      return { status: "created" };
    },

    async updateLocation(input) {
      const index = data.locations.findIndex(
        (location) =>
          location.tenantId === input.tenantId &&
          location.id === input.locationId,
      );
      const existing = data.locations[index];
      if (existing !== undefined) {
        data.locations[index] = {
          ...existing,
          name: input.name,
          address: input.address,
          active: input.active,
        };
      }
    },

    async saveTenantSettings(input) {
      const index = data.tenants.findIndex(
        (tenant) => tenant.id === input.tenantId,
      );
      const existing = data.tenants[index];
      if (existing !== undefined) {
        data.tenants[index] = {
          ...existing,
          settings: { ...existing.settings, ...input.values },
        };
      }
    },

    async writeLocationOverrides(input) {
      record(`writeLocationOverrides:${JSON.stringify(input.overrides)}`);
      const index = data.locations.findIndex(
        (location) =>
          location.tenantId === input.tenantId &&
          location.id === input.locationId,
      );
      const existing = data.locations[index];
      if (existing !== undefined) {
        data.locations[index] = { ...existing, overrides: input.overrides };
      }
    },

    async readDistribution(tenantId, locationId, publicOrigin) {
      const tenant = tenantOf(tenantId);
      const location = data.locations.find(
        (candidate) =>
          candidate.tenantId === tenantId && candidate.id === locationId,
      );
      if (tenant === undefined || location === undefined) {
        return null;
      }
      const entryMode = (location.overrides["entryMode"] ??
        tenant.settings["entryMode"] ??
        "invite") as "invite" | "open-qr" | "both";
      return {
        surveyUrl: `${new URL(publicOrigin).origin}/s/${tenant.slug}/${location.slug}`,
        entryMode,
        invitationTemplate: `Thanks for visiting ${location.name}.`,
        tableQrCopy: `Scan to review ${location.name}.`,
        counters: { issued: 40, opened: 22, completed: 15 },
      };
    },

    async listDestinations(tenantId, locationId) {
      return data.destinations.filter(
        (destination) =>
          destination.tenantId === tenantId &&
          destination.locationId === locationId,
      );
    },

    async saveDestination(input) {
      const index = data.destinations.findIndex(
        (destination) =>
          destination.tenantId === input.tenantId &&
          destination.locationId === input.locationId &&
          destination.destinationTypeId === input.destinationTypeId,
      );
      const existing = data.destinations[index];
      if (existing === undefined) {
        return { status: "unknown-destination" };
      }
      data.destinations[index] = {
        ...existing,
        platformPlaceId: input.platformPlaceId,
        targetUrl: input.targetUrl,
        enabled: input.enabled,
        configurationState:
          input.platformPlaceId.trim().length === 0 ? "missing" : "valid",
      };
      return { status: "saved" };
    },

    async listContextVersions(tenantId) {
      return data.contextVersions.filter(
        (version) => version.tenantId === tenantId,
      );
    },

    async publishContextVersion(input) {
      data.contextVersions.push({
        tenantId: input.tenantId,
        id: `context-${input.tenantId}-${input.version}`,
        version: input.version,
        createdAt: "2026-08-18T10:00:00.000Z",
        createdBy: input.createdBy,
        context: input.context,
        bannedTerms: [...input.bannedTerms],
      });
    },

    async listKeywords(tenantId, locationId) {
      return data.keywords.filter(
        (keyword) =>
          keyword.tenantId === tenantId &&
          (keyword.locationId === null || keyword.locationId === locationId),
      );
    },

    async createKeyword(input) {
      const tenant = tenantOf(input.tenantId);
      if (
        tenant === undefined ||
        !tenant.keywordCategories.some(
          (category) => category.key === input.categoryKey,
        )
      ) {
        return { status: "unknown-category" };
      }
      data.keywords.push({
        tenantId: input.tenantId,
        locationId: input.locationId,
        id: `keyword-${data.keywords.length + 1}`,
        label: input.label,
        categoryKey: input.categoryKey,
        categoryLabel:
          tenant.keywordCategories.find(
            (category) => category.key === input.categoryKey,
          )?.label ?? input.categoryKey,
        polarity: input.polarity,
        ownerScope: input.locationId === null ? "tenant" : "location",
        active: true,
        sortOrder: data.keywords.length + 1,
        deletable: true,
      });
      return { status: "created" };
    },

    async updateKeyword(input) {
      const index = data.keywords.findIndex(
        (keyword) =>
          keyword.tenantId === input.tenantId && keyword.id === input.keywordId,
      );
      const existing = data.keywords[index];
      if (existing === undefined) {
        return { status: "not-found" };
      }
      data.keywords[index] = {
        ...existing,
        label: input.label,
        polarity: input.polarity,
        active: input.active,
      };
      return { status: "updated" };
    },

    async reorderKeywords(input) {
      data.keywords = data.keywords.map((keyword) => {
        const position = input.orderedKeywordIds.indexOf(keyword.id);
        return position === -1 ? keyword : { ...keyword, sortOrder: position };
      });
    },

    async deleteKeyword(input) {
      const index = data.keywords.findIndex(
        (keyword) =>
          keyword.tenantId === input.tenantId && keyword.id === input.keywordId,
      );
      if (index === -1) {
        return { status: "not-found" };
      }
      data.keywords.splice(index, 1);
      return { status: "deleted" };
    },

    async listStyles(tenantId) {
      return data.styles.filter((style) => style.tenantId === tenantId);
    },

    async setStyleEnablement(input) {
      const index = data.styles.findIndex(
        (style) => style.tenantId === input.tenantId && style.id === input.styleId,
      );
      const existing = data.styles[index];
      if (existing !== undefined) {
        data.styles[index] = {
          ...existing,
          enabled: input.enabled,
          enabledActions: [...input.enabledActions],
        };
      }
    },

    async reorderStyles(input) {
      data.styles = data.styles.map((style) => {
        const position = input.orderedStyleIds.indexOf(style.id);
        return position === -1 ? style : { ...style, sortOrder: position };
      });
    },

    async listActions(tenantId) {
      return data.actions.filter((action) => action.tenantId === tenantId);
    },

    async setActionEnablement(input) {
      const index = data.actions.findIndex(
        (action) =>
          action.tenantId === input.tenantId && action.key === input.action,
      );
      const existing = data.actions[index];
      if (existing !== undefined) {
        data.actions[index] = { ...existing, enabled: input.enabled };
      }
    },

    async listPrompts(tenantId, action) {
      return data.prompts.filter(
        (prompt) =>
          prompt.tenantId === tenantId &&
          (action === null || prompt.action === action),
      );
    },

    async readPrompt(tenantId, promptVersionId) {
      return (
        data.prompts.find(
          (prompt) =>
            prompt.tenantId === tenantId && prompt.id === promptVersionId,
        ) ?? null
      );
    },

    async createPromptVersion(input) {
      data.prompts.push({
        tenantId: input.tenantId,
        id: `prompt-${input.action}-${input.version}`,
        action: input.action,
        version: input.version,
        hash: input.hash,
        status: "draft",
        createdAt: "2026-08-18T10:00:00.000Z",
        createdBy: input.createdBy,
        evaluationScore: null,
        body: input.body,
        variables: [...input.variables],
      });
    },

    async listExperiments(tenantId) {
      return data.experiments.filter(
        (experiment) => experiment.tenantId === tenantId,
      );
    },

    async readExperiment(tenantId, experimentId) {
      return (
        data.experiments.find(
          (experiment) =>
            experiment.tenantId === tenantId && experiment.id === experimentId,
        ) ?? null
      );
    },

    async createExperiment(input) {
      const variants = input.variants.map((variant) => {
        const prompt = data.prompts.find(
          (candidate) =>
            candidate.tenantId === input.tenantId &&
            candidate.id === variant.promptVersionId,
        );
        return { variant, prompt };
      });
      if (variants.some((entry) => entry.prompt === undefined)) {
        return { status: "unknown-prompt" };
      }
      data.experiments.push({
        tenantId: input.tenantId,
        id: `experiment-${data.experiments.length + 1}`,
        action: input.action,
        status: "draft",
        createdAt: "2026-08-18T10:00:00.000Z",
        startedAt: null,
        stoppedAt: null,
        variants: variants.map(({ variant, prompt }) => ({
          promptVersionId: variant.promptVersionId,
          promptVersionHash: prompt!.hash,
          weightPct: variant.weightPct,
          generations: 0,
          accepted: 0,
        })),
        metricsAvailable: true,
      });
      return { status: "created" };
    },

    async setExperimentStatus(input) {
      record(`setExperimentStatus:${input.experimentId}:${input.status}`);
      const index = data.experiments.findIndex(
        (experiment) =>
          experiment.tenantId === input.tenantId &&
          experiment.id === input.experimentId,
      );
      const existing = data.experiments[index];
      if (existing !== undefined) {
        data.experiments[index] = { ...existing, status: input.status };
      }
    },

    async runBench(input) {
      record(`runBench:${input.tenantId}:${input.input.action}`);
      return {
        generationId: "bench-generation-1",
        output: "Deterministic bench draft.",
        claims: [
          { id: "claim-1", text: "The team was attentive.", supportedBy: ["kw-1"] },
        ],
        removedClaims: [
          { text: "Best clinic in Europe.", reason: "unsupported-superlative" },
        ],
        provider: input.input.provider,
        model: "fake-model",
        latencyMs: 120,
        estimatedCost: { amountMicros: 900, currency: "EUR" },
        isBench: true,
      };
    },

    async readOverview() {
      return {
        window: {
          from: "2026-07-19T00:00:00.000Z",
          to: "2026-08-18T00:00:00.000Z",
        },
        metrics: {
          generations: 100,
          accepted: 62,
          acceptanceRate: 0.62,
          totalCost: { amountMicros: 82_000, currency: "EUR" },
          costPerAccepted: { amountMicros: 1322, currency: "EUR" },
        },
        byAction: [],
        byLocation: [],
        byTenant: [],
        experiment: null,
        providerHealth: [],
        alerts: [],
      };
    },

    async readAnalytics() {
      return [];
    },

    async readGenerationDetail() {
      return null;
    },

    async listPlatformTenants() {
      return data.tenants.map((tenant) => ({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        locale: tenant.locale,
        category: tenant.category,
        locationCount: data.locations.filter(
          (location) => location.tenantId === tenant.id,
        ).length,
        plan: tenant.plan,
        monthToDateSpend: {
          amountMicros: tenant.monthToDateSpendMicros,
          currency: "EUR",
        },
        monthlyBudget: {
          amountMicros: tenant.monthlyBudgetMicros,
          currency: "EUR",
        },
        status: tenant.status,
        suspendable: tenant.status !== "deactivated",
      }));
    },

    async setTenantStatus(input) {
      const index = data.tenants.findIndex(
        (tenant) => tenant.id === input.tenantId,
      );
      const existing = data.tenants[index];
      if (existing === undefined) {
        return { status: "not-found" };
      }
      data.tenants[index] = { ...existing, status: input.status };
      return { status: "saved" };
    },

    async createKeywordCategory(input) {
      const index = data.tenants.findIndex(
        (tenant) => tenant.id === input.tenantId,
      );
      const existing = data.tenants[index];
      if (existing === undefined) {
        return { status: "key-taken" };
      }
      if (
        existing.keywordCategories.some(
          (category) => category.key === input.key,
        )
      ) {
        return { status: "key-taken" };
      }
      data.tenants[index] = {
        ...existing,
        keywordCategories: [
          ...existing.keywordCategories,
          {
            key: input.key,
            label: input.label,
            sortOrder: existing.keywordCategories.length,
          },
        ],
      };
      return { status: "created" };
    },

    async createTenant(input) {
      if (data.tenants.some((tenant) => tenant.slug === input.slug)) {
        return { status: "slug-taken" };
      }
      data.tenants.push({
        id: `tenant-${input.slug}`,
        slug: input.slug,
        name: input.name,
        locale: input.locale,
        category: input.category,
        plan: input.plan,
        monthlyBudgetMicros: 1_000_000,
        monthToDateSpendMicros: 0,
        status: "active",
        settings: defaultTenantSettings(input.locale),
        keywordCategories: [{ key: "service", label: "Service", sortOrder: 0 }],
      });
      return { status: "created" };
    },

    async readPlatformProviders() {
      return {
        models: [
          {
            providerKey: "fake",
            providerName: "Deterministic test provider",
            modelKey: "fake-model",
            modelName: "Fake",
            health: "healthy",
            credentialState: "configured",
            supportsStreaming: true,
            supportsStructuredOutput: true,
            maxTokens: 4096,
            routingPriority: 1,
            fallbackPriority: null,
          },
        ],
        priceVersions: [],
      };
    },

    async setProviderRouting() {
      return { status: "saved" };
    },

    async publishPriceRate() {
      return { status: "published" };
    },

    async listPlatformStyles() {
      return data.styles.map((style) => ({
        id: style.id,
        key: style.key,
        name: style.name,
        version: style.version,
        locale: style.locale,
        targetPlatform: style.targetPlatform,
        maxChars: style.maxChars,
        supportedActions: [...style.supportedActions],
        validationStatus: style.validationStatus,
        status: "active" as const,
      }));
    },

    async importPlatformStyle() {
      return { status: "imported" };
    },

    async readPlatformSettings() {
      return {
        defaultPolicyTemplate: "{}",
        globalRateLimits: {
          perReviewSessionPerHour: 20,
          perTenantPerMinute: 60,
          maxConcurrentGenerations: 4,
        },
        logRetentionDays: 30,
        featureFlags: [],
      };
    },

    async savePlatformSettings() {
      record("savePlatformSettings");
    },
  };

  return store;
}

export function defaultTenantSettings(
  locale: "en-GB" | "de-DE",
): Readonly<Record<string, ConsoleSettingValueDto>> {
  return {
    locale,
    toneGuidelines: "Plain, factual, first person.",
    entryMode: "invite",
    requireDisclosure: true,
    requireVerifiedExperience: true,
    maxReviewFormatsPerRequest: 2,
    bannedTerms: ["cure"],
    monthlyBudgetMicros: 1_000_000,
    alertThresholdPct: 80,
  };
}

export const ALL_ACTIONS: readonly ConsoleActionKeyDto[] = [
  "generate",
  "paraphrase",
  "resample",
  "reformat",
  "condense",
  "expand",
  "revise-wording",
  "add-assertion",
];
