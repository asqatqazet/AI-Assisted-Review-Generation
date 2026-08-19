import { PrismaClient, type Prisma } from "../generated/control-plane/index.js";

/**
 * PostgreSQL adapter for the operator Console control plane.
 *
 * Everything here is readable by the `context_svc` role. Generation history
 * lives under `generation_svc` in the execution plane and is deliberately not
 * reachable from this module — the Console reads it over its own seam rather
 * than by widening this role's grants.
 *
 * Every call runs inside a transaction that sets `app.operator_id` and, for a
 * Tenant-scoped call, `app.tenant_id`. The Console service has already
 * authorized the scope; these settings make Row-Level Security enforce the
 * same decision a second time in the database.
 */

type Transaction = Prisma.TransactionClient;

/**
 * Raised when the database does not agree that this operator may act in the
 * requested scope. Reads degrade to the neutral empty projection; writes fail
 * loudly, because reaching one means the service authorized something the
 * Grants no longer support.
 */
export class ConsoleScopeDeniedError extends Error {
  public constructor(scope: string) {
    super(`Operator is not authorized for ${scope}.`);
    this.name = "ConsoleScopeDeniedError";
  }
}

export type ConsoleActionKey =
  | "generate"
  | "paraphrase"
  | "resample"
  | "reformat"
  | "condense"
  | "expand"
  | "revise-wording"
  | "add-assertion";

type StoredAction =
  | "GENERATE"
  | "PARAPHRASE"
  | "REGENERATE"
  | "REFORMAT"
  | "CONDENSE"
  | "EXPAND"
  | "REVISE_WORDING"
  | "ADD_FACT";

const ACTION_TO_STORED: Readonly<Record<ConsoleActionKey, StoredAction>> = {
  generate: "GENERATE",
  paraphrase: "PARAPHRASE",
  resample: "REGENERATE",
  reformat: "REFORMAT",
  condense: "CONDENSE",
  expand: "EXPAND",
  "revise-wording": "REVISE_WORDING",
  "add-assertion": "ADD_FACT",
};

const STORED_TO_ACTION = Object.fromEntries(
  Object.entries(ACTION_TO_STORED).map(([key, stored]) => [stored, key]),
) as Readonly<Record<StoredAction, ConsoleActionKey>>;

const ACTION_LABELS: Readonly<Record<ConsoleActionKey, string>> = {
  generate: "Generate",
  paraphrase: "Paraphrase",
  resample: "Resample",
  reformat: "Reformat",
  condense: "Condense",
  expand: "Expand",
  "revise-wording": "Revise wording",
  "add-assertion": "Add assertion",
};

/** Which Actions a reviewer can start a Survey with, rather than derive from. */
const ENTRY_ACTIONS = new Set<ConsoleActionKey>(["generate", "paraphrase"]);

const ACTION_GROUNDING: Readonly<Record<ConsoleActionKey, string>> = {
  generate: "Every Claim maps to a confirmed Assertion.",
  paraphrase: "Claims are a subset of the reviewer's own source text.",
  resample: "Reuses the original normalized inputs and versions.",
  reformat: "Claims are a subset of the source Generation.",
  condense: "Claims are a subset of the source Generation.",
  expand: "Preserves the exact Claim set or is rejected.",
  "revise-wording": "Adds no Claim to the source Generation.",
  "add-assertion": "Requires explicit confirmation and reruns every check.",
};

const ACTION_COST: Readonly<Record<ConsoleActionKey, "low" | "medium" | "high">> =
  {
    generate: "medium",
    paraphrase: "low",
    resample: "medium",
    reformat: "low",
    condense: "low",
    expand: "high",
    "revise-wording": "low",
    "add-assertion": "medium",
  };

const POLARITY_TO_STORED = {
  positive: "POSITIVE",
  neutral: "NEUTRAL",
  negative: "NEGATIVE",
} as const;

const STORED_TO_POLARITY = {
  POSITIVE: "positive",
  NEUTRAL: "neutral",
  NEGATIVE: "negative",
} as const;

const STORED_TO_PROMPT_STATUS = {
  DRAFT: "draft",
  CANDIDATE: "candidate",
  IN_EXPERIMENT: "in-experiment",
  RETIRED: "retired",
} as const;

type Locale = "en-GB" | "de-DE";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Localized Json columns carry one string per locale plus a fallback. */
function localized(value: unknown, locale: Locale): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return "";
  }
  const preferred = value[locale];
  if (typeof preferred === "string") {
    return preferred;
  }
  const fallback = value["en-GB"];
  if (typeof fallback === "string") {
    return fallback;
  }
  const first = Object.values(value).find(
    (candidate) => typeof candidate === "string",
  );
  return typeof first === "string" ? first : "";
}

