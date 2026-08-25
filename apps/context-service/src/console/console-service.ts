import type {
  ConsoleBootstrapDto,
  ConsoleCommandDto,
  ConsoleConfigurationDraftChangeDto,
  ConsolePlatformConfigurationDraftChangeDto,
  ConsolePromptComparisonDto,
  ConsolePromptVersionDto,
  ConsoleQueryDto,
  AuthorizeConsoleReadInvocationDto,
  AuthorizeConsoleReadInvocationResultDto,
  ConsoleReadQueryDto,
  ConsoleRequestInvocationDto,
  ConsoleRequestInvocationResultDto,
} from "@review/contracts/console";
import type {
  OperatorAccessProjectionDto,
  OperatorIdentityDto,
} from "@review/contracts/context";
import { EffectiveConfigurationSnapshotDtoSchema } from "@review/contracts/shared";
import { deriveConfigSnapshotId } from "@review/domain/configuration";
import {
  applyLocationOverride,
  clearLocationOverride,
  deriveConsoleCapabilities,
  deriveConsoleRole,
  nextPublishedVersion,
  validateReviewDestination,
  validateVariantWeights,
} from "@review/domain/console";
import { derivePromptVersionHash } from "@review/domain/experiment";

import { validateStyleManifest } from "./manifest-rules.js";
import { projectPublishedConsoleBenchForm } from "./console-bench-form.js";
import type { ConsoleExecutionAuthorizationStore } from "./console-execution-authorization.port.js";
import type { ConsoleReadAuthority } from "./console-read-authority.js";
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
const READ_NOT_FOUND: AuthorizeConsoleReadInvocationResultDto["result"] = {
  status: "not-found",
};

function changeBelongsToConfigurationScope(
  change: ConsoleConfigurationDraftChangeDto,
  locationId: string | null,
): boolean {
  if ("key" in change && !("operation" in change)) {
    return locationId === null;
  }
  switch (change.operation) {
    case "set-location-override":
    case "reset-location-override":
      return locationId !== null;
    case "create-fact-option":
      return (change.ownerScope === "location") === (locationId !== null);
    case "update-fact-option":
    case "reorder-fact-options":
    case "delete-fact-option":
      return true;
    case "set-review-format-enablement":
    case "reorder-review-formats":
    case "set-action-enablement":
    case "deploy-prompt-version":
      return locationId === null;
  }
}

function accessHasTenantCapability(
  access: AuthorizedAccess,
  tenantId: string,
  capability: string,
): boolean {
  return (
    access.tenantGrants.some(
      (grant) =>
        grant.tenantId === tenantId && grant.capabilities.includes(capability),
    ) ||
    access.platformGrants.some((grant) => grant.capabilities.includes(capability))
  );
}

function accessHasPlatformCapability(
  access: AuthorizedAccess,
  capability: string,
): boolean {
  return access.platformGrants.some((grant) =>
    grant.capabilities.includes(capability),
  );
}

function canApplyPlatformChanges(
  access: AuthorizedAccess,
  changes: readonly ConsolePlatformConfigurationDraftChangeDto[],
): boolean {
  return (
    accessHasPlatformCapability(access, "platform:admin") &&
    (changes.every((change) => change.operation === "save-platform-settings") ||
      accessHasPlatformCapability(access, "provider:manage"))
  );
}

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
  /** The assessment deployment must not advertise a paid path it cannot fund. */
  readonly providerMode?: "configured" | "fake-only" | undefined;
  readonly readAuthority?: ConsoleReadAuthority | undefined;
  readonly executionAuthorizationStore?:
    | ConsoleExecutionAuthorizationStore
    | undefined;
  readonly readReceiptTtlMs?: number | undefined;
}

export interface ConsoleService {
  request(
    input: ConsoleRequestInvocationDto["input"],
  ): Promise<Result>;
  authorizeRead(
    input: AuthorizeConsoleReadInvocationDto["input"],
  ): Promise<AuthorizeConsoleReadInvocationResultDto["result"]>;
}

