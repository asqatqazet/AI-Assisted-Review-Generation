import type {
  ConsoleBootstrapDto,
  ConsoleCommandDto,
  ConsolePromptComparisonDto,
  ConsolePromptVersionDto,
  ConsoleQueryDto,
  ConsoleRequestInvocationDto,
  ConsoleRequestInvocationResultDto,
} from "@review/contracts/console";
import type {
  OperatorAccessProjectionDto,
  OperatorIdentityDto,
} from "@review/contracts/context";
import {
  applyLocationOverride,
  clearLocationOverride,
  decideExperimentMutation,
  deriveConsoleCapabilities,
  deriveConsoleRole,
  nextPublishedVersion,
  validateReviewDestination,
  validateVariantWeights,
} from "@review/domain/console";
import { derivePromptVersionHash } from "@review/domain/experiment";

import { validateStyleManifest } from "./manifest-rules.js";
import {
  projectActions,
  projectContext,
  projectDistribution,
  projectKeywords,
  projectLocationSettings,
  projectLocations,
  projectStyleDetail,
  projectStyles,
  projectTenantSettings,
  styleIncompatibility,
} from "./projections.js";
import {
  COMMAND_POLICIES,
  QUERY_POLICIES,
  resolveConsoleScope,
  type ResolvedScope,
} from "./scope.js";
import type {
  ConsoleControlPlaneStore,
  ConsoleControlPlaneStoreFactory,
  ConsoleExecutionStore,
  ConsolePromptRecord,
} from "./store.port.js";

type Result = ConsoleRequestInvocationResultDto["result"];
type AuthorizedAccess = Extract<
  OperatorAccessProjectionDto,
  { status: "authorized" }
>;

const NOT_FOUND: Result = { status: "not-found" };

export interface ConsoleServiceOptions {
  readonly store: ConsoleControlPlaneStoreFactory;
  /**
   * Absent until the execution-plane reader lands. Views that need Generation
   * history then answer with the same not-found projection as an unauthorized
   * scope rather than inventing zeroes.
   */
  readonly executionStore?: ConsoleExecutionStore | undefined;
  readonly resolveAccess: (
    identity: OperatorIdentityDto,
  ) => Promise<OperatorAccessProjectionDto>;
  readonly now?: (() => Date) | undefined;
  readonly overviewWindowDays?: number | undefined;
}

export interface ConsoleService {
  request(
    input: ConsoleRequestInvocationDto["input"],
  ): Promise<Result>;
}

export function createConsoleService({
  store,
  executionStore,
  resolveAccess,
  now = () => new Date(),
  overviewWindowDays = 30,
}: ConsoleServiceOptions): ConsoleService {
  return {
    async request(input) {
      const access = await resolveAccess(input.identity);
      if (access.status !== "authorized") {
        return NOT_FOUND;
      }

      const policy =
        input.request.mode === "query"
          ? QUERY_POLICIES[input.request.query.view]
          : COMMAND_POLICIES[input.request.command.command];

      const scopedStore = store.forOperator(access.operator.id);
      const scope = await resolveConsoleScope({
        access,
        request: input.scope,
        policy,
        store: scopedStore,
      });
      if (scope.status === "denied") {
        return NOT_FOUND;
      }

      return input.request.mode === "query"
        ? await runQuery({
            query: input.request.query,
            access,
            scope,
            publicOrigin: input.publicOrigin,
            store: scopedStore,
            executionStore,
            now,
            overviewWindowDays,
          })
        : await runCommand({
            command: input.request.command,
            access,
            scope,
            store: scopedStore,
            executionStore,
            now,
          });
    },
  };
}

