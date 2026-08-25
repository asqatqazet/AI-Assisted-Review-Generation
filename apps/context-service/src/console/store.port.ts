import type {
  ConsoleActionKeyDto,
  ConsoleAnalyticsQueryDto,
  ConsoleAnalyticsRowDto,
  ConsoleBenchInputDto,
  ConsoleBenchResultDto,
  ConsoleConfigurationDraftChangeDto,
  ConsolePlatformConfigurationDraftChangeDto,
  ConsoleGenerationDetailDto,
  ConsoleKeywordDto,
  ConsoleOverviewDto,
  ConsoleReviewDestinationDto,
  ConsoleSettingValueDto,
  PlatformProvidersDto,
  PlatformSettingsDto,
  PlatformStylesDto,
  PlatformTenantsDto,
} from "@review/contracts/console";

export interface ConsoleTenantRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly locale: "en-GB" | "de-DE";
  readonly platformDefaults: Readonly<Record<string, ConsoleSettingValueDto>>;
  readonly tenantValues: Readonly<Record<string, ConsoleSettingValueDto>>;
  readonly settings: Readonly<Record<string, ConsoleSettingValueDto>>;
  readonly keywordCategories: readonly {
    readonly key: string;
    readonly label: string;
    readonly sortOrder: number;
  }[];
}

export interface ConsoleLocationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly address: {
    readonly line1: string;
    readonly line2: string;
    readonly postalCode: string;
    readonly city: string;
    readonly country: string;
  };
  readonly active: boolean;
  readonly overrides: Readonly<Record<string, unknown>>;
}

export interface ConsoleContextVersionRecord {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly context: string;
  readonly bannedTerms: readonly string[];
}

export interface ConsoleStyleRecord {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly locale: "en-GB" | "de-DE" | "any";
  readonly targetPlatform: string;
  readonly maxChars: number;
  readonly supportedActions: readonly ConsoleActionKeyDto[];
  readonly manifest: string;
  readonly enabled: boolean;
  readonly sortOrder: number;
  readonly enabledActions: readonly ConsoleActionKeyDto[];
  readonly validationStatus: "valid" | "invalid" | "unvalidated";
}

export interface ConsoleActionRecord {
  readonly key: ConsoleActionKeyDto;
  readonly label: string;
  readonly enabled: boolean;
  readonly requiredInputs: readonly string[];
  readonly groundingRule: string;
  readonly relativeCost: "low" | "medium" | "high";
  /** True for the Actions a reviewer can start a Survey with. */
  readonly isEntryAction: boolean;
}

export interface ConsolePromptRecord {
  readonly id: string;
  readonly action: ConsoleActionKeyDto;
  readonly version: number;
  readonly hash: string;
  readonly status:
    | "draft"
    | "candidate"
    | "in-experiment"
    | "published"
    | "retired";
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly evaluationScore: number | null;
  readonly body: string;
  readonly variables: readonly string[];
}

export interface ConsoleExperimentRecord {
  readonly id: string;
  readonly action: ConsoleActionKeyDto;
  readonly status: "draft" | "running" | "stopped";
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly stoppedAt: string | null;
  readonly variants: readonly {
    readonly promptVersionId: string;
    readonly promptVersionHash: string;
    readonly weightPct: number;
    readonly generations: number;
    readonly accepted: number;
  }[];
  /** False when Generation counts could not be resolved for these variants. */
  readonly metricsAvailable: boolean;
}

export interface ConsoleDistributionRecord {
  readonly surveyUrl: string;
  readonly entryMode: "invite" | "open-qr" | "both";
  readonly invitationTemplate: string;
  readonly tableQrCopy: string;
  readonly counters: {
    readonly issued: number;
    readonly opened: number;
    readonly completed: number;
  };
}

export type ConsoleScopeSelector =
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string }
  | {
      readonly type: "location";
      readonly tenantId: string;
      readonly locationId: string;
    };

/**
 * Persistence seam for the operator control plane. Every method is already
 * scoped: the service resolves and authorizes the scope before calling in, so
 * a store implementation never has to re-derive who is asking.
 */