export function createConsoleService({
  store,
  executionStore,
  resolveAccess,
  now = () => new Date(),
  overviewWindowDays = 30,
  providerMode = "configured",
  readAuthority,
  executionAuthorizationStore,
  readReceiptTtlMs = 30_000,
}: ConsoleServiceOptions): ConsoleService {
  return {
    async authorizeRead(input) {
      if (
        readAuthority === undefined ||
        executionAuthorizationStore === undefined
      ) {
        return { status: "unavailable" };
      }
      const access = await resolveAccess(input.identity);
      if (access.status !== "authorized") {
        return READ_NOT_FOUND;
      }
      const scopedStore = store.forOperator(access.operator.id);
      const resolved = await resolveConsoleScope({
        access,
        request: input.scope,
        policy: QUERY_POLICIES[input.query.view],
        store: scopedStore,
      });
      if (resolved.status === "denied") {
        return READ_NOT_FOUND;
      }
      const issuedAt = now();
      const query: ConsoleReadQueryDto =
        input.query.view === "overview"
          ? {
              view: "overview",
              from: new Date(
                issuedAt.getTime() - overviewWindowDays * 24 * 60 * 60 * 1000,
              ).toISOString(),
              to: issuedAt.toISOString(),
            }
          : input.query;
      const scope = resolved.selector;
      const requestedExpiresAt = new Date(
        issuedAt.getTime() + readReceiptTtlMs,
      ).toISOString();
      const minted = await executionAuthorizationStore.mint({
        operatorId: access.operator.id,
        scope,
        query,
        expiresAt: requestedExpiresAt,
      });
      if (minted === null) {
        return READ_NOT_FOUND;
      }
      return {
        status: "authorized",
        authorizationId: minted.authorizationId,
        receipt: readAuthority.signRead({
          authorizationId: minted.authorizationId,
          view: query.view,
          readMode: minted.readMode,
          expiresAt: minted.expiresAt,
        }),
        projectionScope: resolved.scope,
        query,
      };
    },
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
            providerMode,
          })
        : await runCommand({
            command: input.request.command,
            ifMatch: input.ifMatch ?? null,
            access,
            scope,
            store: scopedStore,
            executionStore,
            now,
          });
    },
  };
}