function bootstrap(access: AuthorizedAccess): ConsoleBootstrapDto {
  const capabilities = deriveConsoleCapabilities(access);
  const firstTenant = access.tenantGrants[0];
  return {
    user: { id: access.operator.id, displayName: access.operator.email },
    role: deriveConsoleRole(access),
    tenants: access.tenantGrants.map((grant) => ({
      id: grant.tenantId,
      slug: grant.tenantSlug,
      name: grant.tenantName,
      locations: grant.locations.map((location) => ({
        id: location.locationId,
        slug: location.locationSlug,
        name: location.locationName,
        active: location.status === "active",
      })),
    })),
    activeContext: {
      // A Platform administrator lands on Platform scope; everyone else on
      // the single Tenant their Grants already imply.
      tenantId: capabilities.canAccessPlatform
        ? null
        : (firstTenant?.tenantId ?? null),
      locationId: null,
    },
    capabilities,
  };
}

type ResolvedOk = Extract<ResolvedScope, { status: "resolved" }>;

async function runQuery({
  query,
  access,
  scope,
  publicOrigin,
  store,
  executionStore,
  now,
  overviewWindowDays,
}: {
  readonly query: ConsoleQueryDto;
  readonly access: AuthorizedAccess;
  readonly scope: ResolvedOk;
  readonly publicOrigin: string | null;
  readonly store: ConsoleControlPlaneStore;
  readonly executionStore: ConsoleExecutionStore | undefined;
  readonly now: () => Date;
  readonly overviewWindowDays: number;
}): Promise<Result> {
  const capabilities = deriveConsoleCapabilities(access);
  const editable = capabilities.canManageConfiguration;

  const view = asView;

  switch (query.view) {
    case "bootstrap":
      return view({ view: "bootstrap", data: bootstrap(access) });

    case "overview": {
      // Reached only by an operator already authorized for this scope, so the
      // answer is about the deployment rather than about them.
      if (executionStore === undefined) {
        return rejected(
          "VIEW_NOT_AVAILABLE",
          "Generation history is not available in this deployment yet, so this view cannot be built. Configuration screens are unaffected.",
        );
      }
      const to = now();
      const from = new Date(
        to.getTime() - overviewWindowDays * 24 * 60 * 60 * 1000,
      );
      const data = await executionStore.readOverview({
        scope: scope.selector,
        from: from.toISOString(),
        to: to.toISOString(),
      });
      return view({
        view: "overview",
        data: { ...data, scope: scope.scope },
      });
    }

    case "locations": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      return view({
        view: "locations",
        data: projectLocations({
          scope: scope.scope,
          tenant,
          locations: await store.listLocations(tenant.id),
          editable: capabilities.canManageLocations,
        }),
      });
    }

    case "tenant-settings": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      return view({
        view: "tenant-settings",
        data: projectTenantSettings({ scope: scope.scope, tenant, editable }),
      });
    }

    case "location-settings": {
      const resolved = await requireLocation(store, scope);
      if (resolved === null) {
        return NOT_FOUND;
      }
      return view({
        view: "location-settings",
        data: projectLocationSettings({
          scope: scope.scope,
          tenant: resolved.tenant,
          location: resolved.location,
          editable,
        }),
      });
    }

    case "distribution": {
      // Without a known edge origin the link and QR would point somewhere the
      // reviewer cannot reach, so none is offered at all.
      if (
        scope.tenantId === null ||
        scope.locationId === null ||
        publicOrigin === null
      ) {
        return NOT_FOUND;
      }
      const distribution = await store.readDistribution(
        scope.tenantId,
        scope.locationId,
        publicOrigin,
      );
      return distribution === null
        ? NOT_FOUND
        : view({
            view: "distribution",
            data: projectDistribution({ scope: scope.scope, distribution }),
          });
    }

    case "destinations": {
      if (scope.tenantId === null || scope.locationId === null) {
        return NOT_FOUND;
      }
      return view({
        view: "destinations",
        data: {
          scope: scope.scope,
          editable: capabilities.canManageConfiguration,
          destinations: [
            ...(await store.listDestinations(scope.tenantId, scope.locationId)),
          ],
        },
      });
    }

    case "context": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      return view({
        view: "context",
        data: projectContext({
          scope: scope.scope,
          versions: await store.listContextVersions(scope.tenantId),
          editable,
        }),
      });
    }

    case "keywords": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      return view({
        view: "keywords",
        data: projectKeywords({
          scope: scope.scope,
          tenant,
          keywords: [
            ...(await store.listKeywords(tenant.id, scope.locationId)),
          ],
          editable,
        }),
      });
    }

    case "styles": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      return view({
        view: "styles",
        data: projectStyles({
          scope: scope.scope,
          styles: await store.listStyles(tenant.id),
          tenantLocale: tenant.locale,
          editable,
        }),
      });
    }

    case "style-detail": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      const style = (await store.listStyles(tenant.id)).find(
        (candidate) => candidate.id === query.styleId,
      );
      return style === undefined
        ? NOT_FOUND
        : view({
            view: "style-detail",
            data: projectStyleDetail({
              scope: scope.scope,
              style,
              tenantLocale: tenant.locale,
              validation: null,
            }),
          });
    }

    case "actions": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      return view({
        view: "actions",
        data: projectActions({
          scope: scope.scope,
          actions: await store.listActions(tenant.id),
          editable,
        }),
      });
    }

    case "prompts": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const prompts = await store.listPrompts(scope.tenantId, query.action);
      return view({
        view: "prompts",
        data: {
          scope: scope.scope,
          editable: capabilities.canManageAiOperations,
          prompts: prompts.map(promptRow),
        },
      });
    }

    case "prompt-comparison": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const [left, right] = await Promise.all([
        store.readPrompt(scope.tenantId, query.leftPromptVersionId),
        store.readPrompt(scope.tenantId, query.rightPromptVersionId),
      ]);
      return left === null || right === null
        ? NOT_FOUND
        : view({
            view: "prompt-comparison",
            data: {
              scope: scope.scope,
              left: promptDetail(left),
              right: promptDetail(right),
            },
          });
    }

    case "experiments": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const [experiments, prompts] = await Promise.all([
        store.listExperiments(scope.tenantId),
        store.listPrompts(scope.tenantId, null),
      ]);
      return view({
        view: "experiments",
        data: {
          scope: scope.scope,
          editable: capabilities.canManageAiOperations,
          experiments: experiments.map((experiment) => ({
            id: experiment.id,
            action: experiment.action,
            status: experiment.status,
            createdAt: experiment.createdAt,
            startedAt: experiment.startedAt,
            stoppedAt: experiment.stoppedAt,
            variants: experiment.variants.map((variant) => ({
              promptVersionId: variant.promptVersionId,
              promptVersionHash: variant.promptVersionHash,
              weightPct: variant.weightPct,
              generations: variant.generations,
              accepted: variant.accepted,
              acceptanceRate:
                variant.generations === 0
                  ? 0
                  : variant.accepted / variant.generations,
            })),
            editable: experiment.status === "draft",
            stoppable: experiment.status === "running",
            metricsAvailable: experiment.metricsAvailable,
          })),
          availablePrompts: prompts.map(promptRow),
        },
      });
    }

    case "bench-form": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      const [actions, styles, prompts, keywords] = await Promise.all([
        store.listActions(tenant.id),
        store.listStyles(tenant.id),
        store.listPrompts(tenant.id, null),
        store.listKeywords(tenant.id, scope.locationId),
      ]);
      let prefill = null;
      let missing: readonly string[] = [];
      if (query.replayGenerationId !== null) {
        if (executionStore === undefined) {
          return rejected(
          "VIEW_NOT_AVAILABLE",
          "Generation history is not available in this deployment yet, so this view cannot be built. Configuration screens are unaffected.",
        );
        }
        const generation = await executionStore.readGenerationDetail({
          scope: scope.selector,
          generationId: query.replayGenerationId,
        });
        if (generation === null) {
          return NOT_FOUND;
        }
        prefill = generation.replayInput;
        missing = generation.missingReplayDependencies;
      }
      return view({
        view: "bench-form",
        data: {
          scope: scope.scope,
          actions: actions.map((action) => ({
            key: action.key,
            label: action.label,
            requiredInputs: [...action.requiredInputs],
          })),
          styles: styles.map((style) => ({
            id: style.id,
            name: style.name,
            supportedActions: [...style.supportedActions],
          })),
          promptVersions: prompts.map(promptRow),
          providers: [...(await benchProviders(store))],
          keywords: keywords.map((keyword) => ({
            id: keyword.id,
            label: keyword.label,
          })),
          prefill,
          missingReplayDependencies: [...missing],
        },
      });
    }

    case "analytics": {
      if (executionStore === undefined) {
        return rejected(
          "VIEW_NOT_AVAILABLE",
          "Generation history is not available in this deployment yet, so this view cannot be built. Configuration screens are unaffected.",
        );
      }
      const rows = await executionStore.readAnalytics({
        scope: scope.selector,
        query: query.query,
      });
      return view({
        view: "analytics",
        data: { scope: scope.scope, query: query.query, rows: [...rows] },
      });
    }

    case "generation-detail": {
      if (executionStore === undefined) {
        return rejected(
          "VIEW_NOT_AVAILABLE",
          "Generation history is not available in this deployment yet, so this view cannot be built. Configuration screens are unaffected.",
        );
      }
      const detail = await executionStore.readGenerationDetail({
        scope: scope.selector,
        generationId: query.generationId,
      });
      if (detail === null) {
        return NOT_FOUND;
      }
      const { lineage, replayInput, missingReplayDependencies, ...generation } =
        detail;
      return view({
        view: "generation-detail",
        data: {
          scope: scope.scope,
          generation,
          lineage,
          replayable:
            capabilities.canManageAiOperations &&
            replayInput !== null &&
            missingReplayDependencies.length === 0,
        },
      });
    }

    case "platform-tenants":
      return view({
        view: "platform-tenants",
        data: { scope: "platform", tenants: [...(await store.listPlatformTenants())] },
      });

    case "platform-providers":
      return view({
        view: "platform-providers",
        data: { scope: "platform", ...(await store.readPlatformProviders()) },
      });

    case "platform-styles":
      return view({
        view: "platform-styles",
        data: { scope: "platform", styles: [...(await store.listPlatformStyles())] },
      });

    case "platform-settings":
      return view({
        view: "platform-settings",
        data: { scope: "platform", ...(await store.readPlatformSettings()) },
      });
  }
}

