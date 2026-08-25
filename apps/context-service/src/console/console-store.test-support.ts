import type {
  ConsoleActionKeyDto,
  ConsoleConfigurationDraftChangeDto,
  ConsolePlatformConfigurationDraftChangeDto,
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
  publishedSnapshots?: readonly {
    readonly tenantId: string;
    readonly locationId: string;
    readonly contentHash: string;
    readonly payload: unknown;
  }[];
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
  type Change = ConsoleConfigurationDraftChangeDto;
  const configurationRevisions = new Map<string, number>();
  const configurationDrafts = new Map<
    string,
    {
      readonly id: string;
      readonly revision: number;
      readonly baseRevision: number;
      readonly changes: readonly Change[];
    }
  >();
  let nextConfigurationDraftId = 1;
  type PlatformChange = ConsolePlatformConfigurationDraftChangeDto;
  let platformRevision = 1;
  let platformDraft:
    | {
        readonly id: string;
        readonly revision: number;
        readonly baseRevision: number;
        readonly changes: readonly PlatformChange[];
      }
    | undefined;
  let nextPlatformDraftId = 1;
  const platformPublicationReceipts = new Map<
    string,
    { readonly revision: number; readonly snapshotIds: readonly string[] }
  >();
  let platformSettings = {
    defaultPolicyTemplate: "{}",
    globalRateLimits: {
      perReviewSessionPerHour: 20,
      perTenantPerMinute: 60,
      maxConcurrentGenerations: 4,
    },
    logRetentionDays: 30,
    featureFlags: [] as { key: string; description: string; enabled: boolean }[],
  };
  let platformModels = [
    {
      providerKey: "fake",
      providerName: "Deterministic test provider",
      modelKey: "fake-model",
      modelName: "Fake",
      health: "healthy" as const,
      credentialState: "configured" as const,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      maxTokens: 4096,
      routingPriority: 1 as number | null,
      fallbackPriority: null as number | null,
    },
  ];
  let platformPriceVersions: {
    id: string;
    providerKey: string;
    modelKey: string;
    inputPerMillion: { amountMicros: number; currency: string };
    outputPerMillion: { amountMicros: number; currency: string };
    validFrom: string;
    validTo: string | null;
    superseded: boolean;
  }[] = [];
  const configurationKey = (
    tenantId: string,
    locationId: string | null,
  ): string => `${tenantId}:${locationId ?? "tenant"}`;
  const configurationChangeKey = (change: Change): string => {
    if ("key" in change && !("operation" in change)) {
      return `tenant-setting:${change.key}`;
    }
    switch (change.operation) {
      case "set-location-override":
        return `location-override:${change.change.key}`;
      case "reset-location-override":
        return `location-override:${change.key}`;
      case "create-fact-option":
        return `create-fact-option:${change.mutationId}`;
      case "update-fact-option":
      case "delete-fact-option":
        return `fact-option:${change.keywordId}`;
      case "reorder-fact-options":
        return "fact-option-order";
      case "set-review-format-enablement":
        return `review-format:${change.styleId}`;
      case "reorder-review-formats":
        return "review-format-order";
      case "set-action-enablement":
        return `action:${change.action}`;
      case "deploy-prompt-version":
        return `prompt-deployment:${change.action}`;
    }
  };
  const platformChangeKey = (change: PlatformChange): string => {
    switch (change.operation) {
      case "save-platform-settings":
        return "platform-settings";
      case "set-provider-routing":
        return "provider-routing";
      case "publish-price-rate":
        return `price-rate:${change.providerKey}:${change.modelKey}:${change.validFrom}`;
    }
  };
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

    async listSelectableTenants() {
      return data.tenants.map((tenant) => ({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        locations: data.locations
          .filter((location) => location.tenantId === tenant.id)
          .map((location) => ({
            id: location.id,
            slug: location.slug,
            name: location.name,
            active: location.active,
          })),
      }));
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

    async readPublishedConfigurationSnapshot(input) {
      record(
        `readPublishedConfigurationSnapshot:${input.tenantId}:${input.locationId}`,
      );
      const snapshot = data.publishedSnapshots?.find(
        (candidate) =>
          candidate.tenantId === input.tenantId &&
          candidate.locationId === input.locationId,
      );
      return snapshot === undefined
        ? null
        : { contentHash: snapshot.contentHash, payload: snapshot.payload };
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

    async readConfigurationState(input) {
      const tenant = tenantOf(input.tenantId);
      const location =
        input.locationId === null
          ? null
          : data.locations.find(
              (candidate) =>
                candidate.tenantId === input.tenantId &&
                candidate.id === input.locationId,
            );
      if (tenant === undefined || (input.locationId !== null && location === undefined)) {
        return null;
      }
      const key = configurationKey(input.tenantId, input.locationId);
      const revision = configurationRevisions.get(key) ?? 1;
      const draft = configurationDrafts.get(key) ?? null;
      return {
        revision: String(revision),
        draft:
          draft === null
            ? null
            : {
                id: draft.id,
                revision: String(draft.revision),
                baseRevision: String(draft.baseRevision),
                changes: draft.changes,
              },
      };
    },

    async saveConfigurationDraft(input) {
      const key = configurationKey(input.tenantId, input.locationId);
      const revision = configurationRevisions.get(key) ?? 1;
      if (String(revision) !== input.expectedRevision) {
        return { status: "conflict" };
      }
      const existing = configurationDrafts.get(key);
      if (
        (existing === undefined && input.expectedDraft !== null) ||
        (existing !== undefined &&
          (input.expectedDraft === null ||
            input.expectedDraft.id !== existing.id ||
            input.expectedDraft.revision !== String(existing.revision)))
      ) {
        return { status: "conflict" };
      }
      const previous = existing?.changes ?? [];
      const byKey = new Map(
        previous.map((change) => [configurationChangeKey(change), change]),
      );
      for (const change of input.changes) {
        byKey.set(configurationChangeKey(change), change);
      }
      configurationDrafts.set(key, {
        id: existing?.id ?? `configuration-draft-${nextConfigurationDraftId++}`,
        revision: (existing?.revision ?? 0) + 1,
        baseRevision: existing?.baseRevision ?? revision,
        changes: [...byKey.values()],
      });
      record(`saveConfigurationDraft:${key}:${input.actorId}`);
      return { status: "saved" };
    },

    async cancelConfigurationDraft(input) {
      const key = configurationKey(input.tenantId, input.locationId);
      const revision = configurationRevisions.get(key) ?? 1;
      if (String(revision) !== input.expectedRevision) {
        return { status: "conflict" };
      }
      const existing = configurationDrafts.get(key);
      if (
        existing === undefined ||
        input.expectedDraft === null ||
        input.expectedDraft.id !== existing.id ||
        input.expectedDraft.revision !== String(existing.revision)
      ) {
        return { status: "conflict" };
      }
      configurationDrafts.delete(key);
      record(`cancelConfigurationDraft:${key}`);
      return { status: "cancelled" };
    },

    async publishConfiguration(input) {
      const key = configurationKey(input.tenantId, input.locationId);
      const revision = configurationRevisions.get(key) ?? 1;
      if (String(revision) !== input.expectedRevision) {
        return { status: "conflict" };
      }
      const draft = configurationDrafts.get(key);
      if (
        draft === undefined ||
        input.expectedDraft === null ||
        input.expectedDraft.id !== draft.id ||
        input.expectedDraft.revision !== String(draft.revision) ||
        draft.baseRevision !== revision
      ) {
        return { status: "no-draft" };
      }
      for (const change of draft.changes) {
        if (
          "operation" in change &&
          change.operation === "deploy-prompt-version"
        ) {
          const prompt = data.prompts.find(
            (candidate) =>
              candidate.tenantId === input.tenantId &&
              candidate.id === change.promptVersionId &&
              candidate.action === change.action,
          );
          if (
            prompt === undefined ||
            prompt.status !== "candidate" ||
            prompt.evaluationScore !== 1
          ) {
            return {
              status: "incomplete",
              missing: [
                `a quality-gated Prompt Version ${change.promptVersionId}`,
              ],
            };
          }
        }
      }
      if (input.locationId === null) {
        const tenantIndex = data.tenants.findIndex(
          (tenant) => tenant.id === input.tenantId,
        );
        const tenant = data.tenants[tenantIndex];
        if (tenant === undefined) {
          return { status: "conflict" };
        }
        const tenantSettingChanges = draft.changes.filter(
          (change): change is Extract<
            Change,
            { readonly key: string; readonly value: unknown }
          > =>
            "key" in change && !("operation" in change),
        );
        data.tenants[tenantIndex] = {
          ...tenant,
          tenantValues: {
            ...tenant.tenantValues,
            ...Object.fromEntries(
              tenantSettingChanges.map((change) => [change.key, change.value]),
            ),
          },
          settings: {
            ...tenant.settings,
            ...Object.fromEntries(
              tenantSettingChanges.map((change) => [change.key, change.value]),
            ),
          },
        };
      } else {
        const locationIndex = data.locations.findIndex(
          (location) =>
            location.tenantId === input.tenantId &&
            location.id === input.locationId,
        );
        const location = data.locations[locationIndex];
        if (location === undefined) {
          return { status: "conflict" };
        }
        const overrides = { ...location.overrides };
        for (const change of draft.changes) {
          if (!("operation" in change)) {
            continue;
          }
          if (change.operation === "set-location-override") {
            overrides[change.change.key] = change.change.value;
          } else if (change.operation === "reset-location-override") {
            delete overrides[change.key];
          }
        }
        data.locations[locationIndex] = { ...location, overrides };
      }
      for (const change of draft.changes) {
        if (!("operation" in change)) {
          continue;
        }
        switch (change.operation) {
          case "create-fact-option":
            data.keywords.push({
              id: change.mutationId,
              tenantId: input.tenantId,
              locationId:
                change.ownerScope === "location" ? input.locationId : null,
              label: change.label,
              categoryKey: change.categoryKey,
              categoryLabel:
                tenantOf(input.tenantId)?.keywordCategories.find(
                  (category) => category.key === change.categoryKey,
                )?.label ?? change.categoryKey,
              polarity: change.polarity,
              ownerScope: change.ownerScope,
              active: true,
              sortOrder: data.keywords.length,
              deletable: true,
            });
            break;
          case "update-fact-option": {
            const index = data.keywords.findIndex(
              (keyword) =>
                keyword.tenantId === input.tenantId &&
                keyword.id === change.keywordId,
            );
            const keyword = data.keywords[index];
            if (keyword !== undefined) {
              data.keywords[index] = {
                ...keyword,
                label: change.label,
                polarity: change.polarity,
                active: change.active,
              };
            }
            break;
          }
          case "reorder-fact-options":
            for (const [index, keywordId] of change.orderedKeywordIds.entries()) {
              const keywordIndex = data.keywords.findIndex(
                (keyword) => keyword.id === keywordId,
              );
              const keyword = data.keywords[keywordIndex];
              if (keyword !== undefined) {
                data.keywords[keywordIndex] = { ...keyword, sortOrder: index };
              }
            }
            break;
          case "delete-fact-option": {
            const index = data.keywords.findIndex(
              (keyword) => keyword.id === change.keywordId,
            );
            const keyword = data.keywords[index];
            if (keyword !== undefined) {
              data.keywords[index] = { ...keyword, active: false };
            }
            break;
          }
          case "set-review-format-enablement": {
            const index = data.styles.findIndex(
              (style) => style.id === change.styleId,
            );
            const style = data.styles[index];
            if (style !== undefined) {
              data.styles[index] = {
                ...style,
                enabled: change.enabled,
                enabledActions: [...change.enabledActions],
              };
            }
            break;
          }
          case "reorder-review-formats":
            for (const [index, styleId] of change.orderedStyleIds.entries()) {
              const styleIndex = data.styles.findIndex(
                (style) => style.id === styleId,
              );
              const style = data.styles[styleIndex];
              if (style !== undefined) {
                data.styles[styleIndex] = { ...style, sortOrder: index };
              }
            }
            break;
          case "set-action-enablement": {
            const index = data.actions.findIndex(
              (action) => action.key === change.action,
            );
            const action = data.actions[index];
            if (action !== undefined) {
              data.actions[index] = { ...action, enabled: change.enabled };
            }
            break;
          }
          case "deploy-prompt-version":
            data.prompts = data.prompts.map((prompt) =>
              prompt.tenantId !== input.tenantId
                ? prompt
                : prompt.action !== change.action
                  ? prompt
                  : prompt.id === change.promptVersionId
                  ? { ...prompt, status: "published" }
                  : prompt.status === "published"
                    ? { ...prompt, status: "candidate" }
                    : prompt,
            );
            break;
          case "set-location-override":
          case "reset-location-override":
            break;
        }
      }
      configurationDrafts.delete(key);
      configurationRevisions.set(key, revision + 1);
      const affectedLocations =
        input.locationId === null
          ? data.locations.filter(
              (location) => location.tenantId === input.tenantId,
            )
          : data.locations.filter(
              (location) => location.id === input.locationId,
            );
      const snapshotIds = affectedLocations.map((location) => {
        record(`materializeConfiguration:${input.tenantId}:${location.id}`);
        return `snapshot-${location.id}-${revision + 1}`;
      });
      record(`publishConfiguration:${key}:${input.actorId}`);
      return {
        status: "published",
        snapshotIds,
        configurationReleaseId:
          input.configurationReleaseId ??
          "00000000-0000-4000-8000-000000000034",
      };
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

    async promotePromptVersion(input) {
      const target = data.prompts.find(
        (prompt) =>
          prompt.tenantId === input.tenantId &&
          prompt.id === input.promptVersionId,
      );
      if (target === undefined) {
        return { status: "unknown-prompt" };
      }
      if (
        (target.status !== "draft" && target.status !== "candidate") ||
        target.evaluationScore !== 1
      ) {
        return { status: "quality-gate-rejected" };
      }
      data.prompts = data.prompts.map((prompt) =>
        prompt.id === target.id
          ? { ...prompt, status: "candidate" as const }
          : prompt,
      );
      return { status: "candidate" };
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
      if (
        new Set(input.variants.map((variant) => variant.promptVersionId)).size !==
        input.variants.length
      ) {
        return { status: "invalid-variants" };
      }
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
      if (
        variants.some(
          ({ prompt }) =>
            prompt!.action !== input.action ||
            prompt!.evaluationScore !== 1 ||
            prompt!.status === "draft" ||
            prompt!.status === "retired",
        )
      ) {
        return { status: "invalid-variants" };
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
      if (existing === undefined) {
        return { status: "unknown-experiment" };
      }
      if (input.status === "stopped") {
        if (existing.status !== "running") {
          return { status: "invalid-transition" };
        }
        data.experiments[index] = { ...existing, status: "stopped" };
        return { status: "changed" };
      }
      if (existing.status === "running") {
        return { status: "action-already-running" };
      }
      if (existing.status !== "draft") {
        return { status: "invalid-transition" };
      }
      if (
        data.experiments.some(
          (experiment) =>
            experiment.tenantId === input.tenantId &&
            experiment.action === existing.action &&
            experiment.status === "running",
        )
      ) {
        return { status: "action-already-running" };
      }
      const prompts = existing.variants.map((variant) =>
        data.prompts.find(
          (prompt) =>
            prompt.tenantId === input.tenantId &&
            prompt.id === variant.promptVersionId,
        ),
      );
      if (
        prompts.some(
          (prompt) =>
            prompt === undefined ||
            prompt.action !== existing.action ||
            prompt.evaluationScore !== 1 ||
            prompt.status === "draft" ||
            prompt.status === "retired",
        )
      ) {
        return { status: "quality-gate-rejected" };
      }
      data.experiments[index] = { ...existing, status: "running" };
      return { status: "changed" };
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
        guard: {
          verdict: "passed",
          supportedClaimIds: ["claim-1"],
          removedClaimCount: 1,
        },
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
        platformDefaults: defaultTenantSettings(input.locale),
        tenantValues: {
          locale: input.locale,
          entryMode: "open-qr",
        },
        settings: defaultTenantSettings(input.locale),
        keywordCategories: [{ key: "service", label: "Service", sortOrder: 0 }],
      });
      return { status: "created" };
    },

    async readPlatformProviders() {
      return {
        models: platformModels.map((model) => ({ ...model })),
        priceVersions: platformPriceVersions.map((rate) => ({ ...rate })),
      };
    },

    async readPlatformConfigurationState() {
      return {
        revision: String(platformRevision),
        draft:
          platformDraft === undefined
            ? null
            : {
                id: platformDraft.id,
                revision: String(platformDraft.revision),
                baseRevision: String(platformDraft.baseRevision),
                changes: platformDraft.changes,
              },
      };
    },

    async savePlatformConfigurationDraft(input) {
      if (
        String(platformRevision) !== input.expectedRevision ||
        (platformDraft === undefined && input.expectedDraft !== null) ||
        (platformDraft !== undefined &&
          (input.expectedDraft === null ||
            input.expectedDraft.id !== platformDraft.id ||
            input.expectedDraft.revision !== String(platformDraft.revision)))
      ) {
        return { status: "conflict" };
      }
      const merged = new Map(
        (platformDraft?.changes ?? []).map((change) => [
          platformChangeKey(change),
          change,
        ]),
      );
      for (const change of input.changes) {
        merged.set(platformChangeKey(change), change);
      }
      platformDraft = {
        id:
          platformDraft?.id ??
          `platform-configuration-draft-${nextPlatformDraftId++}`,
        revision: (platformDraft?.revision ?? 0) + 1,
        baseRevision: platformDraft?.baseRevision ?? platformRevision,
        changes: [...merged.values()],
      };
      record(`savePlatformConfigurationDraft:${input.actorId}`);
      return { status: "saved" };
    },

    async cancelPlatformConfigurationDraft(input) {
      if (
        String(platformRevision) !== input.expectedRevision ||
        platformDraft === undefined ||
        input.expectedDraft === null ||
        input.expectedDraft.id !== platformDraft.id ||
        input.expectedDraft.revision !== String(platformDraft.revision)
      ) {
        return { status: "conflict" };
      }
      platformDraft = undefined;
      record("cancelPlatformConfigurationDraft");
      return { status: "cancelled" };
    },

    async publishPlatformConfiguration(input) {
      const receiptKey =
        input.expectedDraft === null
          ? "none"
          : `${input.expectedDraft.id}:${input.expectedDraft.revision}`;
      if (String(platformRevision) !== input.expectedRevision) {
        const completed = platformPublicationReceipts.get(receiptKey);
        return completed !== undefined &&
          completed.revision === Number(input.expectedRevision) + 1
          ? { status: "published", snapshotIds: completed.snapshotIds }
          : { status: "conflict" };
      }
      if (
        platformDraft === undefined ||
        input.expectedDraft === null ||
        input.expectedDraft.id !== platformDraft.id ||
        input.expectedDraft.revision !== String(platformDraft.revision) ||
        platformDraft.baseRevision !== platformRevision
      ) {
        return { status: "no-draft" };
      }

      let nextSettings = structuredClone(platformSettings);
      let nextModels = platformModels.map((model) => ({ ...model }));
      let nextRates = platformPriceVersions.map((rate) => ({
        ...rate,
        inputPerMillion: { ...rate.inputPerMillion },
        outputPerMillion: { ...rate.outputPerMillion },
      }));
      for (const change of platformDraft.changes) {
        switch (change.operation) {
          case "save-platform-settings": {
            try {
              const parsed = JSON.parse(change.defaultPolicyTemplate) as unknown;
              if (
                typeof parsed !== "object" ||
                parsed === null ||
                Array.isArray(parsed)
              ) {
                return {
                  status: "incomplete",
                  missing: ["a valid Platform default policy object"],
                };
              }
            } catch {
              return {
                status: "incomplete",
                missing: ["a valid Platform default policy object"],
              };
            }
            nextSettings = {
              ...change,
              featureFlags: change.featureFlags.map((flag) => ({
                ...flag,
                description:
                  nextSettings.featureFlags.find(
                    (candidate) => candidate.key === flag.key,
                  )?.description ?? "",
              })),
            };
            break;
          }
          case "set-provider-routing": {
            const selected = nextModels.find(
              (model) =>
                model.providerKey === change.providerKey &&
                model.modelKey === change.modelKey,
            );
            if (
              selected === undefined ||
              change.routingPriority !== 1 ||
              change.fallbackPriority !== null
            ) {
              return {
                status: "incomplete",
                missing: ["exactly one primary Provider route"],
              };
            }
            const previous = nextModels.find(
              (model) => model.routingPriority === 1,
            );
            nextModels = nextModels.map((model) => ({
              ...model,
              routingPriority: model === selected ? 1 : null,
              fallbackPriority:
                previous !== undefined &&
                previous.providerKey === model.providerKey &&
                previous.modelKey === model.modelKey &&
                model !== selected
                  ? 1
                  : null,
            }));
            break;
          }
          case "publish-price-rate": {
            const model = nextModels.find(
              (candidate) =>
                candidate.providerKey === change.providerKey &&
                candidate.modelKey === change.modelKey,
            );
            const validFrom = Date.parse(change.validFrom);
            const latest = nextRates
              .filter(
                (rate) =>
                  rate.providerKey === change.providerKey &&
                  rate.modelKey === change.modelKey,
              )
              .sort((left, right) =>
                right.validFrom.localeCompare(left.validFrom),
              )[0];
            if (
              model === undefined ||
              !Number.isFinite(validFrom) ||
              validFrom < Date.now() ||
              (latest !== undefined &&
                Date.parse(latest.validFrom) >= validFrom)
            ) {
              return {
                status: "incomplete",
                missing: ["effective non-overlapping Price Rates"],
              };
            }
            if (latest !== undefined && latest.validTo === null) {
              nextRates = nextRates.map((rate) =>
                rate.id === latest.id
                  ? { ...rate, validTo: change.validFrom, superseded: true }
                  : rate,
              );
            }
            nextRates.push({
              id: `price-${nextRates.length + 1}`,
              providerKey: change.providerKey,
              modelKey: change.modelKey,
              inputPerMillion: {
                amountMicros: change.inputMicrosPerMillion,
                currency: change.currency,
              },
              outputPerMillion: {
                amountMicros: change.outputMicrosPerMillion,
                currency: change.currency,
              },
              validFrom: change.validFrom,
              validTo: null,
              superseded: false,
            });
            break;
          }
        }
      }
      if (nextModels.filter((model) => model.routingPriority === 1).length !== 1) {
        return {
          status: "incomplete",
          missing: ["exactly one primary Provider route"],
        };
      }
      platformSettings = nextSettings;
      platformModels = nextModels;
      platformPriceVersions = nextRates;
      platformRevision += 1;
      const snapshotIds = data.locations.map(
        (location) => `platform-snapshot-${platformRevision}-${location.id}`,
      );
      platformPublicationReceipts.set(receiptKey, {
        revision: platformRevision,
        snapshotIds,
      });
      platformDraft = undefined;
      record(`publishPlatformConfiguration:${input.actorId}`);
      return { status: "published", snapshotIds };
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
      return structuredClone(platformSettings);
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