export interface ConsoleControlPlaneStore {
  readTenant(tenantId: string): Promise<ConsoleTenantRecord | null>;
  /**
   * Every Tenant a Platform administrator may switch to. Grants alone cannot
   * answer this: an account they provision carries no Tenant Grant for them,
   * so it would otherwise be invisible in the scope bar it belongs in.
   */
  listSelectableTenants(): Promise<
    readonly {
      readonly id: string;
      readonly slug: string;
      readonly name: string;
      readonly locations: readonly {
        readonly id: string;
        readonly slug: string;
        readonly name: string;
        readonly active: boolean;
      }[];
    }[]
  >;
  listLocations(tenantId: string): Promise<readonly ConsoleLocationRecord[]>;
  readLocation(
    tenantId: string,
    locationId: string,
  ): Promise<ConsoleLocationRecord | null>;
  /** Latest immutable snapshot currently published for this exact venue. */
  readPublishedConfigurationSnapshot(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly configurationReleaseId?: string | undefined;
  }): Promise<{ readonly contentHash: string; readonly payload: unknown } | null>;
  createLocation(input: {
    readonly tenantId: string;
    readonly name: string;
    readonly slug: string;
    readonly address: ConsoleLocationRecord["address"];
    readonly entryMode: "invite" | "open-qr" | "both" | null;
  }): Promise<{ readonly status: "created" } | { readonly status: "slug-taken" }>;
  updateLocation(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly name: string;
    readonly address: ConsoleLocationRecord["address"];
    readonly active: boolean;
  }): Promise<void>;
  saveTenantSettings(input: {
    readonly tenantId: string;
    readonly values: Readonly<Record<string, ConsoleSettingValueDto>>;
  }): Promise<void>;
  writeLocationOverrides(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly overrides: Readonly<Record<string, unknown>>;
  }): Promise<void>;
  readConfigurationState(input: {
    readonly tenantId: string;
    readonly locationId: string | null;
  }): Promise<{
    readonly revision: string;
    readonly draft: {
      readonly id: string;
      readonly revision: string;
      readonly baseRevision: string;
      readonly changes: readonly ConsoleConfigurationDraftChangeDto[];
    } | null;
  } | null>;
  saveConfigurationDraft(input: {
    readonly tenantId: string;
    readonly locationId: string | null;
    readonly expectedRevision: string;
    readonly expectedDraft: {
      readonly id: string;
      readonly revision: string;
    } | null;
    readonly changes: readonly ConsoleConfigurationDraftChangeDto[];
    readonly actorId: string;
  }): Promise<{ readonly status: "saved" } | { readonly status: "conflict" }>;
  cancelConfigurationDraft(input: {
    readonly tenantId: string;
    readonly locationId: string | null;
    readonly expectedRevision: string;
    readonly expectedDraft: {
      readonly id: string;
      readonly revision: string;
    } | null;
  }): Promise<{ readonly status: "cancelled" } | { readonly status: "conflict" }>;
  publishConfiguration(input: {
    readonly tenantId: string;
    readonly locationId: string | null;
    readonly expectedRevision: string;
    readonly expectedDraft: {
      readonly id: string;
      readonly revision: string;
    } | null;
    readonly actorId: string;
    readonly configurationReleaseId?: string | undefined;
  }): Promise<
    | {
        readonly status: "published";
        readonly snapshotIds: readonly string[];
        readonly configurationReleaseId: string;
      }
    | { readonly status: "conflict" }
    | { readonly status: "no-draft" }
    | { readonly status: "incomplete"; readonly missing: readonly string[] }
  >;

  readPlatformConfigurationState(): Promise<{
    readonly revision: string;
    readonly draft: {
      readonly id: string;
      readonly revision: string;
      readonly baseRevision: string;
      readonly changes: readonly ConsolePlatformConfigurationDraftChangeDto[];
    } | null;
  }>;
  savePlatformConfigurationDraft(input: {
    readonly expectedRevision: string;
    readonly expectedDraft: {
      readonly id: string;
      readonly revision: string;
    } | null;
    readonly changes: readonly ConsolePlatformConfigurationDraftChangeDto[];
    readonly actorId: string;
  }): Promise<{ readonly status: "saved" } | { readonly status: "conflict" }>;
  cancelPlatformConfigurationDraft(input: {
    readonly expectedRevision: string;
    readonly expectedDraft: {
      readonly id: string;
      readonly revision: string;
    } | null;
  }): Promise<{ readonly status: "cancelled" } | { readonly status: "conflict" }>;
  publishPlatformConfiguration(input: {
    readonly expectedRevision: string;
    readonly expectedDraft: {
      readonly id: string;
      readonly revision: string;
    } | null;
    readonly actorId: string;
  }): Promise<
    | { readonly status: "published"; readonly snapshotIds: readonly string[] }
    | { readonly status: "conflict" }
    | { readonly status: "no-draft" }
    | { readonly status: "incomplete"; readonly missing: readonly string[] }
  >;

  readDistribution(
    tenantId: string,
    locationId: string,
    publicOrigin: string,
  ): Promise<ConsoleDistributionRecord | null>;
  listDestinations(
    tenantId: string,
    locationId: string,
  ): Promise<readonly ConsoleReviewDestinationDto[]>;
  saveDestination(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly destinationTypeId: string;
    readonly platformPlaceId: string;
    readonly targetUrl: string;
    readonly enabled: boolean;
  }): Promise<{ readonly status: "saved" } | { readonly status: "unknown-destination" }>;

  listContextVersions(
    tenantId: string,
  ): Promise<readonly ConsoleContextVersionRecord[]>;
  publishContextVersion(input: {
    readonly tenantId: string;
    readonly version: number;
    readonly context: string;
    readonly bannedTerms: readonly string[];
    readonly createdBy: string;
  }): Promise<void>;

  listKeywords(
    tenantId: string,
    locationId: string | null,
  ): Promise<readonly ConsoleKeywordDto[]>;
  createKeywordCategory(input: {
    readonly tenantId: string;
    readonly key: string;
    readonly label: string;
  }): Promise<{ readonly status: "created" } | { readonly status: "key-taken" }>;
  createKeyword(input: {
    readonly tenantId: string;
    readonly locationId: string | null;
    readonly label: string;
    readonly categoryKey: string;
    readonly polarity: "positive" | "neutral" | "negative";
  }): Promise<{ readonly status: "created" } | { readonly status: "unknown-category" }>;
  updateKeyword(input: {
    readonly tenantId: string;
    readonly keywordId: string;
    readonly label: string;
    readonly polarity: "positive" | "neutral" | "negative";
    readonly active: boolean;
  }): Promise<{ readonly status: "updated" } | { readonly status: "not-found" }>;
  reorderKeywords(input: {
    readonly tenantId: string;
    readonly orderedKeywordIds: readonly string[];
  }): Promise<void>;
  deleteKeyword(input: {
    readonly tenantId: string;
    readonly keywordId: string;
  }): Promise<{ readonly status: "deleted" } | { readonly status: "not-found" }>;

  listStyles(tenantId: string): Promise<readonly ConsoleStyleRecord[]>;
  setStyleEnablement(input: {
    readonly tenantId: string;
    readonly styleId: string;
    readonly enabled: boolean;
    readonly enabledActions: readonly ConsoleActionKeyDto[];
  }): Promise<void>;
  reorderStyles(input: {
    readonly tenantId: string;
    readonly orderedStyleIds: readonly string[];
  }): Promise<void>;

  listActions(tenantId: string): Promise<readonly ConsoleActionRecord[]>;
  setActionEnablement(input: {
    readonly tenantId: string;
    readonly action: ConsoleActionKeyDto;
    readonly enabled: boolean;
  }): Promise<void>;

  listPrompts(
    tenantId: string,
    action: ConsoleActionKeyDto | null,
  ): Promise<readonly ConsolePromptRecord[]>;
  readPrompt(
    tenantId: string,
    promptVersionId: string,
  ): Promise<ConsolePromptRecord | null>;
  createPromptVersion(input: {
    readonly tenantId: string;
    readonly action: ConsoleActionKeyDto;
    readonly key: string;
    readonly version: number;
    readonly hash: string;
    readonly body: string;
    readonly variables: readonly string[];
    readonly createdBy: string;
  }): Promise<void>;
  promotePromptVersion(input: {
    readonly tenantId: string;
    readonly promptVersionId: string;
  }): Promise<
    | { readonly status: "candidate" }
    | { readonly status: "unknown-prompt" }
    | { readonly status: "quality-gate-rejected" }
  >;

  listExperiments(
    tenantId: string,
  ): Promise<readonly ConsoleExperimentRecord[]>;
  readExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<ConsoleExperimentRecord | null>;
  createExperiment(input: {
    readonly tenantId: string;
    readonly action: ConsoleActionKeyDto;
    readonly variants: readonly {
      readonly promptVersionId: string;
      readonly weightPct: number;
    }[];
  }): Promise<
    | { readonly status: "created" }
    | { readonly status: "unknown-prompt" }
    | { readonly status: "invalid-variants" }
  >;
  setExperimentStatus(input: {
    readonly tenantId: string;
    readonly experimentId: string;
    readonly status: "running" | "stopped";
  }): Promise<
    | { readonly status: "changed" }
    | { readonly status: "unknown-experiment" }
    | { readonly status: "invalid-transition" }
    | { readonly status: "action-already-running" }
    | { readonly status: "quality-gate-rejected" }
  >;

  listPlatformTenants(): Promise<PlatformTenantsDto["tenants"]>;
  createTenant(input: {
    readonly name: string;
    readonly slug: string;
    readonly locale: "en-GB" | "de-DE";
    readonly category: string;
    readonly plan: string;
  }): Promise<{ readonly status: "created" } | { readonly status: "slug-taken" }>;
  setTenantStatus(input: {
    readonly tenantId: string;
    readonly status: "active" | "suspended" | "deactivated";
  }): Promise<{ readonly status: "saved" } | { readonly status: "not-found" }>;
  readPlatformProviders(): Promise<
    Omit<PlatformProvidersDto, "scope" | "configuration">
  >;
  setProviderRouting(input: {
    readonly providerKey: string;
    readonly modelKey: string;
    readonly routingPriority: number | null;
    readonly fallbackPriority: number | null;
  }): Promise<
    | { readonly status: "saved" }
    | { readonly status: "unknown-model" }
    | { readonly status: "invalid-routing" }
  >;
  publishPriceRate(input: {
    readonly providerKey: string;
    readonly modelKey: string;
    readonly inputMicrosPerMillion: number;
    readonly outputMicrosPerMillion: number;
    readonly currency: string;
    readonly validFrom: string;
  }): Promise<
    { readonly status: "published" } | { readonly status: "not-later-than-current" }
  >;
  listPlatformStyles(): Promise<PlatformStylesDto["styles"]>;
  importPlatformStyle(input: {
    readonly manifest: string;
  }): Promise<{ readonly status: "imported" } | { readonly status: "invalid" }>;
  readPlatformSettings(): Promise<
    Omit<PlatformSettingsDto, "scope" | "configuration">
  >;
  savePlatformSettings(input: {
    readonly defaultPolicyTemplate: string;
    readonly globalRateLimits: PlatformSettingsDto["globalRateLimits"];
    readonly logRetentionDays: number;
    readonly featureFlags: readonly {
      readonly key: string;
      readonly enabled: boolean;
    }[];
  }): Promise<void>;
}