function readString(source: unknown, key: string, fallback: string): string {
  if (!isRecord(source)) {
    return fallback;
  }
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

function readBoolean(source: unknown, key: string, fallback: boolean): boolean {
  if (!isRecord(source)) {
    return fallback;
  }
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(source: unknown, key: string, fallback: number): number {
  if (!isRecord(source)) {
    return fallback;
  }
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStringArray(source: unknown, key: string): string[] {
  if (!isRecord(source)) {
    return [];
  }
  const value = source[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

const asLocale = (value: string): Locale =>
  value === "de-DE" ? "de-DE" : "en-GB";

export interface ConsoleControlPlaneStoreOptions {
  readonly databaseUrl: string;
  readonly currency?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface PostgresConsoleControlPlaneStore {
  forOperator(operatorId: string): ConsoleControlPlaneOperations;
  disconnect(): Promise<void>;
}

type SettingValue = string | number | boolean | string[];

export interface ConsoleControlPlaneOperations {
  readTenant(tenantId: string): Promise<TenantRecord | null>;
  listLocations(tenantId: string): Promise<LocationRecord[]>;
  readLocation(
    tenantId: string,
    locationId: string,
  ): Promise<LocationRecord | null>;
  createLocation(input: {
    readonly tenantId: string;
    readonly name: string;
    readonly slug: string;
    readonly address: AddressRecord;
    readonly entryMode: "invite" | "open-qr" | "both" | null;
  }): Promise<{ status: "created" } | { status: "slug-taken" }>;
  updateLocation(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly name: string;
    readonly address: AddressRecord;
    readonly active: boolean;
  }): Promise<void>;
  saveTenantSettings(input: {
    readonly tenantId: string;
    readonly values: Readonly<Record<string, SettingValue>>;
  }): Promise<void>;
  writeLocationOverrides(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly overrides: Readonly<Record<string, unknown>>;
  }): Promise<void>;
  readDistribution(
    tenantId: string,
    locationId: string,
    publicOrigin: string,
  ): Promise<DistributionRecord | null>;
  listDestinations(
    tenantId: string,
    locationId: string,
  ): Promise<DestinationRecord[]>;
  saveDestination(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly destinationTypeId: string;
    readonly platformPlaceId: string;
    readonly targetUrl: string;
    readonly enabled: boolean;
  }): Promise<{ status: "saved" } | { status: "unknown-destination" }>;
  listContextVersions(tenantId: string): Promise<ContextVersionRecord[]>;
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
  ): Promise<KeywordRecord[]>;
  createKeyword(input: {
    readonly tenantId: string;
    readonly locationId: string | null;
    readonly label: string;
    readonly categoryKey: string;
    readonly polarity: "positive" | "neutral" | "negative";
  }): Promise<{ status: "created" } | { status: "unknown-category" }>;
  updateKeyword(input: {
    readonly tenantId: string;
    readonly keywordId: string;
    readonly label: string;
    readonly polarity: "positive" | "neutral" | "negative";
    readonly active: boolean;
  }): Promise<{ status: "updated" } | { status: "not-found" }>;
  reorderKeywords(input: {
    readonly tenantId: string;
    readonly orderedKeywordIds: readonly string[];
  }): Promise<void>;
  deleteKeyword(input: {
    readonly tenantId: string;
    readonly keywordId: string;
  }): Promise<{ status: "deleted" } | { status: "not-found" }>;
  listStyles(tenantId: string): Promise<StyleRecord[]>;
  setStyleEnablement(input: {
    readonly tenantId: string;
    readonly styleId: string;
    readonly enabled: boolean;
    readonly enabledActions: readonly ConsoleActionKey[];
  }): Promise<void>;
  reorderStyles(input: {
    readonly tenantId: string;
    readonly orderedStyleIds: readonly string[];
  }): Promise<void>;
  listActions(tenantId: string): Promise<ActionRecord[]>;
  setActionEnablement(input: {
    readonly tenantId: string;
    readonly action: ConsoleActionKey;
    readonly enabled: boolean;
  }): Promise<void>;
  listPrompts(
    tenantId: string,
    action: ConsoleActionKey | null,
  ): Promise<PromptRecord[]>;
  readPrompt(
    tenantId: string,
    promptVersionId: string,
  ): Promise<PromptRecord | null>;
  createPromptVersion(input: {
    readonly tenantId: string;
    readonly action: ConsoleActionKey;
    readonly version: number;
    readonly hash: string;
    readonly body: string;
    readonly variables: readonly string[];
    readonly createdBy: string;
  }): Promise<void>;
  listExperiments(tenantId: string): Promise<ExperimentRecord[]>;
  readExperiment(
    tenantId: string,
    experimentId: string,
  ): Promise<ExperimentRecord | null>;
  createExperiment(input: {
    readonly tenantId: string;
    readonly action: ConsoleActionKey;
    readonly variants: readonly {
      readonly promptVersionId: string;
      readonly weightPct: number;
    }[];
  }): Promise<{ status: "created" } | { status: "unknown-prompt" }>;
  setExperimentStatus(input: {
    readonly tenantId: string;
    readonly experimentId: string;
    readonly status: "running" | "stopped";
  }): Promise<void>;
  listPlatformTenants(): Promise<PlatformTenantRecord[]>;
  createTenant(input: {
    readonly name: string;
    readonly slug: string;
    readonly locale: Locale;
    readonly category: string;
    readonly plan: string;
  }): Promise<{ status: "created" } | { status: "slug-taken" }>;
  readPlatformProviders(): Promise<PlatformProvidersRecord>;
  setProviderRouting(input: {
    readonly providerKey: string;
    readonly modelKey: string;
    readonly routingPriority: number | null;
    readonly fallbackPriority: number | null;
  }): Promise<{ status: "saved" } | { status: "unknown-model" }>;
  publishPriceRate(input: {
    readonly providerKey: string;
    readonly modelKey: string;
    readonly inputMicrosPerMillion: number;
    readonly outputMicrosPerMillion: number;
    readonly currency: string;
    readonly validFrom: string;
  }): Promise<{ status: "published" } | { status: "not-later-than-current" }>;
  listPlatformStyles(): Promise<PlatformStyleRecord[]>;
  importPlatformStyle(input: {
    readonly manifest: string;
  }): Promise<{ status: "imported" } | { status: "invalid" }>;
  readPlatformSettings(): Promise<PlatformSettingsRecord>;
  savePlatformSettings(input: {
    readonly defaultPolicyTemplate: string;
    readonly globalRateLimits: {
      readonly perReviewSessionPerHour: number;
      readonly perTenantPerMinute: number;
      readonly maxConcurrentGenerations: number;
    };
    readonly logRetentionDays: number;
    readonly featureFlags: readonly {
      readonly key: string;
      readonly enabled: boolean;
    }[];
  }): Promise<void>;
}

export interface AddressRecord {
  readonly line1: string;
  readonly line2: string;
  readonly postalCode: string;
  readonly city: string;
  readonly country: string;
}

export interface TenantRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly locale: Locale;
  readonly settings: Record<string, SettingValue>;
  readonly keywordCategories: {
    readonly key: string;
    readonly label: string;
    readonly sortOrder: number;
  }[];
}

export interface LocationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly address: AddressRecord;
  readonly active: boolean;
  readonly overrides: Record<string, unknown>;
}

export interface DistributionRecord {
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

export interface DestinationRecord {
  readonly destinationTypeId: string;
  readonly platform: string;
  readonly displayName: string;
  readonly platformPlaceId: string;
  readonly targetUrl: string;
  readonly enabled: boolean;
  readonly configurationState: "valid" | "missing" | "invalid";
}

export interface ContextVersionRecord {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly context: string;
  readonly bannedTerms: string[];
}

export interface KeywordRecord {
  readonly id: string;
  readonly label: string;
  readonly categoryKey: string;
  readonly categoryLabel: string;
  readonly polarity: "positive" | "neutral" | "negative";
  readonly ownerScope: "tenant" | "location";
  readonly active: boolean;
  readonly sortOrder: number;
  readonly deletable: boolean;
}

export interface StyleRecord {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly locale: Locale | "any";
  readonly targetPlatform: string;
  readonly maxChars: number;
  readonly supportedActions: ConsoleActionKey[];
  readonly manifest: string;
  readonly enabled: boolean;
  readonly sortOrder: number;
  readonly enabledActions: ConsoleActionKey[];
  readonly validationStatus: "valid" | "invalid" | "unvalidated";
}

export interface ActionRecord {
  readonly key: ConsoleActionKey;
  readonly label: string;
  readonly enabled: boolean;
  readonly requiredInputs: string[];
  readonly groundingRule: string;
  readonly relativeCost: "low" | "medium" | "high";
  readonly isEntryAction: boolean;
}

export interface PromptRecord {
  readonly id: string;
  readonly action: ConsoleActionKey;
  readonly version: number;
  readonly hash: string;
  readonly status: "draft" | "candidate" | "in-experiment" | "retired";
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly evaluationScore: number | null;
  readonly body: string;
  readonly variables: string[];
}

export interface ExperimentRecord {
  readonly id: string;
  readonly action: ConsoleActionKey;
  readonly status: "draft" | "running" | "stopped";
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly stoppedAt: string | null;
  readonly variants: {
    readonly promptVersionId: string;
    readonly promptVersionHash: string;
    readonly weightPct: number;
    readonly generations: number;
    readonly accepted: number;
  }[];
  readonly metricsAvailable: boolean;
}

export interface PlatformTenantRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly locale: Locale;
  readonly category: string;
  readonly locationCount: number;
  readonly plan: string;
  readonly monthToDateSpend: { readonly amountMicros: number; readonly currency: string };
  readonly monthlyBudget: { readonly amountMicros: number; readonly currency: string };
  readonly status: "active" | "suspended";
}