async function benchProviders(
  store: ConsoleControlPlaneStore,
): Promise<
  readonly {
    readonly key: string;
    readonly displayName: string;
    readonly isTestProvider: boolean;
  }[]
> {
  const providers = await store.readPlatformProviders();
  const unique = new Map<string, { key: string; displayName: string }>();
  for (const model of providers.models) {
    unique.set(model.providerKey, {
      key: model.providerKey,
      displayName: model.providerName,
    });
  }
  return [...unique.values()].map((provider) => ({
    ...provider,
    isTestProvider: provider.key === "fake",
  }));
}

function asView(view: Extract<Result, { status: "view" }>["view"]): Result {
  return { status: "view", view };
}

function promptRow(record: ConsolePromptRecord): ConsolePromptVersionDto {
  return {
    id: record.id,
    action: record.action,
    version: record.version,
    hash: record.hash,
    status: record.status,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    evaluationScore: record.evaluationScore,
  };
}

function promptDetail(
  record: ConsolePromptRecord,
): ConsolePromptComparisonDto["left"] {
  return {
    ...promptRow(record),
    body: record.body,
    variables: [...record.variables],
    readOnly: true,
  };
}

async function requireTenant(
  store: ConsoleControlPlaneStore,
  scope: ResolvedOk,
): Promise<Awaited<ReturnType<ConsoleControlPlaneStore["readTenant"]>>> {
  return scope.tenantId === null ? null : await store.readTenant(scope.tenantId);
}