/**
 * Generation history lives in the execution plane, under a different database
 * role that `context_svc` deliberately cannot read. Overview totals, analytics
 * and Generation reconstruction therefore arrive over their own seam rather
 * than by widening the control-plane grant.
 */
export interface ConsoleExecutionStore {
  readOverview(input: {
    readonly scope: ConsoleScopeSelector;
    readonly from: string;
    readonly to: string;
  }): Promise<Omit<ConsoleOverviewDto, "scope">>;

  readAnalytics(input: {
    readonly scope: ConsoleScopeSelector;
    readonly query: ConsoleAnalyticsQueryDto;
  }): Promise<readonly ConsoleAnalyticsRowDto[]>;

  readGenerationDetail(input: {
    readonly scope: ConsoleScopeSelector;
    readonly generationId: string;
  }): Promise<
    | (ConsoleGenerationDetailDto["generation"] & {
        readonly lineage: ConsoleGenerationDetailDto["lineage"];
        readonly replayInput: ConsoleBenchInputDto | null;
        readonly missingReplayDependencies: readonly string[];
      })
    | null
  >;

  runBench(input: {
    readonly tenantId: string;
    readonly locationId: string | null;
    readonly input: ConsoleBenchInputDto;
  }): Promise<ConsoleBenchResultDto>;
}

/**
 * The control-plane store is opened per operator so Row-Level Security can
 * re-check, in the database, the decision the service already made.
 */
export interface ConsoleControlPlaneStoreFactory {
  forOperator(operatorId: string): ConsoleControlPlaneStore;
}

/** Both halves, as the service tests exercise them together. */
export interface ConsoleStore
  extends ConsoleControlPlaneStore,
    ConsoleExecutionStore {}