export interface PlatformProvidersRecord {
  readonly models: {
    readonly providerKey: string;
    readonly providerName: string;
    readonly modelKey: string;
    readonly modelName: string;
    readonly health: "healthy" | "degraded" | "unavailable";
    readonly credentialState: "configured" | "missing";
    readonly supportsStreaming: boolean;
    readonly supportsStructuredOutput: boolean;
    readonly maxTokens: number;
    readonly routingPriority: number | null;
    readonly fallbackPriority: number | null;
  }[];
  readonly priceVersions: {
    readonly id: string;
    readonly providerKey: string;
    readonly modelKey: string;
    readonly inputPerMillion: { readonly amountMicros: number; readonly currency: string };
    readonly outputPerMillion: { readonly amountMicros: number; readonly currency: string };
    readonly validFrom: string;
    readonly validTo: string | null;
    readonly superseded: boolean;
  }[];
}

export interface PlatformStyleRecord {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly version: string;
  readonly locale: Locale | "any";
  readonly targetPlatform: string;
  readonly maxChars: number;
  readonly supportedActions: ConsoleActionKey[];
  readonly validationStatus: "valid" | "invalid" | "unvalidated";
  readonly status: "active" | "retired";
}

export interface PlatformSettingsRecord {
  readonly defaultPolicyTemplate: string;
  readonly globalRateLimits: {
    readonly perReviewSessionPerHour: number;
    readonly perTenantPerMinute: number;
    readonly maxConcurrentGenerations: number;
  };
  readonly logRetentionDays: number;
  readonly featureFlags: {
    readonly key: string;
    readonly description: string;
    readonly enabled: boolean;
  }[];
}

const iso = (value: Date): string => value.toISOString();

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug === "" ? "fact-option" : slug;
}