async function requireLocation(
  store: ConsoleControlPlaneStore,
  scope: ResolvedOk,
): Promise<{
  readonly tenant: NonNullable<
    Awaited<ReturnType<ConsoleControlPlaneStore["readTenant"]>>
  >;
  readonly location: NonNullable<
    Awaited<ReturnType<ConsoleControlPlaneStore["readLocation"]>>
  >;
} | null> {
  if (scope.tenantId === null || scope.locationId === null) {
    return null;
  }
  const [tenant, location] = await Promise.all([
    store.readTenant(scope.tenantId),
    store.readLocation(scope.tenantId, scope.locationId),
  ]);
  return tenant === null || location === null ? null : { tenant, location };
}

function rejected(
  code: Extract<Result, { status: "rejected" }>["code"],
  message: string,
): Result {
  return { status: "rejected", code, message };
}

const ACCEPTED: Result = {
  status: "command",
  result: { outcome: "accepted" },
};

async function runCommand({
  command,
  access,
  scope,
  store,
  executionStore,
  now,
}: {
  readonly command: ConsoleCommandDto;
  readonly access: AuthorizedAccess;
  readonly scope: ResolvedOk;
  readonly store: ConsoleControlPlaneStore;
  readonly executionStore: ConsoleExecutionStore | undefined;
  readonly now: () => Date;
}): Promise<Result> {
  switch (command.command) {
    case "create-location": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const created = await store.createLocation({
        tenantId: scope.tenantId,
        name: command.name,
        slug: command.slug,
        address: command.address,
        entryMode: command.entryMode,
      });
      return created.status === "slug-taken"
        ? rejected(
            "SLUG_TAKEN",
            "Another Location in this account already uses that slug.",
          )
        : ACCEPTED;
    }

    case "update-location": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const location = await store.readLocation(
        scope.tenantId,
        command.locationId,
      );
      if (location === null) {
        return NOT_FOUND;
      }
      await store.updateLocation({
        tenantId: scope.tenantId,
        locationId: command.locationId,
        name: command.name,
        address: command.address,
        active: command.active,
      });
      return ACCEPTED;
    }

    case "save-tenant-settings": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      await store.saveTenantSettings({
        tenantId: scope.tenantId,
        values: command.values,
      });
      return ACCEPTED;
    }

    case "set-location-override":
    case "reset-location-override": {
      const resolved = await requireLocation(store, scope);
      if (resolved === null) {
        return NOT_FOUND;
      }
      const mutation =
        command.command === "set-location-override"
          ? applyLocationOverride({
              overrides: resolved.location.overrides,
              key: command.key,
              value: command.value,
            })
          : clearLocationOverride({
              overrides: resolved.location.overrides,
              key: command.key,
            });
      if (mutation.status === "rejected") {
        return rejected(
          "NOT_OVERRIDABLE",
          "This setting is owned by the account and cannot differ per venue.",
        );
      }
      await store.writeLocationOverrides({
        tenantId: resolved.tenant.id,
        locationId: resolved.location.id,
        overrides: mutation.overrides,
      });
      return ACCEPTED;
    }

    case "save-destination": {
      if (scope.tenantId === null || scope.locationId === null) {
        return NOT_FOUND;
      }
      const validation = validateReviewDestination({
        platformPlaceId: command.platformPlaceId,
        targetUrl: command.targetUrl,
        enabled: command.enabled,
      });
      if (validation.status === "rejected") {
        return rejected("INVALID_VALUE", validation.reason);
      }
      const saved = await store.saveDestination({
        tenantId: scope.tenantId,
        locationId: scope.locationId,
        destinationTypeId: command.destinationTypeId,
        platformPlaceId: command.platformPlaceId,
        targetUrl: command.targetUrl,
        enabled: command.enabled,
      });
      return saved.status === "unknown-destination" ? NOT_FOUND : ACCEPTED;
    }

    case "publish-context-version": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const versions = await store.listContextVersions(scope.tenantId);
      await store.publishContextVersion({
        tenantId: scope.tenantId,
        version: nextPublishedVersion(versions),
        context: command.context,
        bannedTerms: command.bannedTerms,
        createdBy: access.operator.id,
      });
      return ACCEPTED;
    }

    case "create-keyword": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      if (command.ownerScope === "location" && scope.locationId === null) {
        return NOT_FOUND;
      }
      const created = await store.createKeyword({
        tenantId: tenant.id,
        locationId:
          command.ownerScope === "location" ? scope.locationId : null,
        label: command.label,
        categoryKey: command.categoryKey,
        polarity: command.polarity,
      });
      return created.status === "unknown-category"
        ? rejected("INVALID_VALUE", "That category does not exist.")
        : ACCEPTED;
    }

    case "update-keyword": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const updated = await store.updateKeyword({
        tenantId: scope.tenantId,
        keywordId: command.keywordId,
        label: command.label,
        polarity: command.polarity,
        active: command.active,
      });
      return updated.status === "not-found" ? NOT_FOUND : ACCEPTED;
    }

    case "reorder-keywords": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      await store.reorderKeywords({
        tenantId: scope.tenantId,
        orderedKeywordIds: command.orderedKeywordIds,
      });
      return ACCEPTED;
    }

    case "delete-keyword": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const deleted = await store.deleteKeyword({
        tenantId: scope.tenantId,
        keywordId: command.keywordId,
      });
      return deleted.status === "not-found" ? NOT_FOUND : ACCEPTED;
    }

    case "set-style-enablement": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      const style = (await store.listStyles(tenant.id)).find(
        (candidate) => candidate.id === command.styleId,
      );
      if (style === undefined) {
        return NOT_FOUND;
      }
      const incompatibility = styleIncompatibility(style, tenant.locale);
      if (command.enabled && incompatibility !== null) {
        return rejected("STYLE_INCOMPATIBLE", incompatibility);
      }
      const unsupported = command.enabledActions.filter(
        (action) => !style.supportedActions.includes(action),
      );
      if (unsupported.length > 0) {
        return rejected(
          "STYLE_INCOMPATIBLE",
          `This style does not support: ${unsupported.join(", ")}.`,
        );
      }
      await store.setStyleEnablement({
        tenantId: tenant.id,
        styleId: command.styleId,
        enabled: command.enabled,
        enabledActions: command.enabledActions,
      });
      return ACCEPTED;
    }

    case "reorder-styles": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      await store.reorderStyles({
        tenantId: scope.tenantId,
        orderedStyleIds: command.orderedStyleIds,
      });
      return ACCEPTED;
    }

    case "validate-style": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null) {
        return NOT_FOUND;
      }
      const style = (await store.listStyles(tenant.id)).find(
        (candidate) => candidate.id === command.styleId,
      );
      return style === undefined
        ? NOT_FOUND
        : {
            status: "command",
            result: {
              outcome: "style-validation",
              validation: validateStyleManifest({
                manifest: style.manifest,
                checkedAt: now().toISOString(),
              }),
            },
          };
    }

    case "set-action-enablement": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const actions = await store.listActions(scope.tenantId);
      const target = actions.find((action) => action.key === command.action);
      if (target === undefined) {
        return NOT_FOUND;
      }
      const remainingEntryActions = actions.filter(
        (action) =>
          action.isEntryAction &&
          (action.key === command.action ? command.enabled : action.enabled),
      );
      if (target.isEntryAction && remainingEntryActions.length === 0) {
        return rejected(
          "ACTION_REQUIRED_BY_ENTRY",
          "At least one entry Action must stay enabled or the Survey cannot start.",
        );
      }
      await store.setActionEnablement({
        tenantId: scope.tenantId,
        action: command.action,
        enabled: command.enabled,
      });
      return ACCEPTED;
    }

    case "create-prompt-version": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const existing = await store.listPrompts(scope.tenantId, command.action);
      const hash = derivePromptVersionHash({
        key: `${scope.tenantId}:${command.action}`,
        commandKind: promptCommandKind(command.action),
        body: command.body,
        variables: [...command.variables],
      });
      await store.createPromptVersion({
        tenantId: scope.tenantId,
        action: command.action,
        version: nextPublishedVersion(existing),
        hash,
        body: command.body,
        variables: command.variables,
        createdBy: access.operator.id,
      });
      return ACCEPTED;
    }

    case "create-experiment": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const weights = validateVariantWeights(command.variants);
      if (!weights.allowed) {
        return rejected(
          "INVALID_WEIGHTS",
          "Variant weights must total exactly 100% across at least two variants.",
        );
      }
      const created = await store.createExperiment({
        tenantId: scope.tenantId,
        action: command.action,
        variants: command.variants,
      });
      return created.status === "unknown-prompt"
        ? NOT_FOUND
        : ACCEPTED;
    }

    case "start-experiment":
    case "stop-experiment": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const experiment = await store.readExperiment(
        scope.tenantId,
        command.experimentId,
      );
      if (experiment === null) {
        return NOT_FOUND;
      }
      const decision = decideExperimentMutation({
        status: experiment.status,
        mutation: command.command === "start-experiment" ? "start" : "stop",
      });
      if (!decision.allowed) {
        return rejected(
          decision.code,
          decision.code === "EXPERIMENT_RUNNING"
            ? "A running experiment may only be stopped. Stop it and create a new one to change its configuration."
            : "Only a draft experiment can be started, and only a running one can be stopped.",
        );
      }
      await store.setExperimentStatus({
        tenantId: scope.tenantId,
        experimentId: command.experimentId,
        status: command.command === "start-experiment" ? "running" : "stopped",
      });
      return ACCEPTED;
    }

    case "run-bench": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      if (executionStore === undefined) {
        return rejected(
          "VIEW_NOT_AVAILABLE",
          "The Generation bench is not available in this deployment yet.",
        );
      }
      return {
        status: "command",
        result: {
          outcome: "bench-result",
          result: await executionStore.runBench({
            tenantId: scope.tenantId,
            locationId: scope.locationId,
            input: command.input,
          }),
        },
      };
    }

    case "create-tenant": {
      const created = await store.createTenant({
        name: command.name,
        slug: command.slug,
        locale: command.locale,
        category: command.category,
        plan: command.plan,
      });
      return created.status === "slug-taken"
        ? rejected("SLUG_TAKEN", "Another account already uses that slug.")
        : ACCEPTED;
    }

    case "set-provider-routing": {
      const saved = await store.setProviderRouting({
        providerKey: command.providerKey,
        modelKey: command.modelKey,
        routingPriority: command.routingPriority,
        fallbackPriority: command.fallbackPriority,
      });
      return saved.status === "unknown-model" ? NOT_FOUND : ACCEPTED;
    }

    case "publish-price-rate": {
      const published = await store.publishPriceRate({
        providerKey: command.providerKey,
        modelKey: command.modelKey,
        inputMicrosPerMillion: command.inputMicrosPerMillion,
        outputMicrosPerMillion: command.outputMicrosPerMillion,
        currency: command.currency,
        validFrom: command.validFrom,
      });
      return published.status === "not-later-than-current"
        ? rejected(
            "INVALID_VALUE",
            "A new price version must start after the current version.",
          )
        : ACCEPTED;
    }

    case "import-platform-style": {
      const validation = validateStyleManifest({
        manifest: command.manifest,
        checkedAt: now().toISOString(),
      });
      if (validation.status === "fail") {
        return {
          status: "command",
          result: { outcome: "style-validation", validation },
        };
      }
      const imported = await store.importPlatformStyle({
        manifest: command.manifest,
      });
      return imported.status === "invalid"
        ? rejected("INVALID_MANIFEST", "The manifest could not be imported.")
        : ACCEPTED;
    }

    case "save-platform-settings": {
      await store.savePlatformSettings({
        defaultPolicyTemplate: command.defaultPolicyTemplate,
        globalRateLimits: command.globalRateLimits,
        logRetentionDays: command.logRetentionDays,
        featureFlags: command.featureFlags,
      });
      return ACCEPTED;
    }
  }
}

const PROMPT_COMMAND_KINDS = {
  generate: "generate",
  paraphrase: "paraphrase",
  resample: "generate",
  reformat: "reformat",
  condense: "condense",
  expand: "expand",
  "revise-wording": "revise-wording",
  "add-assertion": "generate",
} as const;

function promptCommandKind(
  action: keyof typeof PROMPT_COMMAND_KINDS,
): (typeof PROMPT_COMMAND_KINDS)[keyof typeof PROMPT_COMMAND_KINDS] {
  return PROMPT_COMMAND_KINDS[action];
}