async function bootstrap(
  access: AuthorizedAccess,
  store: ConsoleControlPlaneStore,
): Promise<ConsoleBootstrapDto> {
  const capabilities = deriveConsoleCapabilities(access);
  const firstTenant = access.tenantGrants[0];
  const granted = access.tenantGrants.map((grant) => ({
    id: grant.tenantId,
    slug: grant.tenantSlug,
    name: grant.tenantName,
    locations: grant.locations.map((location) => ({
      id: location.locationId,
      slug: location.locationSlug,
      name: location.locationName,
      active: location.status === "active",
    })),
  }));
  // A Platform administrator is authorized for every Tenant, so the scope bar
  // offers every Tenant — including one they just provisioned.
  const tenants = capabilities.canAccessPlatform
    ? (await store.listSelectableTenants()).map((tenant) => ({
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        locations: tenant.locations.map((location) => ({ ...location })),
      }))
    : granted;
  return {
    user: { id: access.operator.id, displayName: access.operator.email },
    role: deriveConsoleRole(access),
    tenants,
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
  providerMode,
}: {
  readonly query: ConsoleQueryDto;
  readonly access: AuthorizedAccess;
  readonly scope: ResolvedOk;
  readonly publicOrigin: string | null;
  readonly store: ConsoleControlPlaneStore;
  readonly executionStore: ConsoleExecutionStore | undefined;
  readonly now: () => Date;
  readonly overviewWindowDays: number;
  readonly providerMode: "configured" | "fake-only";
}): Promise<Result> {
  const capabilities = deriveConsoleCapabilities(access);
  const editable = capabilities.canManageConfiguration;

  const view = asView;

  switch (query.view) {
    case "bootstrap":
      return view({
        view: "bootstrap",
        data: await bootstrap(access, store),
      });

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
      const state = await store.readConfigurationState({
        tenantId: tenant.id,
        locationId: null,
      });
      if (state === null) {
        return NOT_FOUND;
      }
      return view({
        view: "tenant-settings",
        data: projectTenantSettings({
          scope: scope.scope,
          tenant,
          editable,
          configuration: configurationProjection(tenant.id, null, state),
        }),
      });
    }

    case "location-settings": {
      const resolved = await requireLocation(store, scope);
      if (resolved === null) {
        return NOT_FOUND;
      }
      const state = await store.readConfigurationState({
        tenantId: resolved.tenant.id,
        locationId: resolved.location.id,
      });
      if (state === null) {
        return NOT_FOUND;
      }
      return view({
        view: "location-settings",
        data: projectLocationSettings({
          scope: scope.scope,
          tenant: resolved.tenant,
          location: resolved.location,
          editable,
          configuration: configurationProjection(
            resolved.tenant.id,
            resolved.location.id,
            state,
          ),
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
      const resolved = await requireLocation(store, scope);
      if (resolved === null) {
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
            data: projectDistribution({
              scope: scope.scope,
              distribution,
              active: resolved.location.active,
            }),
          });
    }

    case "distribution-overview": {
      const tenant = await requireTenant(store, scope);
      if (tenant === null || publicOrigin === null) {
        return NOT_FOUND;
      }
      const locations = await store.listLocations(tenant.id);
      const entries = await Promise.all(
        locations.map(async (location) => {
          const distribution = await store.readDistribution(
            tenant.id,
            location.id,
            publicOrigin,
          );
          if (distribution === null) {
            return null;
          }
          // Reuses the per-venue projection, so entry-mode gating and the QR
          // cannot drift between the two screens.
          const projected = projectDistribution({
            scope: scope.scope,
            distribution,
            active: location.active,
          });
          return {
            locationId: location.id,
            slug: location.slug,
            name: location.name,
            active: location.active,
            liveUrl: projected.liveUrl,
            qrSvg: projected.qrSvg,
            qrUnavailableReason: projected.qrUnavailableReason,
            entryMode: projected.entryMode,
            verifiesVisit: projected.verifiesVisit,
            counters: projected.counters,
          };
        }),
      );
      return view({
        view: "distribution-overview",
        data: {
          scope: scope.scope,
          locations: entries.filter((entry) => entry !== null),
        },
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
      const [prompts, actions] = await Promise.all([
        store.listPrompts(scope.tenantId, query.action),
        store.listActions(scope.tenantId),
      ]);
      return view({
        view: "prompts",
        data: {
          scope: scope.scope,
          editable: capabilities.canManageAiOperations,
          prompts: prompts.map(promptRow),
          actions: actions.map((action) => ({
            key: action.key,
            label: action.label,
          })),
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
      const locationId = scope.locationId;
      const options =
        locationId === null
          ? {
              actions: [],
              styles: [],
              promptVersions: [],
              providers: [],
              keywords: [],
            }
          : await (async () => {
              const published =
                await store.readPublishedConfigurationSnapshot({
                  tenantId: tenant.id,
                  locationId,
                });
              if (published === null) {
                return null;
              }
              const parsed = EffectiveConfigurationSnapshotDtoSchema.safeParse(
                published.payload,
              );
              if (
                !parsed.success ||
                deriveConfigSnapshotId(parsed.data) !== published.contentHash
              ) {
                return null;
              }
              return projectPublishedConsoleBenchForm({
                snapshot: parsed.data,
                tenantId: tenant.id,
                locationId,
                now: now(),
              });
            })();
      if (options === null) {
        return rejected(
          "VIEW_NOT_AVAILABLE",
          "Publish one complete zero-cost Location configuration before running the Generation bench.",
        );
      }
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
          ...options,
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
      {
        const [providers, configurationState] = await Promise.all([
          store.readPlatformProviders(),
          store.readPlatformConfigurationState(),
        ]);
        const visibleModels =
          providerMode === "fake-only"
            ? providers.models.filter((model) => model.providerKey === "fake")
            : providers.models;
        const visibleProviderKeys = new Set(
          visibleModels.map((model) => model.providerKey),
        );
      return view({
        view: "platform-providers",
        data: {
          scope: "platform",
          configuration: platformConfigurationProjection(configurationState),
          models: visibleModels,
          priceVersions: providers.priceVersions.filter((price) =>
            visibleProviderKeys.has(price.providerKey),
          ),
        },
      });
      }

    case "platform-styles":
      return view({
        view: "platform-styles",
        data: { scope: "platform", styles: [...(await store.listPlatformStyles())] },
      });

    case "platform-settings":
      {
        const [settings, configurationState] = await Promise.all([
          store.readPlatformSettings(),
          store.readPlatformConfigurationState(),
        ]);
        return view({
          view: "platform-settings",
          data: {
            scope: "platform",
            configuration: platformConfigurationProjection(configurationState),
            ...settings,
          },
        });
      }
  }
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

function configurationEtag(
  tenantId: string,
  locationId: string | null,
  revision: string,
  draft: { readonly id: string; readonly revision: string } | null,
): string {
  const draftVersion =
    draft === null ? "draft:none" : `draft:${draft.id}:${draft.revision}`;
  return `"configuration:${tenantId}:${locationId ?? "tenant"}:${revision}:${draftVersion}"`;
}

function configurationProjection(
  tenantId: string,
  locationId: string | null,
  state: {
    readonly revision: string;
    readonly draft: {
      readonly id: string;
      readonly revision: string;
      readonly baseRevision: string;
      readonly changes: readonly ConsoleConfigurationDraftChangeDto[];
    } | null;
  },
) {
  return {
    etag: configurationEtag(tenantId, locationId, state.revision, state.draft),
    draft:
      state.draft === null
        ? null
        : {
            baseEtag: configurationEtag(
              tenantId,
              locationId,
              state.draft.baseRevision,
              null,
            ),
            changes: [...state.draft.changes],
          },
  };
}

function platformConfigurationEtag(
  revision: string,
  draft: { readonly id: string; readonly revision: string } | null,
): string {
  const draftVersion =
    draft === null ? "draft:none" : `draft:${draft.id}:${draft.revision}`;
  return `"platform-configuration:${revision}:${draftVersion}"`;
}

function platformConfigurationProjection(state: {
  readonly revision: string;
  readonly draft: {
    readonly id: string;
    readonly revision: string;
    readonly baseRevision: string;
    readonly changes: readonly ConsolePlatformConfigurationDraftChangeDto[];
  } | null;
}) {
  return {
    etag: platformConfigurationEtag(state.revision, state.draft),
    draft:
      state.draft === null
        ? null
        : {
            baseEtag: platformConfigurationEtag(
              state.draft.baseRevision,
              null,
            ),
            changes: [...state.draft.changes],
          },
  };
}

function parsePlatformConfigurationEtag(etag: string): {
  readonly revision: string;
  readonly draft: { readonly id: string; readonly revision: string } | null;
} | null {
  const noDraft = /^"platform-configuration:(\d+):draft:none"$/u.exec(etag);
  if (noDraft !== null) {
    return { revision: noDraft[1]!, draft: null };
  }
  const draft =
    /^"platform-configuration:(\d+):draft:([A-Za-z0-9_-]+):(\d+)"$/u.exec(
      etag,
    );
  return draft === null
    ? null
    : {
        revision: draft[1]!,
        draft: { id: draft[2]!, revision: draft[3]! },
      };
}

async function runCommand({
  command,
  ifMatch,
  access,
  scope,
  store,
  executionStore,
  now,
}: {
  readonly command: ConsoleCommandDto;
  readonly ifMatch: string | null;
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

    case "save-tenant-settings":
    case "stage-configuration-changes": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const changes = command.changes;
      if (
        changes.some(
          (change) =>
            !changeBelongsToConfigurationScope(change, scope.locationId),
        )
      ) {
        return rejected(
          "INVALID_VALUE",
          "A Draft change must belong to the Tenant or Location scope being edited.",
        );
      }
      if (
        changes.some(
          (change) =>
            "operation" in change &&
            change.operation === "deploy-prompt-version",
        ) &&
        !accessHasTenantCapability(access, scope.tenantId, "ai:operate")
      ) {
        return NOT_FOUND;
      }
      const promptDeployments = changes.flatMap((change) =>
        "operation" in change &&
        change.operation === "deploy-prompt-version"
          ? [
              {
                action: change.action,
                promptVersionId: change.promptVersionId,
              },
            ]
          : [],
      );
      for (const deployment of promptDeployments) {
        const prompt = await store.readPrompt(
          scope.tenantId,
          deployment.promptVersionId,
        );
        if (prompt === null || prompt.action !== deployment.action) {
          return rejected(
            "INVALID_VALUE",
            "The staged Prompt Version must belong to the selected Action.",
          );
        }
      }
      const state = await store.readConfigurationState({
        tenantId: scope.tenantId,
        locationId: scope.locationId,
      });
      if (
        state === null ||
        ifMatch === null ||
        ifMatch !==
          configurationEtag(
            scope.tenantId,
            scope.locationId,
            state.revision,
            state.draft,
          )
      ) {
        return rejected(
          "CONFIG_CONFLICT",
          "This configuration changed after you opened it. Reload before saving.",
        );
      }
      const saved = await store.saveConfigurationDraft({
        tenantId: scope.tenantId,
        locationId: scope.locationId,
        expectedRevision: state.revision,
        expectedDraft:
          state.draft === null
            ? null
            : { id: state.draft.id, revision: state.draft.revision },
        changes,
        actorId: access.operator.id,
      });
      return saved.status === "conflict"
        ? rejected(
            "CONFIG_CONFLICT",
            "This configuration changed after you opened it. Reload before saving.",
          )
        : ACCEPTED;
    }

    case "stage-platform-configuration-changes": {
      if (!canApplyPlatformChanges(access, command.changes)) {
        return NOT_FOUND;
      }
      const state = await store.readPlatformConfigurationState();
      if (
        ifMatch === null ||
        ifMatch !== platformConfigurationEtag(state.revision, state.draft)
      ) {
        return rejected(
          "CONFIG_CONFLICT",
          "This Platform configuration changed after you opened it. Reload before saving.",
        );
      }
      const saved = await store.savePlatformConfigurationDraft({
        expectedRevision: state.revision,
        expectedDraft:
          state.draft === null
            ? null
            : { id: state.draft.id, revision: state.draft.revision },
        changes: command.changes,
        actorId: access.operator.id,
      });
      return saved.status === "conflict"
        ? rejected(
            "CONFIG_CONFLICT",
            "This Platform configuration changed after you opened it. Reload before saving.",
          )
        : ACCEPTED;
    }

    case "cancel-platform-configuration-draft": {
      const state = await store.readPlatformConfigurationState();
      if (!canApplyPlatformChanges(access, state.draft?.changes ?? [])) {
        return NOT_FOUND;
      }
      if (
        state.draft === null ||
        ifMatch === null ||
        ifMatch !== platformConfigurationEtag(state.revision, state.draft)
      ) {
        return rejected(
          "CONFIG_CONFLICT",
          "This Platform configuration changed after you opened it. Reload before continuing.",
        );
      }
      const cancelled = await store.cancelPlatformConfigurationDraft({
        expectedRevision: state.revision,
        expectedDraft: {
          id: state.draft.id,
          revision: state.draft.revision,
        },
      });
      return cancelled.status === "conflict"
        ? rejected(
            "CONFIG_CONFLICT",
            "This Platform configuration changed after you opened it. Reload before continuing.",
          )
        : ACCEPTED;
    }

    case "publish-platform-configuration": {
      if (ifMatch === null) {
        return rejected(
          "CONFIG_CONFLICT",
          "This Platform configuration changed after you opened it. Reload before continuing.",
        );
      }
      const expected = parsePlatformConfigurationEtag(ifMatch);
      if (expected === null || expected.draft === null) {
        return rejected(
          "CONFIG_CONFLICT",
          "This Platform configuration changed after you opened it. Reload before continuing.",
        );
      }
      const state = await store.readPlatformConfigurationState();
      const currentEtag = platformConfigurationEtag(state.revision, state.draft);
      if (
        currentEtag === ifMatch &&
        !canApplyPlatformChanges(access, state.draft?.changes ?? [])
      ) {
        return NOT_FOUND;
      }
      const published = await store.publishPlatformConfiguration({
        expectedRevision: expected.revision,
        expectedDraft: expected.draft,
        actorId: access.operator.id,
      });
      switch (published.status) {
        case "published":
          return ACCEPTED;
        case "conflict":
          return rejected(
            "CONFIG_CONFLICT",
            "This Platform configuration changed after you opened it. Reload before continuing.",
          );
        case "no-draft":
          return rejected("INVALID_VALUE", "There is no Platform Draft to publish.");
        case "incomplete":
          return rejected(
            "INVALID_VALUE",
            `This Platform configuration cannot be published yet. Missing: ${published.missing.join(", ")}.`,
          );
      }
      return rejected(
        "INVALID_VALUE",
        "This Platform configuration could not be published.",
      );
    }

    case "cancel-configuration-draft":
    case "publish-configuration": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const state = await store.readConfigurationState({
        tenantId: scope.tenantId,
        locationId: scope.locationId,
      });
      if (
        state === null ||
        ifMatch === null ||
        ifMatch !==
          configurationEtag(
            scope.tenantId,
            scope.locationId,
            state.revision,
            state.draft,
          )
      ) {
        return rejected(
          "CONFIG_CONFLICT",
          "This configuration changed after you opened it. Reload before continuing.",
        );
      }
      if (
        command.command === "publish-configuration" &&
        state.draft?.changes.some(
          (change) =>
            "operation" in change &&
            change.operation === "deploy-prompt-version",
        ) === true &&
        !accessHasTenantCapability(access, scope.tenantId, "ai:operate")
      ) {
        return NOT_FOUND;
      }
      if (command.command === "cancel-configuration-draft") {
        const cancelled = await store.cancelConfigurationDraft({
          tenantId: scope.tenantId,
          locationId: scope.locationId,
          expectedRevision: state.revision,
          expectedDraft:
            state.draft === null
              ? null
              : { id: state.draft.id, revision: state.draft.revision },
        });
        return cancelled.status === "conflict"
          ? rejected(
              "CONFIG_CONFLICT",
              "This configuration changed after you opened it. Reload before continuing.",
            )
          : ACCEPTED;
      }
      const published = await store.publishConfiguration({
        tenantId: scope.tenantId,
        locationId: scope.locationId,
        expectedRevision: state.revision,
        expectedDraft:
          state.draft === null
            ? null
            : { id: state.draft.id, revision: state.draft.revision },
        actorId: access.operator.id,
      });
      switch (published.status) {
        case "published":
          return ACCEPTED;
        case "conflict":
          return rejected(
            "CONFIG_CONFLICT",
            "This configuration changed after you opened it. Reload before continuing.",
          );
        case "no-draft":
          return rejected("INVALID_VALUE", "There is no Draft to publish.");
        case "incomplete":
          return rejected(
            "INVALID_VALUE",
            `This configuration cannot be published yet. Missing: ${published.missing.join(", ")}.`,
          );
        default:
          return rejected(
            "INVALID_VALUE",
            "This configuration could not be published.",
          );
      }
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
              key: command.change.key,
              value: command.change.value,
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
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Location overrides must be staged with stage-configuration-changes and published from the Location Draft.",
      );
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

    case "republish-configuration": {
      const resolved = await requireLocation(store, scope);
      if (resolved === null) {
        return NOT_FOUND;
      }
      return rejected(
        "INVALID_VALUE",
        "Direct republish is retired; save a Draft and publish it with its base revision.",
      );
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
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Fact Options must be staged with stage-configuration-changes and published from the scoped Draft.",
      );
    }

    case "update-keyword": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Fact Options must be staged with stage-configuration-changes and published from the scoped Draft.",
      );
    }

    case "reorder-keywords": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Fact Option order must be staged with stage-configuration-changes and published from the scoped Draft.",
      );
    }

    case "delete-keyword": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Fact Options must be staged with stage-configuration-changes and published from the scoped Draft.",
      );
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
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Review Format enablement must be staged with stage-configuration-changes and published from the Tenant Draft.",
      );
    }

    case "reorder-styles": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Review Format order must be staged with stage-configuration-changes and published from the Tenant Draft.",
      );
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
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Action enablement must be staged with stage-configuration-changes and published from the Tenant Draft.",
      );
    }

    case "create-prompt-version": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const existing = await store.listPrompts(scope.tenantId, command.action);
      const promptKey = `${scope.tenantId}:${command.action}`;
      const hash = derivePromptVersionHash({
        key: promptKey,
        commandKind: promptCommandKind(command.action),
        body: command.body,
        variables: [...command.variables],
      });
      await store.createPromptVersion({
        tenantId: scope.tenantId,
        action: command.action,
        key: promptKey,
        version: nextPublishedVersion(existing),
        hash,
        body: command.body,
        variables: command.variables,
        createdBy: access.operator.id,
      });
      return ACCEPTED;
    }

    case "promote-prompt-version": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const qualified = await store.promotePromptVersion({
        tenantId: scope.tenantId,
        promptVersionId: command.promptVersionId,
      });
      return qualified.status === "candidate"
        ? ACCEPTED
        : qualified.status === "unknown-prompt"
          ? NOT_FOUND
          : rejected(
              "INVALID_VALUE",
              "The Prompt Version must pass its latest complete evaluation before it can become a Candidate.",
            );
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
        : created.status === "invalid-variants"
          ? rejected(
              "INVALID_VALUE",
              "Experiment variants must be distinct, evaluated Prompt Versions for the selected Action.",
            )
          : ACCEPTED;
    }

    case "start-experiment":
    case "stop-experiment": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const changed = await store.setExperimentStatus({
        tenantId: scope.tenantId,
        experimentId: command.experimentId,
        status: command.command === "start-experiment" ? "running" : "stopped",
      });
      switch (changed.status) {
        case "changed":
          return ACCEPTED;
        case "unknown-experiment":
          return NOT_FOUND;
        case "action-already-running":
          return rejected(
            "EXPERIMENT_RUNNING",
            "Another experiment is already running for this Action.",
          );
        case "quality-gate-rejected":
          return rejected(
            "INVALID_VALUE",
            "Every variant needs a canonical Prompt hash and a latest 100% grounding evaluation before the experiment can start.",
          );
        case "invalid-transition":
          return rejected(
            "EXPERIMENT_NOT_DRAFT",
            "Only a draft experiment can be started, and only a running one can be stopped.",
          );
      }
      return rejected(
        "INVALID_VALUE",
        "The Experiment transition could not be completed.",
      );
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

    case "set-tenant-status": {
      const saved = await store.setTenantStatus({
        tenantId: command.tenantId,
        status: command.status,
      });
      return saved.status === "not-found" ? NOT_FOUND : ACCEPTED;
    }

    case "create-keyword-category": {
      if (scope.tenantId === null) {
        return NOT_FOUND;
      }
      const created = await store.createKeywordCategory({
        tenantId: scope.tenantId,
        key: command.key,
        label: command.label,
      });
      return created.status === "key-taken"
        ? rejected(
            "SLUG_TAKEN",
            "This account already has a category with that key.",
          )
        : ACCEPTED;
    }

    case "set-provider-routing": {
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Provider routing must be staged and published from the Platform Draft.",
      );
    }

    case "publish-price-rate": {
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Price Rates must be staged and published from the Platform Draft.",
      );
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
      return rejected(
        "CONFIG_DRAFT_REQUIRED",
        "Platform settings must be staged and published from the Platform Draft.",
      );
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