export function createPostgresConsoleControlPlaneStore({
  databaseUrl,
  currency = "EUR",
  now = () => new Date(),
}: ConsoleControlPlaneStoreOptions): PostgresConsoleControlPlaneStore {
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  const money = (amountMicros: number) => ({ amountMicros, currency });

  return {
    disconnect: async () => {
      await client.$disconnect();
    },

    forOperator(operatorId) {
      /**
       * The database re-derives the scope instead of trusting the request.
       *
       * `app.tenant_id` is never set from the id that was asked for — it is set
       * only after a current Access Grant for this operator has been found, so
       * Row-Level Security is an independent check rather than a rubber stamp
       * on whatever the caller named.
       */
      const grantedForTenant = async (
        transaction: Transaction,
        tenantId: string,
      ): Promise<boolean> => {
        const rows = await transaction.$queryRaw<{ granted: boolean }[]>`
          SELECT (
            EXISTS (
              SELECT 1
              FROM tenant_access_grants AS access_grant
              WHERE access_grant.operator_id = ${operatorId}::uuid
                AND access_grant.tenant_id = ${tenantId}::uuid
                AND access_grant.status = 'ACTIVE'
                AND access_grant.valid_from <= clock_timestamp()
                AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
            )
            OR EXISTS (
              SELECT 1
              FROM platform_access_grants AS platform_grant
              WHERE platform_grant.operator_id = ${operatorId}::uuid
                AND platform_grant.status = 'ACTIVE'
                AND platform_grant.valid_from <= clock_timestamp()
                AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
            )
          ) AS granted
        `;
        return rows[0]?.granted === true;
      };

      const grantedForPlatform = async (
        transaction: Transaction,
      ): Promise<boolean> => {
        const rows = await transaction.$queryRaw<{ granted: boolean }[]>`
          SELECT EXISTS (
            SELECT 1
            FROM platform_access_grants AS platform_grant
            WHERE platform_grant.operator_id = ${operatorId}::uuid
              AND platform_grant.status = 'ACTIVE'
              AND platform_grant.valid_from <= clock_timestamp()
              AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
          ) AS granted
        `;
        return rows[0]?.granted === true;
      };

      const run = async <T>(
        tenantId: string | null,
        work: (transaction: Transaction) => Promise<T>,
      ): Promise<T> =>
        await client.$transaction(async (transaction) => {
          await transaction.$executeRaw`SELECT set_config('app.operator_id', ${operatorId}, true)`;
          if (tenantId === null) {
            if (!(await grantedForPlatform(transaction))) {
              throw new ConsoleScopeDeniedError("Platform scope");
            }
            return await work(transaction);
          }
          if (!(await grantedForTenant(transaction, tenantId))) {
            throw new ConsoleScopeDeniedError(`Tenant ${tenantId}`);
          }
          await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          return await work(transaction);
        });

      /**
       * A read of a scope this operator does not hold answers exactly like a
       * scope that holds nothing, so existence never leaks.
       */
      const orEmpty = async <T>(
        work: () => Promise<T>,
        fallback: T,
      ): Promise<T> => {
        try {
          return await work();
        } catch (error) {
          if (error instanceof ConsoleScopeDeniedError) {
            return fallback;
          }
          throw error;
        }
      };

      const readAddress = (value: unknown): AddressRecord => ({
        line1: readString(value, "line1", ""),
        line2: readString(value, "line2", ""),
        postalCode: readString(value, "postalCode", ""),
        city: readString(value, "city", ""),
        country: readString(value, "country", ""),
      });

      const readOverrides = (value: unknown): Record<string, unknown> =>
        isRecord(value) ? { ...value } : {};

      const loadTenant = async (
        transaction: Transaction,
        tenantId: string,
      ): Promise<TenantRecord | null> => {
        const tenant = await transaction.tenant.findUnique({
          where: { id: tenantId },
          include: { factOptionCategories: { orderBy: { sortOrder: "asc" } } },
        });
        if (tenant === null) {
          return null;
        }
        const locale = asLocale(tenant.locale);
        return {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          locale,
          settings: {
            locale,
            toneGuidelines: tenant.toneGuidelines ?? "",
            entryMode: (tenant.defaultEntryModeKey ?? "invite") as string,
            requireDisclosure: readBoolean(
              tenant.policy,
              "requireDisclosure",
              true,
            ),
            requireVerifiedExperience: readBoolean(
              tenant.policy,
              "requireVerifiedExperience",
              true,
            ),
            maxReviewFormatsPerRequest: readNumber(
              tenant.policy,
              "maxReviewFormatsPerRequest",
              1,
            ),
            bannedTerms: [...tenant.bannedTerms],
            monthlyBudgetMicros: Number(tenant.monthlyBudgetMicros),
            alertThresholdPct: tenant.alertThresholdPercent,
          },
          keywordCategories: tenant.factOptionCategories.map((category) => ({
            key: category.key,
            label: localized(category.label, locale),
            sortOrder: category.sortOrder,
          })),
        };
      };

      const mapLocation = (location: {
        id: string;
        tenantId: string;
        slug: string;
        name: string;
        address: unknown;
        overrides: unknown;
        status: string;
      }): LocationRecord => ({
        id: location.id,
        tenantId: location.tenantId,
        slug: location.slug,
        name: location.name,
        address: readAddress(location.address),
        active: location.status === "ACTIVE",
        overrides: readOverrides(location.overrides),
      });

      /** Latest live version of each Fact Option in scope. */
      const liveFactOptions = async (
        transaction: Transaction,
        tenantId: string,
        locationId: string | null,
      ) => {
        const rows = await transaction.factOptionVersion.findMany({
          where: {
            tenantId,
            retiredAt: null,
            OR: [
              { locationId: null },
              ...(locationId === null ? [] : [{ locationId }]),
            ],
          },
          include: { category: true },
          orderBy: [{ factOptionKey: "asc" }, { version: "desc" }],
        });
        const latest = new Map<string, (typeof rows)[number]>();
        for (const row of rows) {
          if (!latest.has(row.factOptionKey)) {
            latest.set(row.factOptionKey, row);
          }
        }
        return [...latest.values()];
      };

      const manifestOf = (format: {
        formatKey: string;
        version: number;
        locale: string;
        targetPlatform: string;
        constraints: unknown;
        localizedText: unknown;
        supportedActions: string[];
      }): string =>
        JSON.stringify(
          {
            key: format.formatKey,
            version: `${format.version}.0.0`,
            locale: format.locale,
            targetPlatform: format.targetPlatform,
            constraints: isRecord(format.constraints) ? format.constraints : {},
            supportedActions: format.supportedActions.map(
              (action) => STORED_TO_ACTION[action as StoredAction],
            ),
            localizedText: isRecord(format.localizedText)
              ? format.localizedText
              : {},
          },
          null,
          2,
        );

      const formatValidation = (format: {
        constraints: unknown;
        supportedActions: string[];
        targetPlatform: string;
      }): "valid" | "invalid" => {
        const minChars = readNumber(format.constraints, "minChars", -1);
        const maxChars = readNumber(format.constraints, "maxChars", -1);
        return minChars >= 0 &&
          maxChars > 0 &&
          minChars <= maxChars &&
          format.supportedActions.length > 0 &&
          format.targetPlatform.length > 0
          ? "valid"
          : "invalid";
      };

      const operations: ConsoleControlPlaneOperations = {
        readTenant: async (tenantId) =>
          await run(tenantId, (transaction) => loadTenant(transaction, tenantId)),

        listLocations: async (tenantId) =>
          await run(tenantId, async (transaction) =>
            (
              await transaction.location.findMany({
                where: { tenantId },
                orderBy: { name: "asc" },
              })
            ).map(mapLocation),
          ),

        readLocation: async (tenantId, locationId) =>
          await run(tenantId, async (transaction) => {
            const location = await transaction.location.findFirst({
              where: { id: locationId, tenantId },
            });
            return location === null ? null : mapLocation(location);
          }),

        createLocation: async (input) =>
          await run(input.tenantId, async (transaction) => {
            const clash = await transaction.location.findFirst({
              where: { tenantId: input.tenantId, slug: input.slug },
              select: { id: true },
            });
            if (clash !== null) {
              return { status: "slug-taken" as const };
            }
            await transaction.location.create({
              data: {
                tenantId: input.tenantId,
                slug: input.slug,
                name: input.name,
                address: { ...input.address },
                overrides:
                  input.entryMode === null ? {} : { entryMode: input.entryMode },
              },
            });
            return { status: "created" as const };
          }),

        updateLocation: async (input) => {
          await run(input.tenantId, async (transaction) => {
            await transaction.location.updateMany({
              where: { id: input.locationId, tenantId: input.tenantId },
              data: {
                name: input.name,
                address: { ...input.address },
                status: input.active ? "ACTIVE" : "INACTIVE",
              },
            });
          });
        },

        saveTenantSettings: async (input) => {
          await run(input.tenantId, async (transaction) => {
            const tenant = await transaction.tenant.findUnique({
              where: { id: input.tenantId },
              select: { policy: true },
            });
            if (tenant === null) {
              return;
            }
            const policy: Record<string, unknown> = isRecord(tenant.policy)
              ? { ...tenant.policy }
              : {};
            const data: Prisma.TenantUpdateInput = {};
            for (const [key, value] of Object.entries(input.values)) {
              switch (key) {
                case "locale":
                  data.locale = String(value);
                  break;
                case "toneGuidelines":
                  data.toneGuidelines = String(value);
                  break;
                case "entryMode":
                  data.defaultEntryMode = { connect: { key: String(value) } };
                  break;
                case "bannedTerms":
                  data.bannedTerms = Array.isArray(value)
                    ? value.map(String)
                    : [];
                  break;
                case "monthlyBudgetMicros":
                  data.monthlyBudgetMicros = BigInt(Math.trunc(Number(value)));
                  break;
                case "alertThresholdPct":
                  data.alertThresholdPercent = Math.trunc(Number(value));
                  break;
                default:
                  policy[key] = value as unknown;
                  break;
              }
            }
            data.policy = policy as Prisma.InputJsonValue;
            await transaction.tenant.update({
              where: { id: input.tenantId },
              data,
            });
          });
        },

        writeLocationOverrides: async (input) => {
          await run(input.tenantId, async (transaction) => {
            await transaction.location.updateMany({
              where: { id: input.locationId, tenantId: input.tenantId },
              data: { overrides: input.overrides as Prisma.InputJsonValue },
            });
          });
        },

        readDistribution: async (tenantId, locationId, publicOrigin) =>
          await run(tenantId, async (transaction) => {
            const tenant = await loadTenant(transaction, tenantId);
            const location = await transaction.location.findFirst({
              where: { id: locationId, tenantId },
            });
            if (tenant === null || location === null) {
              return null;
            }
            const overrides = readOverrides(location.overrides);
            const entryMode = (typeof overrides["entryMode"] === "string"
              ? overrides["entryMode"]
              : String(tenant.settings["entryMode"] ?? "invite")) as
              | "invite"
              | "open-qr"
              | "both";
            const [issued, opened, completed] = await Promise.all([
              transaction.invitationToken.count({
                where: { tenantId, locationId },
              }),
              transaction.entryChallenge.count({
                where: { tenantId, locationId },
              }),
              transaction.reviewSession.count({
                where: { tenantId, locationId, status: "CLOSED" },
              }),
            ]);
            return {
              surveyUrl: `${new URL(publicOrigin).origin}/s/${tenant.slug}/${location.slug}`,
              entryMode,
              invitationTemplate: `Thank you for visiting ${location.name}. If you would like to leave a review, this link opens the assistant for this venue.`,
              tableQrCopy: `Scan to write a review of ${location.name}.`,
              counters: { issued, opened, completed },
            };
          }),

        listDestinations: async (tenantId, locationId) =>
          await run(tenantId, async (transaction) => {
            const [types, bindings] = await Promise.all([
              transaction.postingDestinationType.findMany({
                where: { status: "ACTIVE" },
                orderBy: { key: "asc" },
              }),
              transaction.postingDestinationBinding.findMany({
                where: { tenantId, locationId },
              }),
            ]);
            return types.map((type) => {
              const binding = bindings.find(
                (candidate) => candidate.destinationTypeId === type.id,
              );
              const platformPlaceId = binding?.externalId ?? "";
              const targetUrl = binding?.targetUrl ?? "";
              return {
                destinationTypeId: type.id,
                platform: type.key,
                displayName: type.key,
                platformPlaceId,
                targetUrl,
                enabled: binding?.enabled ?? false,
                configurationState:
                  platformPlaceId.trim().length === 0
                    ? ("missing" as const)
                    : targetUrl.startsWith("https://")
                      ? ("valid" as const)
                      : ("invalid" as const),
              };
            });
          }),

        saveDestination: async (input) =>
          await run(input.tenantId, async (transaction) => {
            const type = await transaction.postingDestinationType.findUnique({
              where: { id: input.destinationTypeId },
              select: { id: true },
            });
            if (type === null) {
              return { status: "unknown-destination" as const };
            }
            await transaction.postingDestinationBinding.upsert({
              where: {
                tenantId_locationId_destinationTypeId: {
                  tenantId: input.tenantId,
                  locationId: input.locationId,
                  destinationTypeId: input.destinationTypeId,
                },
              },
              create: {
                tenantId: input.tenantId,
                locationId: input.locationId,
                destinationTypeId: input.destinationTypeId,
                externalId: input.platformPlaceId,
                targetUrl: input.targetUrl,
                enabled: input.enabled,
              },
              update: {
                externalId: input.platformPlaceId,
                targetUrl: input.targetUrl,
                enabled: input.enabled,
              },
            });
            return { status: "saved" as const };
          }),

        listContextVersions: async (tenantId) =>
          await run(tenantId, async (transaction) =>
            (
              await transaction.tenantContextVersion.findMany({
                where: { tenantId },
                orderBy: { version: "desc" },
              })
            ).map((row) => ({
              id: row.id,
              version: row.version,
              createdAt: iso(row.createdAt),
              createdBy: row.createdBy,
              context: row.context,
              bannedTerms: [...row.bannedTerms],
            })),
          ),

        publishContextVersion: async (input) => {
          await run(input.tenantId, async (transaction) => {
            await transaction.tenantContextVersion.create({
              data: {
                tenantId: input.tenantId,
                version: input.version,
                context: input.context,
                bannedTerms: [...input.bannedTerms],
                createdBy: input.createdBy,
              },
            });
          });
        },

        listKeywords: async (tenantId, locationId) =>
          await run(tenantId, async (transaction) => {
            const tenant = await transaction.tenant.findUnique({
              where: { id: tenantId },
              select: { locale: true },
            });
            const locale = asLocale(tenant?.locale ?? "en-GB");
            const rows = await liveFactOptions(transaction, tenantId, locationId);
            return rows.map((row) => ({
              id: row.id,
              label: localized(row.label, locale),
              categoryKey: row.category.key,
              categoryLabel: localized(row.category.label, locale),
              polarity: STORED_TO_POLARITY[row.polarity],
              ownerScope:
                row.ownerScope === "LOCATION"
                  ? ("location" as const)
                  : ("tenant" as const),
              active: row.isActive,
              sortOrder: row.sortOrder,
              deletable: true,
            }));
          }),

        createKeyword: async (input) =>
          await run(input.tenantId, async (transaction) => {
            const category = await transaction.factOptionCategory.findFirst({
              where: { tenantId: input.tenantId, key: input.categoryKey },
            });
            if (category === null) {
              return { status: "unknown-category" as const };
            }
            const tenant = await transaction.tenant.findUnique({
              where: { id: input.tenantId },
              select: { locale: true },
            });
            const locale = asLocale(tenant?.locale ?? "en-GB");
            const base = slugify(input.label);
            const taken = await transaction.factOptionVersion.findMany({
              where: { tenantId: input.tenantId, factOptionKey: { startsWith: base } },
              select: { factOptionKey: true },
            });
            const keys = new Set(taken.map((row) => row.factOptionKey));
            let factOptionKey = base;
            for (let suffix = 2; keys.has(factOptionKey); suffix += 1) {
              factOptionKey = `${base}-${suffix}`;
            }
            const highest = await transaction.factOptionVersion.aggregate({
              where: { tenantId: input.tenantId },
              _max: { sortOrder: true },
            });
            await transaction.factOptionVersion.create({
              data: {
                tenantId: input.tenantId,
                locationId: input.locationId,
                categoryId: category.id,
                factOptionKey,
                version: 1,
                ownerScope: input.locationId === null ? "TENANT" : "LOCATION",
                label: { [locale]: input.label },
                proposition: input.label,
                polarity: POLARITY_TO_STORED[input.polarity],
                sortOrder: (highest._max.sortOrder ?? 0) + 1,
                isActive: true,
              },
            });
            return { status: "created" as const };
          }),

        updateKeyword: async (input) =>
          await run(input.tenantId, async (transaction) => {
            const current = await transaction.factOptionVersion.findFirst({
              where: {
                id: input.keywordId,
                tenantId: input.tenantId,
                retiredAt: null,
              },
            });
            if (current === null) {
              return { status: "not-found" as const };
            }
            const tenant = await transaction.tenant.findUnique({
              where: { id: input.tenantId },
              select: { locale: true },
            });
            const locale = asLocale(tenant?.locale ?? "en-GB");
            // Editing publishes the next version so a historical Assertion
            // still resolves the wording the reviewer actually confirmed.
            await transaction.factOptionVersion.update({
              where: { id: current.id },
              data: { retiredAt: now() },
            });
            await transaction.factOptionVersion.create({
              data: {
                tenantId: current.tenantId,
                locationId: current.locationId,
                categoryId: current.categoryId,
                factOptionKey: current.factOptionKey,
                version: current.version + 1,
                ownerScope: current.ownerScope,
                label: { [locale]: input.label },
                proposition: input.label,
                polarity: POLARITY_TO_STORED[input.polarity],
                sortOrder: current.sortOrder,
                isActive: input.active,
              },
            });
            return { status: "updated" as const };
          }),

        reorderKeywords: async (input) => {
          await run(input.tenantId, async (transaction) => {
            await Promise.all(
              input.orderedKeywordIds.map((keywordId, index) =>
                transaction.factOptionVersion.updateMany({
                  where: { id: keywordId, tenantId: input.tenantId },
                  data: { sortOrder: index },
                }),
              ),
            );
          });
        },

        deleteKeyword: async (input) =>
          await run(input.tenantId, async (transaction) => {
            const updated = await transaction.factOptionVersion.updateMany({
              where: {
                id: input.keywordId,
                tenantId: input.tenantId,
                retiredAt: null,
              },
              data: { retiredAt: now(), isActive: false },
            });
            return updated.count === 0
              ? { status: "not-found" as const }
              : { status: "deleted" as const };
          }),

        listStyles: async (tenantId) =>
          await run(tenantId, async (transaction) => {
            const [formats, enablements] = await Promise.all([
              transaction.reviewFormatVersion.findMany({
                where: { status: "ACTIVE" },
                orderBy: [{ formatKey: "asc" }, { version: "desc" }],
              }),
              transaction.reviewFormatEnablement.findMany({
                where: { tenantId },
              }),
            ]);
            return formats.map((format) => {
              const enablement = enablements.find(
                (candidate) => candidate.reviewFormatVersionId === format.id,
              );
              const localeValue = format.locale;
              return {
                id: format.id,
                key: format.formatKey,
                name: localized(format.localizedText, "en-GB") || format.formatKey,
                version: `${format.version}.0.0`,
                locale: (localeValue === "any"
                  ? "any"
                  : asLocale(localeValue)) as Locale | "any",
                targetPlatform: format.targetPlatform,
                maxChars: readNumber(format.constraints, "maxChars", 1),
                supportedActions: format.supportedActions.map(
                  (action) => STORED_TO_ACTION[action as StoredAction],
                ),
                manifest: manifestOf(format),
                enabled: enablement?.enabled ?? false,
                sortOrder: enablement?.sortOrder ?? 0,
                enabledActions: (enablement?.allowedActions ?? []).map(
                  (action) => STORED_TO_ACTION[action as StoredAction],
                ),
                validationStatus: formatValidation(format),
              };
            });
          }),

        setStyleEnablement: async (input) => {
          await run(input.tenantId, async (transaction) => {
            await transaction.reviewFormatEnablement.upsert({
              where: {
                tenantId_reviewFormatVersionId: {
                  tenantId: input.tenantId,
                  reviewFormatVersionId: input.styleId,
                },
              },
              create: {
                tenantId: input.tenantId,
                reviewFormatVersionId: input.styleId,
                enabled: input.enabled,
                allowedActions: input.enabledActions.map(
                  (action) => ACTION_TO_STORED[action],
                ),
              },
              update: {
                enabled: input.enabled,
                allowedActions: input.enabledActions.map(
                  (action) => ACTION_TO_STORED[action],
                ),
              },
            });
          });
        },

        reorderStyles: async (input) => {
          await run(input.tenantId, async (transaction) => {
            await Promise.all(
              input.orderedStyleIds.map((styleId, index) =>
                transaction.reviewFormatEnablement.updateMany({
                  where: {
                    tenantId: input.tenantId,
                    reviewFormatVersionId: styleId,
                  },
                  data: { sortOrder: index },
                }),
              ),
            );
          });
        },

        listActions: async (tenantId) =>
          await run(tenantId, async (transaction) => {
            const [definitions, enablements] = await Promise.all([
              transaction.actionDefinition.findMany({
                where: { status: "ACTIVE" },
              }),
              transaction.tenantActionEnablement.findMany({
                where: { tenantId },
              }),
            ]);
            return definitions.map((definition) => {
              const key = STORED_TO_ACTION[definition.action as StoredAction];
              const enablement = enablements.find(
                (candidate) => candidate.action === definition.action,
              );
              return {
                key,
                label: ACTION_LABELS[key],
                enabled: enablement?.enabled ?? false,
                requiredInputs: readStringArray(
                  definition.inputContract,
                  "requiredInputs",
                ),
                groundingRule: ACTION_GROUNDING[key],
                relativeCost: ACTION_COST[key],
                isEntryAction: ENTRY_ACTIONS.has(key),
              };
            });
          }),

        setActionEnablement: async (input) => {
          await run(input.tenantId, async (transaction) => {
            await transaction.tenantActionEnablement.upsert({
              where: {
                tenantId_action: {
                  tenantId: input.tenantId,
                  action: ACTION_TO_STORED[input.action],
                },
              },
              create: {
                tenantId: input.tenantId,
                action: ACTION_TO_STORED[input.action],
                enabled: input.enabled,
              },
              update: { enabled: input.enabled },
            });
          });
        },

        listPrompts: async (tenantId, action) =>
          await run(tenantId, async (transaction) =>
            (
              await transaction.promptVersion.findMany({
                where: {
                  tenantId,
                  ...(action === null
                    ? {}
                    : { action: ACTION_TO_STORED[action] }),
                },
                orderBy: [{ action: "asc" }, { version: "desc" }],
              })
            ).map(mapPrompt),
          ),

        readPrompt: async (tenantId, promptVersionId) =>
          await run(tenantId, async (transaction) => {
            const row = await transaction.promptVersion.findFirst({
              where: { id: promptVersionId, tenantId },
            });
            return row === null ? null : mapPrompt(row);
          }),

        createPromptVersion: async (input) => {
          await run(input.tenantId, async (transaction) => {
            await transaction.promptVersion.create({
              data: {
                tenantId: input.tenantId,
                promptKey: "console",
                action: ACTION_TO_STORED[input.action],
                contentHash: input.hash,
                body: input.body,
                version: input.version,
                status: "DRAFT",
                createdBy: input.createdBy,
              },
            });
          });
        },

        listExperiments: async (tenantId) =>
          await run(tenantId, async (transaction) =>
            (
              await transaction.experiment.findMany({
                where: { tenantId },
                include: { variants: { include: { promptVersion: true } } },
                orderBy: { createdAt: "desc" },
              })
            ).map(mapExperiment),
          ),

        readExperiment: async (tenantId, experimentId) =>
          await run(tenantId, async (transaction) => {
            const row = await transaction.experiment.findFirst({
              where: { id: experimentId, tenantId },
              include: { variants: { include: { promptVersion: true } } },
            });
            return row === null ? null : mapExperiment(row);
          }),

        createExperiment: async (input) =>
          await run(input.tenantId, async (transaction) => {
            const prompts = await transaction.promptVersion.findMany({
              where: {
                tenantId: input.tenantId,
                id: { in: input.variants.map((variant) => variant.promptVersionId) },
              },
              select: { id: true },
            });
            if (prompts.length !== input.variants.length) {
              return { status: "unknown-prompt" as const };
            }
            const experiment = await transaction.experiment.create({
              data: {
                tenantId: input.tenantId,
                key: `${input.action}-${now().getTime().toString(36)}`,
                action: ACTION_TO_STORED[input.action],
                status: "DRAFT",
              },
            });
            await transaction.experimentVariant.createMany({
              data: input.variants.map((variant, index) => ({
                tenantId: input.tenantId,
                experimentId: experiment.id,
                promptVersionId: variant.promptVersionId,
                key: String.fromCharCode(65 + index),
                weightBasisPoints: variant.weightPct * 100,
              })),
            });
            return { status: "created" as const };
          }),

        setExperimentStatus: async (input) => {
          await run(input.tenantId, async (transaction) => {
            await transaction.experiment.updateMany({
              where: { id: input.experimentId, tenantId: input.tenantId },
              data:
                input.status === "running"
                  ? { status: "RUNNING", startedAt: now() }
                  : { status: "STOPPED", stoppedAt: now() },
            });
          });
        },

        listPlatformTenants: async () =>
          await run(null, async (transaction) => {
            const tenants = await transaction.tenant.findMany({
              orderBy: { name: "asc" },
              include: { _count: { select: { locations: true } } },
            });
            const monthStart = new Date(now());
            monthStart.setUTCDate(1);
            monthStart.setUTCHours(0, 0, 0, 0);
            const spend = await transaction.budgetReservation.groupBy({
              by: ["tenantId"],
              where: { settledAt: { gte: monthStart } },
              _sum: { actualCostMicros: true },
            });
            return tenants.map((tenant) => ({
              id: tenant.id,
              slug: tenant.slug,
              name: tenant.name,
              locale: asLocale(tenant.locale),
              category: tenant.category ?? "",
              locationCount: tenant._count.locations,
              plan: readString(tenant.businessProfile, "plan", "lite"),
              monthToDateSpend: money(
                Number(
                  spend.find((row) => row.tenantId === tenant.id)?._sum
                    .actualCostMicros ?? 0n,
                ),
              ),
              monthlyBudget: money(Number(tenant.monthlyBudgetMicros)),
              status:
                tenant.status === "ACTIVE"
                  ? ("active" as const)
                  : ("suspended" as const),
            }));
          }),

        createTenant: async (input) =>
          await run(null, async (transaction) => {
            const clash = await transaction.tenant.findUnique({
              where: { slug: input.slug },
              select: { id: true },
            });
            if (clash !== null) {
              return { status: "slug-taken" as const };
            }
            const platform = await transaction.platformSettings.findUnique({
              where: { id: "platform" },
            });
            // A new Tenant starts from the Platform policy template rather
            // than from a copy of some other Tenant's configuration.
            await transaction.tenant.create({
              data: {
                slug: input.slug,
                name: input.name,
                locale: input.locale,
                category: input.category,
                businessProfile: { plan: input.plan },
                policy: (isRecord(platform?.defaultPolicy)
                  ? platform.defaultPolicy
                  : {}) as Prisma.InputJsonValue,
              },
            });
            return { status: "created" as const };
          }),

        readPlatformProviders: async () =>
          await run(null, async (transaction) => {
            const providers = await transaction.provider.findMany({
              orderBy: { key: "asc" },
              include: {
                models: {
                  orderBy: { modelKey: "asc" },
                  include: { priceRates: { orderBy: { effectiveFrom: "desc" } } },
                },
              },
            });
            return {
              models: providers.flatMap((provider) =>
                provider.models.map((model) => ({
                  providerKey: provider.key,
                  providerName: provider.displayName,
                  modelKey: model.modelKey,
                  modelName: model.modelKey,
                  // Catalogue availability. Live latency-based health arrives
                  // with the execution-plane reader.
                  health:
                    provider.status === "ACTIVE" && model.status === "ACTIVE"
                      ? ("healthy" as const)
                      : ("unavailable" as const),
                  credentialState:
                    provider.credentialReference.trim().length > 0
                      ? ("configured" as const)
                      : ("missing" as const),
                  supportsStreaming: readBoolean(
                    model.capabilities,
                    "streaming",
                    false,
                  ),
                  supportsStructuredOutput: readBoolean(
                    model.capabilities,
                    "structuredOutput",
                    false,
                  ),
                  maxTokens: readNumber(model.capabilities, "maxTokens", 1),
                  routingPriority: model.routingPriority,
                  fallbackPriority: model.fallbackPriority,
                })),
              ),
              priceVersions: providers.flatMap((provider) =>
                provider.models.flatMap((model) =>
                  model.priceRates.map((rate) => ({
                    id: rate.id,
                    providerKey: provider.key,
                    modelKey: model.modelKey,
                    inputPerMillion: {
                      amountMicros: Number(rate.inputPerMillionMicros),
                      currency: rate.currency,
                    },
                    outputPerMillion: {
                      amountMicros: Number(rate.outputPerMillionMicros),
                      currency: rate.currency,
                    },
                    validFrom: iso(rate.effectiveFrom),
                    validTo: rate.effectiveTo === null ? null : iso(rate.effectiveTo),
                    superseded: rate.effectiveTo !== null,
                  })),
                ),
              ),
            };
          }),

        setProviderRouting: async (input) =>
          await run(null, async (transaction) => {
            const model = await transaction.providerModel.findFirst({
              where: {
                modelKey: input.modelKey,
                provider: { key: input.providerKey },
              },
              select: { id: true },
            });
            if (model === null) {
              return { status: "unknown-model" as const };
            }
            await transaction.providerModel.update({
              where: { id: model.id },
              data: {
                routingPriority: input.routingPriority,
                fallbackPriority: input.fallbackPriority,
              },
            });
            return { status: "saved" as const };
          }),

        publishPriceRate: async (input) =>
          await run(null, async (transaction) => {
            const model = await transaction.providerModel.findFirst({
              where: {
                modelKey: input.modelKey,
                provider: { key: input.providerKey },
              },
              select: { id: true },
            });
            if (model === null) {
              return { status: "not-later-than-current" as const };
            }
            const validFrom = new Date(input.validFrom);
            const latest = await transaction.priceRate.findFirst({
              where: { providerModelId: model.id },
              orderBy: { effectiveFrom: "desc" },
            });
            if (latest !== null && latest.effectiveFrom >= validFrom) {
              return { status: "not-later-than-current" as const };
            }
            // The superseded row is closed, never rewritten, so a historical
            // Provider Attempt still costs at the price that was active.
            if (latest !== null && latest.effectiveTo === null) {
              await transaction.priceRate.update({
                where: { id: latest.id },
                data: { effectiveTo: validFrom },
              });
            }
            await transaction.priceRate.create({
              data: {
                providerModelId: model.id,
                currency: input.currency,
                inputPerMillionMicros: BigInt(input.inputMicrosPerMillion),
                outputPerMillionMicros: BigInt(input.outputMicrosPerMillion),
                effectiveFrom: validFrom,
              },
            });
            return { status: "published" as const };
          }),

        listPlatformStyles: async () =>
          await run(null, async (transaction) =>
            (
              await transaction.reviewFormatVersion.findMany({
                orderBy: [{ formatKey: "asc" }, { version: "desc" }],
              })
            ).map((format) => ({
              id: format.id,
              key: format.formatKey,
              name: localized(format.localizedText, "en-GB") || format.formatKey,
              version: `${format.version}.0.0`,
              locale: (format.locale === "any"
                ? "any"
                : asLocale(format.locale)) as Locale | "any",
              targetPlatform: format.targetPlatform,
              maxChars: readNumber(format.constraints, "maxChars", 1),
              supportedActions: format.supportedActions.map(
                (action) => STORED_TO_ACTION[action as StoredAction],
              ),
              validationStatus: formatValidation(format),
              status:
                format.status === "ACTIVE"
                  ? ("active" as const)
                  : ("retired" as const),
            })),
          ),

        importPlatformStyle: async (input) =>
          await run(null, async (transaction) => {
            let manifest: unknown;
            try {
              manifest = JSON.parse(input.manifest);
            } catch {
              return { status: "invalid" as const };
            }
            if (!isRecord(manifest)) {
              return { status: "invalid" as const };
            }
            const key = readString(manifest, "key", "");
            const targetPlatform = readString(manifest, "targetPlatform", "");
            const actions = readStringArray(manifest, "supportedActions").filter(
              (action): action is ConsoleActionKey => action in ACTION_TO_STORED,
            );
            if (key === "" || targetPlatform === "" || actions.length === 0) {
              return { status: "invalid" as const };
            }
            const highest = await transaction.reviewFormatVersion.aggregate({
              where: { formatKey: key },
              _max: { version: true },
            });
            await transaction.reviewFormatVersion.create({
              data: {
                formatKey: key,
                version: (highest._max.version ?? 0) + 1,
                locale: readString(manifest, "locale", "any"),
                targetPlatform,
                constraints: (isRecord(manifest["constraints"])
                  ? manifest["constraints"]
                  : {}) as Prisma.InputJsonValue,
                localizedText: (isRecord(manifest["localizedText"])
                  ? manifest["localizedText"]
                  : { "en-GB": readString(manifest, "displayName", key) }) as Prisma.InputJsonValue,
                supportedActions: actions.map((action) => ACTION_TO_STORED[action]),
                contentHash: `console:${key}:${(highest._max.version ?? 0) + 1}`,
              },
            });
            return { status: "imported" as const };
          }),

        readPlatformSettings: async () =>
          await run(null, async (transaction) => {
            const [settings, flags] = await Promise.all([
              transaction.platformSettings.findUnique({
                where: { id: "platform" },
              }),
              transaction.featureFlag.findMany({ orderBy: { key: "asc" } }),
            ]);
            return {
              defaultPolicyTemplate: JSON.stringify(
                settings?.defaultPolicy ?? {},
                null,
                2,
              ),
              globalRateLimits: {
                perReviewSessionPerHour: readNumber(
                  settings?.rateLimits,
                  "perReviewSessionPerHour",
                  0,
                ),
                perTenantPerMinute: readNumber(
                  settings?.rateLimits,
                  "perTenantPerMinute",
                  0,
                ),
                maxConcurrentGenerations: readNumber(
                  settings?.rateLimits,
                  "maxConcurrentGenerations",
                  0,
                ),
              },
              logRetentionDays: settings?.logRetentionDays ?? 7,
              featureFlags: flags.map((flag) => ({
                key: flag.key,
                description: readString(flag.rules, "description", ""),
                enabled: flag.enabled,
              })),
            };
          }),

        savePlatformSettings: async (input) => {
          await run(null, async (transaction) => {
            let defaultPolicy: unknown;
            try {
              defaultPolicy = JSON.parse(input.defaultPolicyTemplate);
            } catch {
              defaultPolicy = {};
            }
            await transaction.platformSettings.upsert({
              where: { id: "platform" },
              create: {
                id: "platform",
                defaultPolicy: (isRecord(defaultPolicy)
                  ? defaultPolicy
                  : {}) as Prisma.InputJsonValue,
                rateLimits: { ...input.globalRateLimits },
                logRetentionDays: input.logRetentionDays,
              },
              update: {
                defaultPolicy: (isRecord(defaultPolicy)
                  ? defaultPolicy
                  : {}) as Prisma.InputJsonValue,
                rateLimits: { ...input.globalRateLimits },
                logRetentionDays: input.logRetentionDays,
              },
            });
            await Promise.all(
              input.featureFlags.map((flag) =>
                transaction.featureFlag.updateMany({
                  where: { key: flag.key },
                  data: { enabled: flag.enabled },
                }),
              ),
            );
          });
        },
      };

      /**
       * A scope this operator does not hold reads exactly like a scope that
       * holds nothing, so no Console screen can tell the two apart. Writes are
       * left to throw: reaching one means the Grants changed under a decision
       * the service had already made.
       */
      return {
        ...operations,
        readTenant: async (tenantId) =>
          await orEmpty(() => operations.readTenant(tenantId), null),
        readLocation: async (tenantId, locationId) =>
          await orEmpty(() => operations.readLocation(tenantId, locationId), null),
        readDistribution: async (tenantId, locationId, publicOrigin) =>
          await orEmpty(
            () => operations.readDistribution(tenantId, locationId, publicOrigin),
            null,
          ),
        readPrompt: async (tenantId, promptVersionId) =>
          await orEmpty(() => operations.readPrompt(tenantId, promptVersionId), null),
        readExperiment: async (tenantId, experimentId) =>
          await orEmpty(() => operations.readExperiment(tenantId, experimentId), null),
        listLocations: async (tenantId) =>
          await orEmpty(() => operations.listLocations(tenantId), []),
        listDestinations: async (tenantId, locationId) =>
          await orEmpty(() => operations.listDestinations(tenantId, locationId), []),
        listContextVersions: async (tenantId) =>
          await orEmpty(() => operations.listContextVersions(tenantId), []),
        listKeywords: async (tenantId, locationId) =>
          await orEmpty(() => operations.listKeywords(tenantId, locationId), []),
        listStyles: async (tenantId) =>
          await orEmpty(() => operations.listStyles(tenantId), []),
        listActions: async (tenantId) =>
          await orEmpty(() => operations.listActions(tenantId), []),
        listPrompts: async (tenantId, action) =>
          await orEmpty(() => operations.listPrompts(tenantId, action), []),
        listExperiments: async (tenantId) =>
          await orEmpty(() => operations.listExperiments(tenantId), []),
        listPlatformTenants: async () =>
          await orEmpty(() => operations.listPlatformTenants(), []),
        listPlatformStyles: async () =>
          await orEmpty(() => operations.listPlatformStyles(), []),
      };
    },
  };
}

function mapPrompt(row: {
  id: string;
  action: string;
  version: number;
  contentHash: string;
  status: string;
  createdAt: Date;
  createdBy: string | null;
  evaluationScore: { toNumber(): number } | null;
  body: string;
}): PromptRecord {
  return {
    id: row.id,
    action: STORED_TO_ACTION[row.action as StoredAction],
    version: row.version,
    hash: row.contentHash,
    status:
      STORED_TO_PROMPT_STATUS[
        row.status as keyof typeof STORED_TO_PROMPT_STATUS
      ],
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    evaluationScore:
      row.evaluationScore === null ? null : row.evaluationScore.toNumber(),
    body: row.body,
    variables: [],
  };
}

function mapExperiment(row: {
  id: string;
  action: string;
  status: string;
  createdAt: Date;
  startedAt: Date | null;
  stoppedAt: Date | null;
  variants: {
    promptVersionId: string;
    weightBasisPoints: number;
    promptVersion: { contentHash: string };
  }[];
}): ExperimentRecord {
  return {
    id: row.id,
    action: STORED_TO_ACTION[row.action as StoredAction],
    status:
      row.status === "RUNNING"
        ? "running"
        : row.status === "STOPPED"
          ? "stopped"
          : "draft",
    createdAt: iso(row.createdAt),
    startedAt: row.startedAt === null ? null : iso(row.startedAt),
    stoppedAt: row.stoppedAt === null ? null : iso(row.stoppedAt),
    variants: row.variants.map((variant) => ({
      promptVersionId: variant.promptVersionId,
      promptVersionHash: variant.promptVersion.contentHash,
      weightPct: Math.round(variant.weightBasisPoints / 100),
      // Outcome counts belong to the execution plane.
      generations: 0,
      accepted: 0,
    })),
    metricsAvailable: false,
  };
}
