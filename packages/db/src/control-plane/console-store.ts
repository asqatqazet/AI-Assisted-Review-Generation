import {
  buildConfigSnapshot,
  deriveConfigSnapshotId,
  type CommandKind,
  type EffectiveSettings,
  type PersistedConfigSnapshotDocument,
} from "@review/domain/configuration";
import {
  isExecutableGenerationAction,
  resolveExecutableGenerationActions,
} from "@review/domain/generation";
import {
  canQualifyPromptVersionAsCandidate,
  canPromoteToExperiment,
  derivePromptVersionHash,
  validateExperiment,
  type EvaluationResult,
  type PromptVersionRecord as DomainPromptVersionRecord,
} from "@review/domain/experiment";
import { randomUUID } from "node:crypto";

import { PrismaClient, type Prisma } from "../generated/control-plane/index.js";
import { strictZeroPromptContentPolicy } from "../deployment/prompt-release-content-policy.js";

import { createConsoleOperatorAuthorizationProof } from "./console-database-authority.js";

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

class ConfigurationPublicationIncompleteError extends Error {
  public constructor(public readonly missing: readonly string[]) {
    super(`Configuration publication is incomplete: ${missing.join(", ")}`);
    this.name = "ConfigurationPublicationIncompleteError";
  }
}

class ConfigurationPublicationConflictError extends Error {
  public constructor() {
    super("Configuration Draft changed during publication.");
    this.name = "ConfigurationPublicationConflictError";
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

type Locale = "en-GB" | "de-DE";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConfigurationChanges(value: unknown): ConfigurationChange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowedSettingKeys = new Set<TenantSettingConfigurationChange["key"]>([
    "locale",
    "toneGuidelines",
    "entryMode",
    "requireVerifiedExperience",
    "requireDisclosure",
    "maxReviewFormatsPerRequest",
    "bannedTerms",
    "monthlyBudgetMicros",
    "alertThresholdPct",
  ]);
  const actionKeys = new Set<ConsoleActionKey>(Object.keys(ACTION_TO_STORED) as ConsoleActionKey[]);
  const stringArray = (candidate: unknown): candidate is string[] =>
    Array.isArray(candidate) &&
    candidate.every((entry) => typeof entry === "string");
  return value.filter((candidate): candidate is ConfigurationChange => {
    if (!isRecord(candidate)) {
      return false;
    }
    if (
      typeof candidate["key"] === "string" &&
      allowedSettingKeys.has(
        candidate["key"] as TenantSettingConfigurationChange["key"],
      ) &&
      Object.hasOwn(candidate, "value")
    ) {
      return true;
    }
    switch (candidate["operation"]) {
      case "set-location-override":
        return (
          isRecord(candidate["change"]) &&
          typeof candidate["change"]["key"] === "string" &&
          Object.hasOwn(candidate["change"], "value")
        );
      case "reset-location-override":
        return typeof candidate["key"] === "string";
      case "create-fact-option":
        return (
          typeof candidate["mutationId"] === "string" &&
          typeof candidate["label"] === "string" &&
          typeof candidate["categoryKey"] === "string" &&
          ["positive", "neutral", "negative"].includes(
            String(candidate["polarity"]),
          ) &&
          ["tenant", "location"].includes(String(candidate["ownerScope"]))
        );
      case "update-fact-option":
        return (
          typeof candidate["keywordId"] === "string" &&
          typeof candidate["label"] === "string" &&
          ["positive", "neutral", "negative"].includes(
            String(candidate["polarity"]),
          ) &&
          typeof candidate["active"] === "boolean"
        );
      case "reorder-fact-options":
        return stringArray(candidate["orderedKeywordIds"]);
      case "delete-fact-option":
        return typeof candidate["keywordId"] === "string";
      case "set-review-format-enablement":
        return (
          typeof candidate["styleId"] === "string" &&
          typeof candidate["enabled"] === "boolean" &&
          stringArray(candidate["enabledActions"]) &&
          candidate["enabledActions"].every((action) =>
            actionKeys.has(action as ConsoleActionKey),
          )
        );
      case "reorder-review-formats":
        return stringArray(candidate["orderedStyleIds"]);
      case "set-action-enablement":
        return (
          typeof candidate["action"] === "string" &&
          actionKeys.has(candidate["action"] as ConsoleActionKey) &&
          typeof candidate["enabled"] === "boolean"
        );
      case "deploy-prompt-version":
        return (
          typeof candidate["action"] === "string" &&
          actionKeys.has(candidate["action"] as ConsoleActionKey) &&
          typeof candidate["promptVersionId"] === "string"
        );
      default:
        return false;
    }
  });
}

function configurationChangeIdentity(change: ConfigurationChange): string {
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
}

function readPlatformConfigurationChanges(
  value: unknown,
): PlatformConfigurationChange[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Platform Configuration Draft changes are invalid.");
  }
  const finiteInteger = (candidate: unknown, minimum = 0): candidate is number =>
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    Number.isInteger(candidate) &&
    candidate >= minimum;
  const identifier = (candidate: unknown): candidate is string =>
    typeof candidate === "string" && /^[A-Za-z0-9_-]+$/u.test(candidate);
  const parsed: PlatformConfigurationChange[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      throw new Error("Platform Configuration Draft contains an invalid change.");
    }
    switch (candidate["operation"]) {
      case "save-platform-settings": {
        const limits = candidate["globalRateLimits"];
        const flags = candidate["featureFlags"];
        if (
          typeof candidate["defaultPolicyTemplate"] !== "string" ||
          !isRecord(limits) ||
          !finiteInteger(limits["perReviewSessionPerHour"]) ||
          !finiteInteger(limits["perTenantPerMinute"]) ||
          !finiteInteger(limits["maxConcurrentGenerations"]) ||
          !finiteInteger(candidate["logRetentionDays"], 1) ||
          candidate["logRetentionDays"] > 3650 ||
          !Array.isArray(flags) ||
          !flags.every(
            (flag) =>
              isRecord(flag) &&
              identifier(flag["key"]) &&
              typeof flag["enabled"] === "boolean",
          )
        ) {
          throw new Error("Platform settings Draft change is invalid.");
        }
        parsed.push(candidate as unknown as PlatformConfigurationChange);
        break;
      }
      case "set-provider-routing":
        if (
          !identifier(candidate["providerKey"]) ||
          !identifier(candidate["modelKey"]) ||
          !(
            candidate["routingPriority"] === null ||
            finiteInteger(candidate["routingPriority"])
          ) ||
          !(
            candidate["fallbackPriority"] === null ||
            finiteInteger(candidate["fallbackPriority"])
          )
        ) {
          throw new Error("Provider routing Draft change is invalid.");
        }
        parsed.push(candidate as unknown as PlatformConfigurationChange);
        break;
      case "publish-price-rate":
        if (
          !identifier(candidate["providerKey"]) ||
          !identifier(candidate["modelKey"]) ||
          !finiteInteger(candidate["inputMicrosPerMillion"]) ||
          !finiteInteger(candidate["outputMicrosPerMillion"]) ||
          typeof candidate["currency"] !== "string" ||
          !/^[A-Z]{3}$/u.test(candidate["currency"]) ||
          typeof candidate["validFrom"] !== "string" ||
          !Number.isFinite(Date.parse(candidate["validFrom"]))
        ) {
          throw new Error("Price Rate Draft change is invalid.");
        }
        parsed.push(candidate as unknown as PlatformConfigurationChange);
        break;
      default:
        throw new Error("Platform Configuration Draft operation is unknown.");
    }
  }
  return parsed;
}

function platformConfigurationChangeIdentity(
  change: PlatformConfigurationChange,
): string {
  switch (change.operation) {
    case "save-platform-settings":
      return "platform-settings";
    case "set-provider-routing":
      return "provider-routing";
    case "publish-price-rate":
      return `price-rate:${change.providerKey}:${change.modelKey}:${change.validFrom}`;
  }
}

function platformConfigurationCapabilities(
  changes: readonly PlatformConfigurationChange[],
): readonly ("platform:admin" | "provider:manage")[] {
  const capabilities = new Set<"platform:admin" | "provider:manage">([
    "platform:admin",
  ]);
  if (changes.some((change) => change.operation !== "save-platform-settings")) {
    capabilities.add("provider:manage");
  }
  return [...capabilities];
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
  readonly consoleDatabaseAuthoritySecret: string;
  readonly currency?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface PostgresConsoleControlPlaneStore {
  forOperator(operatorId: string): ConsoleControlPlaneOperations;
  disconnect(): Promise<void>;
}

type SettingValue = string | number | boolean | string[];

const BASE_PLATFORM_DEFAULTS: EffectiveSettings = {
  locale: "en-GB",
  toneGuidelines: "Plain, factual, first person.",
  entryMode: "invite",
  requireDisclosure: true,
  requireVerifiedExperience: true,
  maxReviewFormatsPerRequest: 1,
  minimumFactSelections: 1,
  maximumCustomerAssertionChars: 500,
  bannedTerms: [],
  enabledReviewFormatVersionIds: [],
  enabledCommands: [],
  monthlyBudgetMicros: 0,
  alertThresholdPct: 80,
};

function readCompletePlatformDefaults(value: unknown): EffectiveSettings {
  const entryMode = readString(value, "entryMode", BASE_PLATFORM_DEFAULTS.entryMode);
  const enabledCommands = readStringArray(value, "enabledCommands").filter(
    (command): command is CommandKind =>
      [
        "generate",
        "paraphrase",
        "reformat",
        "condense",
        "expand",
        "revise-wording",
      ].includes(command),
  );
  return {
    locale: asLocale(readString(value, "locale", BASE_PLATFORM_DEFAULTS.locale)),
    toneGuidelines: readString(
      value,
      "toneGuidelines",
      BASE_PLATFORM_DEFAULTS.toneGuidelines,
    ),
    entryMode:
      entryMode === "open-qr" || entryMode === "both" ? entryMode : "invite",
    requireDisclosure: readBoolean(
      value,
      "requireDisclosure",
      BASE_PLATFORM_DEFAULTS.requireDisclosure,
    ),
    requireVerifiedExperience: readBoolean(
      value,
      "requireVerifiedExperience",
      BASE_PLATFORM_DEFAULTS.requireVerifiedExperience,
    ),
    maxReviewFormatsPerRequest: readNumber(
      value,
      "maxReviewFormatsPerRequest",
      BASE_PLATFORM_DEFAULTS.maxReviewFormatsPerRequest,
    ),
    minimumFactSelections: readNumber(
      value,
      "minimumFactSelections",
      BASE_PLATFORM_DEFAULTS.minimumFactSelections,
    ),
    maximumCustomerAssertionChars: readNumber(
      value,
      "maximumCustomerAssertionChars",
      BASE_PLATFORM_DEFAULTS.maximumCustomerAssertionChars,
    ),
    bannedTerms: readStringArray(value, "bannedTerms"),
    enabledReviewFormatVersionIds: readStringArray(
      value,
      "enabledReviewFormatVersionIds",
    ),
    enabledCommands,
    monthlyBudgetMicros: readNumber(
      value,
      "monthlyBudgetMicros",
      BASE_PLATFORM_DEFAULTS.monthlyBudgetMicros,
    ),
    alertThresholdPct: readNumber(
      value,
      "alertThresholdPct",
      BASE_PLATFORM_DEFAULTS.alertThresholdPct,
    ),
  };
}

function readSparseTenantSettings(value: unknown): Partial<EffectiveSettings> {
  if (!isRecord(value)) {
    return {};
  }
  const settings: Partial<EffectiveSettings> = {};
  const copy = <Key extends keyof EffectiveSettings>(
    key: Key,
    candidate: EffectiveSettings[Key] | undefined,
  ): void => {
    if (candidate !== undefined && Object.hasOwn(value, key)) {
      (settings as Record<Key, EffectiveSettings[Key]>)[key] = candidate;
    }
  };
  const locale = value["locale"];
  copy("locale", locale === "en-GB" || locale === "de-DE" ? locale : undefined);
  const tone = value["toneGuidelines"];
  copy("toneGuidelines", typeof tone === "string" ? tone : undefined);
  const entryMode = value["entryMode"];
  copy(
    "entryMode",
    entryMode === "invite" || entryMode === "open-qr" || entryMode === "both"
      ? entryMode
      : undefined,
  );
  for (const key of [
    "requireDisclosure",
    "requireVerifiedExperience",
  ] as const) {
    const candidate = value[key];
    copy(key, typeof candidate === "boolean" ? candidate : undefined);
  }
  for (const key of [
    "maxReviewFormatsPerRequest",
    "minimumFactSelections",
    "maximumCustomerAssertionChars",
    "monthlyBudgetMicros",
    "alertThresholdPct",
  ] as const) {
    const candidate = value[key];
    copy(
      key,
      typeof candidate === "number" && Number.isFinite(candidate)
        ? candidate
        : undefined,
    );
  }
  const bannedTerms = value["bannedTerms"];
  copy(
    "bannedTerms",
    Array.isArray(bannedTerms) &&
      bannedTerms.every((candidate) => typeof candidate === "string")
      ? bannedTerms
      : undefined,
  );
  return settings;
}

function toSettingValueRecord(
  settings: Partial<EffectiveSettings>,
): Record<string, SettingValue> {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  ) as Record<string, SettingValue>;
}

type TenantSettingConfigurationChange =
  | { readonly key: "locale"; readonly value: Locale }
  | { readonly key: "toneGuidelines"; readonly value: string }
  | {
      readonly key: "entryMode";
      readonly value: "invite" | "open-qr" | "both";
    }
  | { readonly key: "requireVerifiedExperience"; readonly value: boolean }
  | { readonly key: "requireDisclosure"; readonly value: boolean }
  | { readonly key: "maxReviewFormatsPerRequest"; readonly value: number }
  | { readonly key: "bannedTerms"; readonly value: string[] }
  | { readonly key: "monthlyBudgetMicros"; readonly value: number }
  | { readonly key: "alertThresholdPct"; readonly value: number };

type LocationOverrideConfigurationChange =
  | {
      readonly key: "entryMode";
      readonly value: "invite" | "open-qr" | "both";
    }
  | { readonly key: "requireVerifiedExperience"; readonly value: boolean }
  | { readonly key: "requireDisclosure"; readonly value: boolean }
  | { readonly key: "maxReviewFormatsPerRequest"; readonly value: number }
  | { readonly key: "bannedTerms"; readonly value: string[] };

export type ConfigurationChange =
  | TenantSettingConfigurationChange
  | {
      readonly operation: "set-location-override";
      readonly change: LocationOverrideConfigurationChange;
    }
  | { readonly operation: "reset-location-override"; readonly key: string }
  | {
      readonly operation: "create-fact-option";
      readonly mutationId: string;
      readonly label: string;
      readonly categoryKey: string;
      readonly polarity: "positive" | "neutral" | "negative";
      readonly ownerScope: "tenant" | "location";
    }
  | {
      readonly operation: "update-fact-option";
      readonly keywordId: string;
      readonly label: string;
      readonly polarity: "positive" | "neutral" | "negative";
      readonly active: boolean;
    }
  | {
      readonly operation: "reorder-fact-options";
      readonly orderedKeywordIds: string[];
    }
  | { readonly operation: "delete-fact-option"; readonly keywordId: string }
  | {
      readonly operation: "set-review-format-enablement";
      readonly styleId: string;
      readonly enabled: boolean;
      readonly enabledActions: ConsoleActionKey[];
    }
  | {
      readonly operation: "reorder-review-formats";
      readonly orderedStyleIds: string[];
    }
  | {
      readonly operation: "set-action-enablement";
      readonly action: ConsoleActionKey;
      readonly enabled: boolean;
    }
  | {
      readonly operation: "deploy-prompt-version";
      readonly action: ConsoleActionKey;
      readonly promptVersionId: string;
    };

export type PlatformConfigurationChange =
  | {
      readonly operation: "save-platform-settings";
      readonly defaultPolicyTemplate: string;
      readonly globalRateLimits: {
        readonly perReviewSessionPerHour: number;
        readonly perTenantPerMinute: number;
        readonly maxConcurrentGenerations: number;
      };
      readonly logRetentionDays: number;
      readonly featureFlags: {
        readonly key: string;
        readonly enabled: boolean;
      }[];
    }
  | {
      readonly operation: "set-provider-routing";
      readonly providerKey: string;
      readonly modelKey: string;
      readonly routingPriority: number | null;
      readonly fallbackPriority: number | null;
    }
  | {
      readonly operation: "publish-price-rate";
      readonly providerKey: string;
      readonly modelKey: string;
      readonly inputMicrosPerMillion: number;
      readonly outputMicrosPerMillion: number;
      readonly currency: string;
      readonly validFrom: string;
    };

export interface ConsoleControlPlaneOperations {
  readTenant(tenantId: string): Promise<TenantRecord | null>;
  listSelectableTenants(): Promise<SelectableTenantRecord[]>;
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
  readConfigurationState(input: {
    readonly tenantId: string;
    readonly locationId: string | null;
  }): Promise<{
    readonly revision: string;
    readonly draft: {
      readonly id: string;
      readonly revision: string;
      readonly baseRevision: string;
      readonly changes: readonly ConfigurationChange[];
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
    readonly changes: readonly ConfigurationChange[];
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
  }): Promise<
    { readonly status: "cancelled" } | { readonly status: "conflict" }
  >;
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
  stageConfigurationRelease(input: {
    readonly tenantId: string;
    readonly configurationReleaseId: string;
    readonly snapshotIds: readonly string[];
    readonly actorId: string;
  }): Promise<void>;
  readPlatformConfigurationState(): Promise<{
    readonly revision: string;
    readonly draft: {
      readonly id: string;
      readonly revision: string;
      readonly baseRevision: string;
      readonly changes: readonly PlatformConfigurationChange[];
    } | null;
  }>;
  savePlatformConfigurationDraft(input: {
    readonly expectedRevision: string;
    readonly expectedDraft: {
      readonly id: string;
      readonly revision: string;
    } | null;
    readonly changes: readonly PlatformConfigurationChange[];
    readonly actorId: string;
  }): Promise<{ readonly status: "saved" } | { readonly status: "conflict" }>;
  cancelPlatformConfigurationDraft(input: {
    readonly expectedRevision: string;
    readonly expectedDraft: {
      readonly id: string;
      readonly revision: string;
    } | null;
  }): Promise<
    { readonly status: "cancelled" } | { readonly status: "conflict" }
  >;
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
  readPublishedConfigurationSnapshot(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly configurationReleaseId?: string | undefined;
  }): Promise<{
    readonly snapshotId: string;
    readonly contentHash: string;
    readonly payload: unknown;
  } | null>;
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
    | { status: "candidate" }
    | { status: "unknown-prompt" }
    | { status: "quality-gate-rejected" }
  >;
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
  }): Promise<
    | { status: "created" }
    | { status: "unknown-prompt" }
    | { status: "invalid-variants" }
  >;
  setExperimentStatus(input: {
    readonly tenantId: string;
    readonly experimentId: string;
    readonly status: "running" | "stopped";
  }): Promise<
    | { status: "changed" }
    | { status: "unknown-experiment" }
    | { status: "invalid-transition" }
    | { status: "action-already-running" }
    | { status: "quality-gate-rejected" }
  >;
  listPlatformTenants(): Promise<PlatformTenantRecord[]>;
  setTenantStatus(input: {
    readonly tenantId: string;
    readonly status: "active" | "suspended" | "deactivated";
  }): Promise<{ status: "saved" } | { status: "not-found" }>;
  createKeywordCategory(input: {
    readonly tenantId: string;
    readonly key: string;
    readonly label: string;
  }): Promise<{ status: "created" } | { status: "key-taken" }>;
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
  }): Promise<
    | { status: "saved" }
    | { status: "unknown-model" }
    | { status: "invalid-routing" }
  >;
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

export interface SelectableTenantRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly locations: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly active: boolean;
  }[];
}

export interface TenantRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly locale: Locale;
  readonly platformDefaults: Record<string, SettingValue>;
  readonly tenantValues: Record<string, SettingValue>;
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
  readonly status: "active" | "suspended" | "deactivated";
  readonly suspendable: boolean;
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

const COMMAND_KIND_BY_ACTION: Readonly<Record<StoredAction, CommandKind>> = {
  GENERATE: "generate",
  PARAPHRASE: "paraphrase",
  REGENERATE: "generate",
  REFORMAT: "reformat",
  CONDENSE: "condense",
  EXPAND: "expand",
  REVISE_WORDING: "revise-wording",
  ADD_FACT: "generate",
};

const promptConsoleRelations = {
  deployments: { select: { id: true } },
  evaluations: {
    select: {
      id: true,
      promptVersionHash: true,
      reportHash: true,
      evaluatedCases: true,
      passedCases: true,
      evaluatorReleaseSha: true,
      suiteName: true,
      suiteManifestHash: true,
      reportDocument: true,
      reportCanonical: true,
      evaluatedAt: true,
      recordedAt: true,
    },
    orderBy: [
      { evaluatedAt: "desc" as const },
      { recordedAt: "desc" as const },
      { id: "desc" as const },
    ],
    take: 1,
  },
  candidacyDecisions: {
    select: {
      decision: true,
      evaluationResultId: true,
      decidedAt: true,
    },
    orderBy: [
      { decidedAt: "desc" as const },
      { id: "desc" as const },
    ],
  },
  experimentVariants: {
    select: { experiment: { select: { status: true } } },
  },
} satisfies Prisma.PromptVersionInclude;

type PromptWithConsoleRelations = Prisma.PromptVersionGetPayload<{
  include: typeof promptConsoleRelations;
}>;

function latestEvaluation(
  row: PromptWithConsoleRelations,
): EvaluationResult | null {
  const evaluation = row.evaluations[0];
  if (
    evaluation === undefined ||
    evaluation.evaluatedCases <= 0 ||
    evaluation.evaluatorReleaseSha === null ||
    !/^[0-9a-f]{40}$/u.test(evaluation.evaluatorReleaseSha) ||
    /^0{40}$/u.test(evaluation.evaluatorReleaseSha) ||
    evaluation.suiteName === null ||
    evaluation.suiteName.trim() === "" ||
    evaluation.suiteManifestHash === null ||
    !/^sha256:[0-9a-f]{64}$/u.test(evaluation.suiteManifestHash) ||
    evaluation.reportDocument === null ||
    evaluation.reportCanonical === null ||
    evaluation.reportCanonical === "" ||
    !/^sha256:[0-9a-f]{64}$/u.test(evaluation.reportHash)
  ) {
    return null;
  }
  return {
    evaluatedCases: evaluation.evaluatedCases,
    passRate: evaluation.passedCases / evaluation.evaluatedCases,
  };
}

function promptLifecycleStatus(
  row: PromptWithConsoleRelations,
): DomainPromptVersionRecord["status"] {
  if (
    row.status === "RETIRED" ||
    row.retiredAt !== null ||
    row.candidacyDecisions.some((decision) => decision.decision === "RETIRED")
  ) {
    return "retired";
  }
  if (
    row.experimentVariants.some(
      (variant) => variant.experiment.status === "RUNNING",
    )
  ) {
    return "in-experiment";
  }
  return row.candidacyDecisions.some(
    (decision) => decision.decision === "CANDIDATE",
  )
    ? "candidate"
    : "draft";
}

function asDomainPromptVersion(
  row: PromptWithConsoleRelations,
): DomainPromptVersionRecord {
  return {
    key: row.promptKey,
    commandKind: COMMAND_KIND_BY_ACTION[row.action as StoredAction],
    body: row.body,
    variables: [...row.variables],
    hash: row.contentHash as `sha256:${string}`,
    status: promptLifecycleStatus(row),
  };
}

function promptPassesQualityGate(row: PromptWithConsoleRelations): boolean {
  if (
    row.status === "RETIRED" ||
    row.retiredAt !== null ||
    strictZeroPromptContentPolicy({
      tenantId: row.tenantId,
      promptVersionId: row.id,
      promptVersionHash: row.contentHash,
      action: row.action,
    }) === "rejected"
  ) {
    return false;
  }
  const evaluation = latestEvaluation(row);
  const evaluationRecord = row.evaluations[0];
  if (
    evaluation === null ||
    evaluationRecord === undefined ||
    !row.candidacyDecisions.some(
      (decision) =>
        decision.decision === "CANDIDATE" &&
        decision.evaluationResultId === evaluationRecord.id,
    )
  ) {
    return false;
  }
  try {
    return canPromoteToExperiment(asDomainPromptVersion(row), evaluation);
  } catch {
    return false;
  }
}

function mapFactOption(
  fact: {
    id: string;
    locationId: string | null;
    categoryId: string;
    version: number;
    label: unknown;
    category: { label: unknown };
    proposition: string;
    polarity: string;
    isActive: boolean;
    sortOrder: number;
  },
  tenantId: string,
  locale: Locale,
) {
  return {
    id: fact.id,
    version: `${fact.id}@${fact.version}`,
    owner:
      fact.locationId === null
        ? ({ scope: "tenant" as const, tenantId })
        : ({
            scope: "location" as const,
            tenantId,
            locationId: fact.locationId,
          }),
    categoryId: fact.categoryId,
    label: localized(fact.label, locale) || fact.proposition,
    categoryLabel: localized(fact.category.label, locale) || fact.categoryId,
    proposition: fact.proposition || localized(fact.label, locale),
    polarity: STORED_TO_POLARITY[
      fact.polarity as keyof typeof STORED_TO_POLARITY
    ],
    locale,
    active: fact.isActive,
    sortOrder: fact.sortOrder,
  };
}

function mapReviewFormat(
  format: {
    id: string;
    formatKey: string;
    version: number;
    targetPlatform: string;
    locale: string;
    constraints: unknown;
    localizedText: unknown;
    supportedActions: string[];
  },
  locale: Locale,
) {
  const text = isRecord(format.localizedText) ? format.localizedText : {};
  const pick = (key: string): Record<string, string> => {
    const value = text[key];
    return isRecord(value)
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  };
  return {
    id: format.id,
    key: format.formatKey,
    version: `${format.version}`,
    displayName: localized(text["displayName"], locale) || format.formatKey,
    targetPlatform: format.targetPlatform,
    locale: (format.locale === "any" ? "any" : asLocale(format.locale)) as
      | Locale
      | "any",
    description: pick("description"),
    sample: pick("sample"),
    constraints: {
      minChars: readNumber(format.constraints, "minChars", 0),
      maxChars: readNumber(format.constraints, "maxChars", 1),
      paragraphs: readNumber(format.constraints, "paragraphs", 1),
      emojiPolicy:
        readString(format.constraints, "emojiPolicy", "none") === "allowed"
          ? ("allowed" as const)
          : ("none" as const),
      secondPerson: readBoolean(format.constraints, "secondPerson", false),
    },
    supportedCommands: [
      ...new Set(
        format.supportedActions.map(
          (action) => COMMAND_KIND_BY_ACTION[action as StoredAction],
        ),
      ),
    ],
  };
}

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
  consoleDatabaseAuthoritySecret,
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
        requiredCapability: string,
      ): Promise<boolean> => {
        const rows = await transaction.$queryRaw<{ granted: boolean }[]>`
          SELECT (
            EXISTS (
              SELECT 1
              FROM tenant_access_grants AS access_grant
              JOIN operator_role_definitions AS role
                ON role.key = access_grant.role_key
              WHERE access_grant.operator_id = ${operatorId}::uuid
                AND access_grant.tenant_id = ${tenantId}::uuid
                AND access_grant.status = 'ACTIVE'
                AND access_grant.valid_from <= clock_timestamp()
                AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
                AND role.status = 'ACTIVE'
                AND ${requiredCapability} = ANY(role.capabilities)
            )
            OR EXISTS (
              SELECT 1
              FROM platform_access_grants AS platform_grant
              JOIN operator_role_definitions AS role
                ON role.key = platform_grant.role_key
              WHERE platform_grant.operator_id = ${operatorId}::uuid
                AND platform_grant.status = 'ACTIVE'
                AND platform_grant.valid_from <= clock_timestamp()
                AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
                AND role.status = 'ACTIVE'
                AND ${requiredCapability} = ANY(role.capabilities)
            )
          ) AS granted
        `;
        return rows[0]?.granted === true;
      };

      const grantedForPlatform = async (
        transaction: Transaction,
        requiredCapability: string,
      ): Promise<boolean> => {
        const rows = await transaction.$queryRaw<{ granted: boolean }[]>`
          SELECT EXISTS (
            SELECT 1
            FROM platform_access_grants AS platform_grant
            JOIN operator_role_definitions AS role
              ON role.key = platform_grant.role_key
            WHERE platform_grant.operator_id = ${operatorId}::uuid
              AND platform_grant.status = 'ACTIVE'
              AND platform_grant.valid_from <= clock_timestamp()
              AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
              AND role.status = 'ACTIVE'
              AND ${requiredCapability} = ANY(role.capabilities)
          ) AS granted
        `;
        return rows[0]?.granted === true;
      };

      const run = async <T>(
        tenantId: string | null,
        work: (transaction: Transaction) => Promise<T>,
        requiredCapability = tenantId === null
          ? "platform:admin"
          : "console:read",
      ): Promise<T> =>
        await client.$transaction(async (transaction) => {
          const proof = createConsoleOperatorAuthorizationProof({
            secretHex: consoleDatabaseAuthoritySecret,
            operatorId,
          });
          const bindings = await transaction.$queryRaw<{ bound: boolean }[]>`
            SELECT console_bind_operator_authorization(
              ${operatorId}::uuid,
              ${proof.issuedAtMs}::bigint,
              ${proof.nonce}::uuid,
              ${proof.mac}
            ) AS bound
          `;
          if (bindings[0]?.bound !== true) {
            throw new ConsoleScopeDeniedError("Operator authority");
          }
          if (tenantId === null) {
            if (!(await grantedForPlatform(transaction, requiredCapability))) {
              throw new ConsoleScopeDeniedError("Platform scope");
            }
            return await work(transaction);
          }
          if (!(await grantedForTenant(transaction, tenantId, requiredCapability))) {
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
        const [tenant, platform] = await Promise.all([
          transaction.tenant.findUnique({
            where: { id: tenantId },
            include: {
              factOptionCategories: { orderBy: { sortOrder: "asc" } },
            },
          }),
          transaction.platformSettings.findUnique({
            where: { id: "platform" },
            select: { defaultPolicy: true },
          }),
        ]);
        if (tenant === null) {
          return null;
        }
        const platformDefaults = readCompletePlatformDefaults(
          platform?.defaultPolicy,
        );
        const tenantValues = readSparseTenantSettings(
          tenant.configurationValues,
        );
        const settings = { ...platformDefaults, ...tenantValues };
        const locale = settings.locale;
        return {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          locale,
          platformDefaults: toSettingValueRecord(platformDefaults),
          tenantValues: toSettingValueRecord(tenantValues),
          settings: toSettingValueRecord(settings),
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

      const applyStagedCatalogueChanges = async (
        transaction: Transaction,
        input: {
          readonly tenantId: string;
          readonly locationId: string | null;
          readonly locale: Locale;
          readonly actorId: string;
          readonly changes: readonly ConfigurationChange[];
        },
      ): Promise<void> => {
        for (const change of input.changes) {
          if (!("operation" in change)) {
            if (input.locationId !== null) {
              throw new ConfigurationPublicationIncompleteError([
                "Tenant settings staged in the Tenant Draft",
              ]);
            }
            continue;
          }
          switch (change.operation) {
            case "set-location-override":
            case "reset-location-override":
              if (input.locationId === null) {
                throw new ConfigurationPublicationIncompleteError([
                  "Location overrides staged in a Location Draft",
                ]);
              }
              break;

            case "create-fact-option": {
              if (
                (change.ownerScope === "location") !==
                (input.locationId !== null)
              ) {
                throw new ConfigurationPublicationIncompleteError([
                  "a Fact Option owned by this Draft scope",
                ]);
              }
              const category =
                await transaction.factOptionCategory.findFirst({
                  where: {
                    tenantId: input.tenantId,
                    key: change.categoryKey,
                  },
                });
              if (category === null) {
                throw new ConfigurationPublicationIncompleteError([
                  `Fact Option category ${change.categoryKey}`,
                ]);
              }
              const base = slugify(change.label);
              const taken = await transaction.factOptionVersion.findMany({
                where: {
                  tenantId: input.tenantId,
                  factOptionKey: { startsWith: base },
                },
                select: { factOptionKey: true },
              });
              const keys = new Set(taken.map((row) => row.factOptionKey));
              let factOptionKey = base;
              for (let suffix = 2; keys.has(factOptionKey); suffix += 1) {
                factOptionKey = `${base}-${suffix}`;
              }
              const highest = await transaction.factOptionVersion.aggregate({
                where: {
                  tenantId: input.tenantId,
                  locationId: input.locationId,
                },
                _max: { sortOrder: true },
              });
              await transaction.factOptionVersion.create({
                data: {
                  tenantId: input.tenantId,
                  locationId: input.locationId,
                  categoryId: category.id,
                  factOptionKey,
                  version: 1,
                  ownerScope:
                    input.locationId === null ? "TENANT" : "LOCATION",
                  label: { [input.locale]: change.label },
                  proposition: change.label,
                  polarity: POLARITY_TO_STORED[change.polarity],
                  sortOrder: (highest._max.sortOrder ?? -1) + 1,
                  isActive: true,
                },
              });
              break;
            }

            case "update-fact-option": {
              const current = await transaction.factOptionVersion.findFirst({
                where: {
                  id: change.keywordId,
                  tenantId: input.tenantId,
                  locationId: input.locationId,
                  retiredAt: null,
                },
              });
              if (current === null) {
                throw new ConfigurationPublicationIncompleteError([
                  `Fact Option ${change.keywordId} in this Draft scope`,
                ]);
              }
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
                  label: { [input.locale]: change.label },
                  proposition: change.label,
                  polarity: POLARITY_TO_STORED[change.polarity],
                  sortOrder: current.sortOrder,
                  isActive: change.active,
                },
              });
              break;
            }

            case "reorder-fact-options": {
              const owned = await transaction.factOptionVersion.findMany({
                where: {
                  id: { in: [...change.orderedKeywordIds] },
                  tenantId: input.tenantId,
                  locationId: input.locationId,
                  retiredAt: null,
                },
                select: { id: true },
              });
              if (owned.length !== new Set(change.orderedKeywordIds).size) {
                throw new ConfigurationPublicationIncompleteError([
                  "only Fact Options owned by this Draft scope",
                ]);
              }
              await Promise.all(
                change.orderedKeywordIds.map((keywordId, index) =>
                  transaction.factOptionVersion.updateMany({
                    where: {
                      id: keywordId,
                      tenantId: input.tenantId,
                      locationId: input.locationId,
                      retiredAt: null,
                    },
                    data: { sortOrder: index },
                  }),
                ),
              );
              break;
            }

            case "delete-fact-option": {
              const deleted = await transaction.factOptionVersion.updateMany({
                where: {
                  id: change.keywordId,
                  tenantId: input.tenantId,
                  locationId: input.locationId,
                  retiredAt: null,
                },
                data: { retiredAt: now(), isActive: false },
              });
              if (deleted.count !== 1) {
                throw new ConfigurationPublicationIncompleteError([
                  `Fact Option ${change.keywordId} in this Draft scope`,
                ]);
              }
              break;
            }

            case "set-review-format-enablement": {
              if (input.locationId !== null) {
                throw new ConfigurationPublicationIncompleteError([
                  "Review Format changes staged in the Tenant Draft",
                ]);
              }
              const format =
                await transaction.reviewFormatVersion.findFirst({
                  where: { id: change.styleId, status: "ACTIVE" },
                });
              const allowedActions = change.enabledActions.map(
                (action) => ACTION_TO_STORED[action],
              );
              if (
                format === null ||
                (format.locale !== "any" && format.locale !== input.locale) ||
                allowedActions.some(
                  (action) => !format.supportedActions.includes(action),
                )
              ) {
                throw new ConfigurationPublicationIncompleteError([
                  `a compatible Review Format ${change.styleId}`,
                ]);
              }
              await transaction.reviewFormatEnablement.upsert({
                where: {
                  tenantId_reviewFormatVersionId: {
                    tenantId: input.tenantId,
                    reviewFormatVersionId: change.styleId,
                  },
                },
                create: {
                  tenantId: input.tenantId,
                  reviewFormatVersionId: change.styleId,
                  enabled: change.enabled,
                  allowedActions,
                },
                update: { enabled: change.enabled, allowedActions },
              });
              break;
            }

            case "reorder-review-formats":
              if (input.locationId !== null) {
                throw new ConfigurationPublicationIncompleteError([
                  "Review Format order staged in the Tenant Draft",
                ]);
              }
              await Promise.all(
                change.orderedStyleIds.map((styleId, index) =>
                  transaction.reviewFormatEnablement.updateMany({
                    where: {
                      tenantId: input.tenantId,
                      reviewFormatVersionId: styleId,
                    },
                    data: { sortOrder: index },
                  }),
                ),
              );
              break;

            case "set-action-enablement":
              if (input.locationId !== null) {
                throw new ConfigurationPublicationIncompleteError([
                  "Action changes staged in the Tenant Draft",
                ]);
              }
              await transaction.tenantActionEnablement.upsert({
                where: {
                  tenantId_action: {
                    tenantId: input.tenantId,
                    action: ACTION_TO_STORED[change.action],
                  },
                },
                create: {
                  tenantId: input.tenantId,
                  action: ACTION_TO_STORED[change.action],
                  enabled: change.enabled,
                },
                update: { enabled: change.enabled },
              });
              break;

            case "deploy-prompt-version": {
              if (input.locationId !== null) {
                throw new ConfigurationPublicationIncompleteError([
                  "Prompt deployment staged in the Tenant Draft",
                ]);
              }
              const prompt = await transaction.promptVersion.findFirst({
                where: {
                  id: change.promptVersionId,
                  tenantId: input.tenantId,
                  action: ACTION_TO_STORED[change.action],
                  retiredAt: null,
                },
                include: promptConsoleRelations,
              });
              if (prompt === null || !promptPassesQualityGate(prompt)) {
                throw new ConfigurationPublicationIncompleteError([
                  `a quality-gated Prompt Version ${change.promptVersionId}`,
                ]);
              }
              await transaction.promptDeployment.upsert({
                where: {
                  tenantId_action: {
                    tenantId: input.tenantId,
                    action: ACTION_TO_STORED[change.action],
                  },
                },
                create: {
                  tenantId: input.tenantId,
                  action: ACTION_TO_STORED[change.action],
                  promptVersionId: prompt.id,
                  deployedBy: input.actorId,
                },
                update: {
                  promptVersionId: prompt.id,
                  deployedBy: input.actorId,
                  deployedAt: now(),
                  revision: { increment: 1 },
                },
              });
              break;
            }
          }
        }
      };

      const materializePublishedConfiguration = async (
        transaction: Transaction,
        input: { readonly tenantId: string; readonly locationId: string },
      ): Promise<
        | { readonly status: "published"; readonly snapshotId: string }
        | { readonly status: "incomplete"; readonly missing: string[] }
      > => {
        const [tenant, location, platform, platformConfigurationState] = await Promise.all([
          transaction.tenant.findFirst({
            where: { id: input.tenantId, status: "ACTIVE" },
          }),
          transaction.location.findFirst({
            where: {
              id: input.locationId,
              tenantId: input.tenantId,
              status: "ACTIVE",
              tenant: { status: "ACTIVE" },
            },
          }),
          transaction.platformSettings.findUnique({ where: { id: "platform" } }),
          transaction.platformConfigurationState.findUnique({
            where: { singleton: true },
          }),
        ]);
        if (tenant === null || location === null) {
          return { status: "incomplete", missing: ["the Location"] };
        }
        const platformDefaults = readCompletePlatformDefaults(
          platform?.defaultPolicy,
        );
        const tenantValues = readSparseTenantSettings(
          tenant.configurationValues,
        );
        const effectiveTenantSettings = {
          ...platformDefaults,
          ...tenantValues,
        };
        const locale = effectiveTenantSettings.locale;

        const publicationClockRows = await transaction.$queryRaw<
          { readonly publication_time: Date }[]
        >`SELECT clock_timestamp() AS publication_time`;
        const publicationTime = publicationClockRows[0]?.publication_time;
        if (publicationTime === undefined) {
          return { status: "incomplete", missing: ["the publication time"] };
        }

        const [
          formats,
          promptDeployments,
          actionEnablements,
          routedModels,
          factOptions,
        ] = await Promise.all([
          transaction.reviewFormatEnablement.findMany({
            where: { tenantId: input.tenantId, enabled: true },
            include: { reviewFormatVersion: true },
            orderBy: { sortOrder: "asc" },
          }),
          transaction.promptDeployment.findMany({
            where: { tenantId: input.tenantId },
            include: {
              promptVersion: { include: promptConsoleRelations },
            },
            orderBy: { action: "asc" },
          }),
          transaction.tenantActionEnablement.findMany({
            where: { tenantId: input.tenantId, enabled: true },
            orderBy: { sortOrder: "asc" },
          }),
          transaction.providerModel.findMany({
            where: { status: "ACTIVE", routingPriority: 1 },
            include: {
              provider: true,
              priceRates: {
                where: {
                  effectiveFrom: { lte: publicationTime },
                  OR: [
                    { effectiveTo: null },
                    { effectiveTo: { gt: publicationTime } },
                  ],
                },
                orderBy: { effectiveFrom: "desc" },
              },
            },
          }),
          liveFactOptions(transaction, input.tenantId, input.locationId),
        ]);

        const executableActionEnablements = actionEnablements.filter(
          (enablement) =>
            isExecutableGenerationAction(
              STORED_TO_ACTION[enablement.action as StoredAction],
            ),
        );
        const executablePromptDeployments = promptDeployments.filter(
          (deployment) =>
            isExecutableGenerationAction(
              STORED_TO_ACTION[deployment.action as StoredAction],
            ),
        );
        const executableActions = resolveExecutableGenerationActions({
          enabledActions: executableActionEnablements.map(
            (enablement) =>
              STORED_TO_ACTION[enablement.action as StoredAction],
          ),
          promptActions: executablePromptDeployments.map(
            (deployment) =>
              STORED_TO_ACTION[deployment.action as StoredAction],
          ),
          reviewFormats: formats
            .filter(
              (format) =>
                format.reviewFormatVersion.locale === "any" ||
                format.reviewFormatVersion.locale === locale,
            )
            .map((format) => ({
              supportedActions: format.allowedActions.map(
                (action) => STORED_TO_ACTION[action as StoredAction],
              ),
            })),
        });

        const missing: string[] = [];
        const ineligiblePromptActions = promptDeployments
          .filter(
            (deployment) =>
              !promptPassesQualityGate(deployment.promptVersion),
          )
          .map(
            (deployment) =>
              STORED_TO_ACTION[deployment.action as StoredAction],
          );
        if (ineligiblePromptActions.length > 0) {
          missing.push(
            ...ineligiblePromptActions.map(
              (action) =>
                `a currently eligible deployed Prompt Version for ${action}`,
            ),
          );
        }
        if (formats.length === 0) {
          missing.push("an enabled Review Format");
        }
        if (effectiveTenantSettings.toneGuidelines.trim() === "") {
          missing.push("non-empty tone guidelines");
        }
        if (executablePromptDeployments.length === 0) {
          missing.push("a published Prompt Version");
        }
        const actionsWithoutPrompt = executableActionEnablements.filter(
          (enablement) =>
            !executablePromptDeployments.some(
              (deployment) => deployment.action === enablement.action,
            ),
        );
        if (actionsWithoutPrompt.length > 0) {
          missing.push(
            `a published Prompt Version for ${actionsWithoutPrompt
              .map(
                (enablement) =>
                  STORED_TO_ACTION[enablement.action as StoredAction],
              )
              .join(", ")}`,
          );
        }
        if (routedModels.length !== 1) {
          missing.push("exactly one primary routed model");
        } else if (routedModels[0]!.priceRates.length !== 1) {
          missing.push("exactly one publication-effective Price Rate for the routed model");
        }
        if (executableActions.length === 0) {
          missing.push(
            "an executable Action with exactly one Prompt and a locale-compatible Review Format",
          );
        }
        if (missing.length > 0) {
          return { status: "incomplete", missing };
        }

        const routedModel = routedModels[0]!;
        const overrides = readOverrides(location.overrides);
        const tenantSettings: Partial<EffectiveSettings> = {
          ...tenantValues,
          enabledReviewFormatVersionIds: formats.map(
            (enablement) => enablement.reviewFormatVersionId,
          ),
          enabledCommands: [...executableActions],
        };

        const snapshot = buildConfigSnapshot({
          platform: {
            id: "platform",
            revision: String(
              platformConfigurationState?.publishedRevision ??
                platform?.configRevision ??
                1n,
            ),
            defaults: platformDefaults,
          },
          tenant: {
            id: tenant.id,
            revision: String(tenant.configRevision),
            settings: tenantSettings,
            factOptions: factOptions
              .filter((fact) => fact.locationId === null)
              .map((fact) => mapFactOption(fact, tenant.id, locale)),
          },
          location: {
            id: location.id,
            tenantId: tenant.id,
            revision: String(location.configRevision),
            overrides,
            factOptionAdditions: factOptions
              .filter((fact) => fact.locationId !== null)
              .map((fact) => mapFactOption(fact, tenant.id, locale)),
          },
          tenantName: tenant.name,
          locationName: location.name,
          reviewFormats: formats.map((enablement) => {
            const mapped = mapReviewFormat(
              enablement.reviewFormatVersion,
              locale,
            );
            const allowed = new Set(
              enablement.allowedActions.map(
                (action) => STORED_TO_ACTION[action as StoredAction],
              ),
            );
            return {
              ...mapped,
              supportedCommands: mapped.supportedCommands.filter(
                (command) =>
                  allowed.has(command) &&
                  isExecutableGenerationAction(command),
              ),
            };
          }),
          promptVersions: executablePromptDeployments.map(({ promptVersion: prompt }) => ({
            id: prompt.id,
            hash: prompt.contentHash,
            key: prompt.promptKey,
            commandKind: COMMAND_KIND_BY_ACTION[prompt.action as StoredAction],
            body: prompt.body,
            variables: [...prompt.variables],
          })),
          priceRates: routedModel.priceRates.map((rate) => ({
            id: rate.id,
            providerModelId: routedModel.id,
            provider: routedModel.provider.key,
            model: routedModel.modelKey,
            inputPerMillionMicros: Number(rate.inputPerMillionMicros),
            outputPerMillionMicros: Number(rate.outputPerMillionMicros),
            currency: rate.currency,
            unit: "token" as const,
            effectiveFrom: iso(rate.effectiveFrom),
            effectiveTo: rate.effectiveTo === null ? null : iso(rate.effectiveTo),
          })),
          providerRouting: {
            version: String(
              platformConfigurationState?.publishedRevision ??
                platform?.configRevision ??
                1n,
            ),
            providerModelId: routedModel.id,
            primaryProvider: routedModel.provider.key,
            primaryModel: routedModel.modelKey,
          },
        });

        const rowId = randomUUID();
        await transaction.effectiveConfigurationSnapshot.createMany({
          data: [
            {
            id: rowId,
            tenantId: tenant.id,
            locationId: location.id,
            schemaVersion: snapshot.schemaVersion,
            contentHash: snapshot.snapshotId,
            payload: {
              ...snapshot,
              snapshotId: rowId,
            } as unknown as Prisma.InputJsonValue,
            provenance: snapshot.provenance as unknown as Prisma.InputJsonValue,
            },
          ],
          skipDuplicates: true,
        });
        const persisted =
          await transaction.effectiveConfigurationSnapshot.findUnique({
            where: {
              tenantId_locationId_schemaVersion_contentHash: {
                tenantId: tenant.id,
                locationId: location.id,
                schemaVersion: snapshot.schemaVersion,
                contentHash: snapshot.snapshotId,
              },
            },
          });
        if (persisted === null) {
          throw new Error("CONFIGURATION_SNAPSHOT_INSERT_FAILED");
        }
        const persistedPayload = persisted.payload as unknown;
        if (
          !isRecord(persistedPayload) ||
          persistedPayload["snapshotId"] !== persisted.id ||
          deriveConfigSnapshotId(
            persistedPayload as unknown as PersistedConfigSnapshotDocument,
          ) !== snapshot.snapshotId
        ) {
          throw new Error("CONFIGURATION_SNAPSHOT_IDEMPOTENCY_CONFLICT");
        }
        return { status: "published", snapshotId: persisted.id };
      };

      const operations: ConsoleControlPlaneOperations = {
        readTenant: async (tenantId) =>
          await run(tenantId, (transaction) => loadTenant(transaction, tenantId)),

        listSelectableTenants: async () =>
          await run(null, async (transaction) => {
            const tenants = await transaction.tenant.findMany({
              orderBy: { name: "asc" },
              include: {
                locations: {
                  where: { status: "ACTIVE" },
                  orderBy: { name: "asc" },
                },
              },
            });
            return tenants.map((tenant) => ({
              id: tenant.id,
              slug: tenant.slug,
              name: tenant.name,
              locations: tenant.locations.map((location) => ({
                id: location.id,
                slug: location.slug,
                name: location.name,
                active: location.status === "ACTIVE",
              })),
            }));
          }),

        listLocations: async (tenantId) =>
          await run(tenantId, async (transaction) =>
            (
              await transaction.location.findMany({
                where: { tenantId, status: "ACTIVE" },
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
          }, "tenant:configure"),

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
              select: { policy: true, configurationValues: true },
            });
            if (tenant === null) {
              return;
            }
            const policy: Record<string, unknown> = isRecord(tenant.policy)
              ? { ...tenant.policy }
              : {};
            const configurationValues: Record<string, unknown> = isRecord(
              tenant.configurationValues,
            )
              ? { ...tenant.configurationValues }
              : {};
            const data: Prisma.TenantUpdateInput = {};
            for (const [key, value] of Object.entries(input.values)) {
              configurationValues[key] = value;
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
            data.configurationValues =
              configurationValues as Prisma.InputJsonValue;
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

        readConfigurationState: async (input) =>
          await run(input.tenantId, async (transaction) => {
            const scope =
              input.locationId === null
                ? await transaction.tenant.findUnique({
                    where: { id: input.tenantId },
                    select: { configRevision: true },
                  })
                : await transaction.location.findFirst({
                    where: {
                      id: input.locationId,
                      tenantId: input.tenantId,
                    },
                    select: { configRevision: true },
                  });
            if (scope === null) {
              return null;
            }
            const draft = await transaction.configurationDraft.findFirst({
              where: {
                tenantId: input.tenantId,
                locationId: input.locationId,
              },
              select: {
                id: true,
                revision: true,
                baseRevision: true,
                changes: true,
              },
            });
            return {
              revision: String(scope.configRevision),
              draft:
                draft === null
                  ? null
                  : {
                      id: draft.id,
                      revision: String(draft.revision),
                      baseRevision: String(draft.baseRevision),
                      changes: readConfigurationChanges(draft.changes),
                    },
            };
          }),

        saveConfigurationDraft: async (input) =>
          await run(
            input.tenantId,
            async (transaction) => {
              const rows =
                input.locationId === null
                  ? await transaction.$queryRaw<{ revision: bigint }[]>`
                      SELECT config_revision AS revision
                      FROM tenants
                      WHERE id = ${input.tenantId}::uuid
                      FOR UPDATE
                    `
                  : await transaction.$queryRaw<{ revision: bigint }[]>`
                      SELECT config_revision AS revision
                      FROM locations
                      WHERE id = ${input.locationId}::uuid
                        AND tenant_id = ${input.tenantId}::uuid
                      FOR UPDATE
                    `;
              const revision = rows[0]?.revision;
              if (
                revision === undefined ||
                String(revision) !== input.expectedRevision
              ) {
                return { status: "conflict" as const };
              }
              const existing = await transaction.configurationDraft.findFirst({
                where: {
                  tenantId: input.tenantId,
                  locationId: input.locationId,
                },
              });
              if (
                (existing === null && input.expectedDraft !== null) ||
                (existing !== null &&
                  (input.expectedDraft === null ||
                    input.expectedDraft.id !== existing.id ||
                    input.expectedDraft.revision !== String(existing.revision)))
              ) {
                return { status: "conflict" as const };
              }
              const merged = new Map(
                readConfigurationChanges(existing?.changes).map((change) => [
                  configurationChangeIdentity(change),
                  change,
                ]),
              );
              for (const change of input.changes) {
                merged.set(configurationChangeIdentity(change), change);
              }
              const changes = [...merged.values()] as unknown as Prisma.InputJsonValue;
              if (existing === null) {
                await transaction.configurationDraft.create({
                  data: {
                    tenantId: input.tenantId,
                    locationId: input.locationId,
                    baseRevision: revision,
                    changes,
                    createdBy: input.actorId,
                  },
                });
              } else {
                const updated = await transaction.configurationDraft.updateMany({
                  where: { id: existing.id, revision: existing.revision },
                  data: {
                    revision: { increment: 1 },
                    changes,
                  },
                });
                if (updated.count !== 1) {
                  return { status: "conflict" as const };
                }
              }
              return { status: "saved" as const };
            },
            "tenant:configure",
          ),

        cancelConfigurationDraft: async (input) =>
          await run(
            input.tenantId,
            async (transaction) => {
              const rows =
                input.locationId === null
                  ? await transaction.$queryRaw<{ revision: bigint }[]>`
                      SELECT config_revision AS revision FROM tenants
                      WHERE id = ${input.tenantId}::uuid FOR UPDATE
                    `
                  : await transaction.$queryRaw<{ revision: bigint }[]>`
                      SELECT config_revision AS revision FROM locations
                      WHERE id = ${input.locationId}::uuid
                        AND tenant_id = ${input.tenantId}::uuid FOR UPDATE
                    `;
              if (String(rows[0]?.revision) !== input.expectedRevision) {
                return { status: "conflict" as const };
              }
              if (input.expectedDraft === null) {
                return { status: "conflict" as const };
              }
              const deleted = await transaction.configurationDraft.deleteMany({
                where: {
                  tenantId: input.tenantId,
                  locationId: input.locationId,
                  id: input.expectedDraft.id,
                  revision: BigInt(input.expectedDraft.revision),
                },
              });
              return deleted.count === 1
                ? { status: "cancelled" as const }
                : { status: "conflict" as const };
            },
            "tenant:configure",
          ),

        publishConfiguration: async (input) => {
          try {
            return await run(
              input.tenantId,
              async (transaction) => {
                await transaction.$queryRaw`
                  SELECT public.console_lock_prompt_release_set(
                    ${input.tenantId}::uuid
                  )
                `;
                const rows =
                  input.locationId === null
                    ? await transaction.$queryRaw<{ revision: bigint }[]>`
                        SELECT config_revision AS revision FROM tenants
                        WHERE id = ${input.tenantId}::uuid
                          AND status = 'ACTIVE'
                        FOR UPDATE
                      `
                    : await transaction.$queryRaw<{ revision: bigint }[]>`
                        SELECT location.config_revision AS revision
                        FROM locations AS location
                        JOIN tenants AS tenant
                          ON tenant.id = location.tenant_id
                        WHERE location.id = ${input.locationId}::uuid
                          AND location.tenant_id = ${input.tenantId}::uuid
                          AND location.status = 'ACTIVE'
                          AND tenant.status = 'ACTIVE'
                        FOR UPDATE OF location
                      `;
                const revision = rows[0]?.revision;
                const expectedRevision = /^\d+$/u.test(input.expectedRevision)
                  ? BigInt(input.expectedRevision)
                  : null;
                if (
                  revision === undefined ||
                  String(revision) !== input.expectedRevision
                ) {
                  if (
                    revision !== undefined &&
                    expectedRevision !== null &&
                    revision === expectedRevision + 1n &&
                    input.expectedDraft !== null
                  ) {
                    const completed =
                      await transaction.configurationAuditEvent.findFirst({
                        where: {
                          tenantId: input.tenantId,
                          locationId: input.locationId,
                          revision,
                          draftId: input.expectedDraft.id,
                          draftRevision: BigInt(
                            input.expectedDraft.revision,
                          ),
                        },
                        select: {
                          snapshotIds: true,
                          configurationReleaseId: true,
                        },
                      });
                    if (
                      completed !== null &&
                      completed.configurationReleaseId !== null &&
                      (input.configurationReleaseId === undefined ||
                        input.configurationReleaseId ===
                          completed.configurationReleaseId)
                    ) {
                      return {
                        status: "published" as const,
                        snapshotIds: completed.snapshotIds,
                        configurationReleaseId:
                          completed.configurationReleaseId,
                      };
                    }
                  }
                  return { status: "conflict" as const };
                }

                const draft = await transaction.configurationDraft.findFirst({
                  where: {
                    tenantId: input.tenantId,
                    locationId: input.locationId,
                  },
                });
                if (draft === null) {
                  return { status: "no-draft" as const };
                }
                if (
                  input.expectedDraft === null ||
                  input.expectedDraft.id !== draft.id ||
                  input.expectedDraft.revision !== String(draft.revision) ||
                  draft.baseRevision !== revision
                ) {
                  return { status: "conflict" as const };
                }

                const changes = readConfigurationChanges(draft.changes);
                if (input.locationId === null) {
                  const tenant = await transaction.tenant.findUnique({
                    where: { id: input.tenantId },
                    select: { policy: true, configurationValues: true },
                  });
                  if (tenant === null) {
                    return { status: "conflict" as const };
                  }
                  const policy: Record<string, unknown> = isRecord(tenant.policy)
                    ? { ...tenant.policy }
                    : {};
                  const configurationValues: Record<string, unknown> = isRecord(
                    tenant.configurationValues,
                  )
                    ? { ...tenant.configurationValues }
                    : {};
                  const data: Prisma.TenantUncheckedUpdateManyInput = {
                    configRevision: { increment: 1 },
                  };
                  for (const change of changes) {
                    if ("operation" in change) {
                      continue;
                    }
                    configurationValues[change.key] = change.value;
                    switch (change.key) {
                      case "locale":
                        data.locale = change.value;
                        break;
                      case "toneGuidelines":
                        data.toneGuidelines = change.value;
                        break;
                      case "entryMode":
                        data.defaultEntryModeKey = change.value;
                        break;
                      case "bannedTerms":
                        data.bannedTerms = [...change.value];
                        break;
                      case "monthlyBudgetMicros":
                        data.monthlyBudgetMicros = BigInt(change.value);
                        break;
                      case "alertThresholdPct":
                        data.alertThresholdPercent = change.value;
                        break;
                      default:
                        policy[change.key] = change.value;
                        break;
                    }
                  }
                  data.policy = policy as Prisma.InputJsonValue;
                  data.configurationValues =
                    configurationValues as Prisma.InputJsonValue;
                  const platform =
                    await transaction.platformSettings.findUnique({
                      where: { id: "platform" },
                      select: { defaultPolicy: true },
                    });
                  const locale = (
                    readSparseTenantSettings(configurationValues).locale ??
                    readCompletePlatformDefaults(platform?.defaultPolicy).locale
                  );
                  await applyStagedCatalogueChanges(transaction, {
                    tenantId: input.tenantId,
                    locationId: null,
                    locale,
                    actorId: input.actorId,
                    changes,
                  });
                  const updated = await transaction.tenant.updateMany({
                    where: { id: input.tenantId, configRevision: revision },
                    data,
                  });
                  if (updated.count !== 1) {
                    return { status: "conflict" as const };
                  }
                } else {
                  const location = await transaction.location.findFirst({
                    where: {
                      id: input.locationId,
                      tenantId: input.tenantId,
                    },
                    select: { overrides: true },
                  });
                  if (location === null) {
                    return { status: "conflict" as const };
                  }
                  const overrides = readOverrides(location.overrides);
                  for (const change of changes) {
                    if (!("operation" in change)) {
                      throw new ConfigurationPublicationIncompleteError([
                        "Tenant settings staged in the Tenant Draft",
                      ]);
                    }
                    if (change.operation === "set-location-override") {
                      overrides[change.change.key] = change.change.value;
                    } else if (
                      change.operation === "reset-location-override"
                    ) {
                      delete overrides[change.key];
                    }
                  }
                  const [tenant, platform] = await Promise.all([
                    transaction.tenant.findUnique({
                      where: { id: input.tenantId },
                      select: { configurationValues: true },
                    }),
                    transaction.platformSettings.findUnique({
                      where: { id: "platform" },
                      select: { defaultPolicy: true },
                    }),
                  ]);
                  if (tenant === null) {
                    return { status: "conflict" as const };
                  }
                  const locale =
                    readSparseTenantSettings(tenant.configurationValues).locale ??
                    readCompletePlatformDefaults(platform?.defaultPolicy).locale;
                  await applyStagedCatalogueChanges(transaction, {
                    tenantId: input.tenantId,
                    locationId: input.locationId,
                    locale,
                    actorId: input.actorId,
                    changes,
                  });
                  const updated = await transaction.location.updateMany({
                    where: {
                      id: input.locationId,
                      tenantId: input.tenantId,
                      configRevision: revision,
                    },
                    data: {
                      overrides: overrides as Prisma.InputJsonValue,
                      configRevision: { increment: 1 },
                    },
                  });
                  if (updated.count !== 1) {
                    return { status: "conflict" as const };
                  }
                }

                const locations = await transaction.location.findMany({
                  where: {
                    tenantId: input.tenantId,
                    status: "ACTIVE",
                    tenant: { status: "ACTIVE" },
                    ...(input.locationId === null
                      ? {}
                      : { id: input.locationId }),
                  },
                  select: { id: true },
                  orderBy: { id: "asc" },
                });
                const snapshotIds: string[] = [];
                for (const location of locations) {
                  const materialized = await materializePublishedConfiguration(
                    transaction,
                    { tenantId: input.tenantId, locationId: location.id },
                  );
                  if (materialized.status === "incomplete") {
                    throw new ConfigurationPublicationIncompleteError(
                      materialized.missing,
                    );
                  }
                  snapshotIds.push(materialized.snapshotId);
                }
                const configurationReleaseId =
                  input.configurationReleaseId ?? randomUUID();
                await transaction.$queryRaw`
                  SELECT public.register_configuration_release(
                    ${configurationReleaseId}::uuid,
                    ${snapshotIds}::uuid[],
                    ${input.actorId}::uuid,
                    ${input.configurationReleaseId === undefined}
                  )
                `;

                await transaction.configurationAuditEvent.create({
                  data: {
                    tenantId: input.tenantId,
                    locationId: input.locationId,
                    revision: revision + 1n,
                    draftId: draft.id,
                    draftRevision: draft.revision,
                    changes: changes as unknown as Prisma.InputJsonValue,
                    snapshotIds,
                    configurationReleaseId,
                    actorId: input.actorId,
                  },
                });
                const deleted = await transaction.configurationDraft.deleteMany({
                  where: { id: draft.id, revision: draft.revision },
                });
                if (deleted.count !== 1) {
                  throw new ConfigurationPublicationConflictError();
                }
                return {
                  status: "published" as const,
                  snapshotIds,
                  configurationReleaseId,
                };
              },
              "tenant:configure",
            );
          } catch (error) {
            if (error instanceof ConfigurationPublicationIncompleteError) {
              return {
                status: "incomplete" as const,
                missing: [...error.missing],
              };
            }
            if (error instanceof ConfigurationPublicationConflictError) {
              return { status: "conflict" as const };
            }
            throw error;
          }
        },

        stageConfigurationRelease: async (input) => {
          if (input.actorId !== operatorId) {
            throw new Error("CONFIGURATION_RELEASE_ACTOR_MISMATCH");
          }
          await run(
            input.tenantId,
            async (transaction) => {
              await transaction.$queryRaw`
                SELECT public.register_configuration_release(
                  ${input.configurationReleaseId}::uuid,
                  ${[...input.snapshotIds]}::uuid[],
                  ${operatorId}::uuid,
                  false
                )
              `;
            },
            "tenant:configure",
          );
        },

        readPublishedConfigurationSnapshot: async (input) =>
          await orEmpty(
            () =>
              run(input.tenantId, async (transaction) => {
                const snapshots = await transaction.$queryRaw<
                  {
                    readonly id: string;
                    readonly content_hash: string;
                    readonly payload: unknown;
                  }[]
                >`
                  SELECT snapshot.id, snapshot.content_hash, snapshot.payload
                  FROM effective_configuration_snapshots AS snapshot
                  WHERE snapshot.tenant_id = ${input.tenantId}::uuid
                    AND snapshot.location_id = ${input.locationId}::uuid
                    AND snapshot.id = public.resolve_configuration_snapshot(
                      ${input.tenantId}::uuid,
                      ${input.locationId}::uuid,
                      ${input.configurationReleaseId ?? null}::uuid
                    )
                  LIMIT 1
                `;
                const snapshot = snapshots[0];
                return snapshot === null
                  ? null
                  : snapshot === undefined
                    ? null
                    : {
                      snapshotId: snapshot.id,
                      contentHash: snapshot.content_hash,
                      payload: snapshot.payload,
                    };
              }),
            null,
          ),

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
                isEntryAction: isExecutableGenerationAction(key),
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
          await run(
            tenantId,
            async (transaction) =>
              (
                await transaction.promptVersion.findMany({
                  where: {
                    tenantId,
                    ...(action === null
                      ? {}
                      : { action: ACTION_TO_STORED[action] }),
                  },
                  include: promptConsoleRelations,
                  orderBy: [{ action: "asc" }, { version: "desc" }],
                })
              ).map(mapPrompt),
            "ai:operate",
          ),

        readPrompt: async (tenantId, promptVersionId) =>
          await run(
            tenantId,
            async (transaction) => {
              const row = await transaction.promptVersion.findFirst({
                where: { id: promptVersionId, tenantId },
                include: promptConsoleRelations,
              });
              return row === null ? null : mapPrompt(row);
            },
            "ai:operate",
          ),

        createPromptVersion: async (input) => {
          const action = ACTION_TO_STORED[input.action];
          const canonicalHash = derivePromptVersionHash({
            key: input.key,
            commandKind: COMMAND_KIND_BY_ACTION[action],
            body: input.body,
            variables: input.variables,
          });
          if (input.hash !== canonicalHash) {
            throw new Error("PROMPT_VERSION_HASH_MISMATCH");
          }
          await run(
            input.tenantId,
            async (transaction) => {
              await transaction.promptVersion.createMany({
                data: [
                  {
                    tenantId: input.tenantId,
                    promptKey: input.key,
                    action,
                    contentHash: input.hash,
                    body: input.body,
                    variables: [...input.variables],
                    version: input.version,
                    status: "DRAFT",
                    createdBy: input.createdBy,
                  },
                ],
                skipDuplicates: true,
              });
              const persisted = await transaction.promptVersion.findFirst({
                where: {
                  tenantId: input.tenantId,
                  promptKey: input.key,
                  action,
                  contentHash: input.hash,
                },
              });
              if (
                persisted === null ||
                persisted.body !== input.body ||
                persisted.version !== input.version ||
                persisted.variables.length !== input.variables.length ||
                persisted.variables.some(
                  (variable, index) => variable !== input.variables[index],
                )
              ) {
                throw new Error("PROMPT_VERSION_IDEMPOTENCY_CONFLICT");
              }
            },
            "ai:operate",
          );
        },

        promotePromptVersion: async (input) =>
          await run(
            input.tenantId,
            async (transaction) => {
              const target = await transaction.promptVersion.findFirst({
                where: {
                  id: input.promptVersionId,
                  tenantId: input.tenantId,
                  retiredAt: null,
                },
                include: promptConsoleRelations,
              });
              if (target === null) {
                return { status: "unknown-prompt" as const };
              }
              if (
                strictZeroPromptContentPolicy({
                  tenantId: target.tenantId,
                  promptVersionId: target.id,
                  promptVersionHash: target.contentHash,
                  action: target.action,
                }) === "rejected"
              ) {
                return { status: "quality-gate-rejected" as const };
              }
              const evaluation = latestEvaluation(target);
              const evaluationRecord = target.evaluations[0];
              if (evaluation === null || evaluationRecord === undefined) {
                return { status: "quality-gate-rejected" as const };
              }
              const lifecycle = promptLifecycleStatus(target);
              try {
                const latestEvaluationAlreadyQualified =
                  target.candidacyDecisions.some(
                    (decision) =>
                      decision.decision === "CANDIDATE" &&
                      decision.evaluationResultId === evaluationRecord.id,
                  );
                if (
                  lifecycle === "draft" ||
                  (lifecycle === "candidate" &&
                    !latestEvaluationAlreadyQualified)
                ) {
                  if (lifecycle === "draft") {
                    canQualifyPromptVersionAsCandidate(
                      asDomainPromptVersion(target),
                      evaluation,
                    );
                  } else {
                    canPromoteToExperiment(
                      asDomainPromptVersion(target),
                      evaluation,
                    );
                  }
                  await transaction.promptCandidacyDecision.createMany({
                    data: [
                      {
                        tenantId: input.tenantId,
                        promptVersionId: target.id,
                        promptVersionHash: target.contentHash,
                        decision: "CANDIDATE",
                        evaluationResultId: evaluationRecord.id,
                        decidedBy: operatorId,
                        reason: "Passed the release-blocking grounding evaluation.",
                      },
                    ],
                    skipDuplicates: true,
                  });
                } else if (
                  lifecycle === "candidate" &&
                  latestEvaluationAlreadyQualified
                ) {
                  canPromoteToExperiment(asDomainPromptVersion(target), evaluation);
                } else {
                  return { status: "quality-gate-rejected" as const };
                }
              } catch {
                return { status: "quality-gate-rejected" as const };
              }
              return { status: "candidate" as const };
            },
            "ai:operate",
          ),

        listExperiments: async (tenantId) =>
          await run(
            tenantId,
            async (transaction) =>
              (
                await transaction.experiment.findMany({
                  where: { tenantId },
                  include: { variants: { include: { promptVersion: true } } },
                  orderBy: { createdAt: "desc" },
                })
              ).map(mapExperiment),
            "ai:operate",
          ),

        readExperiment: async (tenantId, experimentId) =>
          await run(
            tenantId,
            async (transaction) => {
              const row = await transaction.experiment.findFirst({
                where: { id: experimentId, tenantId },
                include: { variants: { include: { promptVersion: true } } },
              });
              return row === null ? null : mapExperiment(row);
            },
            "ai:operate",
          ),

        createExperiment: async (input) =>
          await run(
            input.tenantId,
            async (transaction) => {
              const promptIds = input.variants.map(
                (variant) => variant.promptVersionId,
              );
              if (new Set(promptIds).size !== promptIds.length) {
                return { status: "invalid-variants" as const };
              }
              const prompts = await transaction.promptVersion.findMany({
                where: {
                  tenantId: input.tenantId,
                  id: { in: promptIds },
                },
                include: promptConsoleRelations,
              });
              if (prompts.length !== input.variants.length) {
                return { status: "unknown-prompt" as const };
              }
              const storedAction = ACTION_TO_STORED[input.action];
              if (
                prompts.some(
                  (prompt) =>
                    prompt.action !== storedAction ||
                    !promptPassesQualityGate(prompt),
                )
              ) {
                return { status: "invalid-variants" as const };
              }
              try {
                validateExperiment({
                  id: "candidate",
                  tenantId: input.tenantId,
                  action: COMMAND_KIND_BY_ACTION[storedAction],
                  status: "draft",
                  variants: input.variants.map((variant, index) => ({
                    variantKey: String.fromCharCode(65 + index),
                    promptVersionHash:
                      prompts.find(
                        (prompt) => prompt.id === variant.promptVersionId,
                      )!.contentHash,
                    weightPct: variant.weightPct,
                  })),
                });
              } catch {
                return { status: "invalid-variants" as const };
              }
              const experiment = await transaction.experiment.create({
                data: {
                  tenantId: input.tenantId,
                  key: `${input.action}-${randomUUID()}`,
                  action: storedAction,
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
            },
            "ai:operate",
          ),

        setExperimentStatus: async (input) =>
          await run(
            input.tenantId,
            async (transaction) => {
              const scopedTarget = await transaction.experiment.findFirst({
                where: {
                  id: input.experimentId,
                  tenantId: input.tenantId,
                },
                select: { action: true },
              });
              if (scopedTarget === null) {
                return { status: "unknown-experiment" as const };
              }
              await transaction.$executeRaw`
                SELECT pg_advisory_xact_lock(
                  hashtextextended(
                    ${`${input.tenantId}:${scopedTarget.action}`},
                    0
                  )
                )
              `;
              const target = await transaction.experiment.findFirst({
                where: {
                  id: input.experimentId,
                  tenantId: input.tenantId,
                },
                include: {
                  variants: {
                    include: {
                      promptVersion: { include: promptConsoleRelations },
                    },
                  },
                },
              });
              if (target === null) {
                return { status: "unknown-experiment" as const };
              }
              if (input.status === "stopped") {
                if (target.status !== "RUNNING") {
                  return { status: "invalid-transition" as const };
                }
                await transaction.experiment.update({
                  where: { id: target.id },
                  data: { status: "STOPPED", stoppedAt: now() },
                });
                return { status: "changed" as const };
              }
              if (target.status === "RUNNING") {
                return { status: "action-already-running" as const };
              }
              if (target.status !== "DRAFT") {
                return { status: "invalid-transition" as const };
              }

              const running = await transaction.experiment.findFirst({
                where: {
                  tenantId: input.tenantId,
                  action: target.action,
                  status: "RUNNING",
                  id: { not: target.id },
                },
                select: { id: true },
              });
              if (running !== null) {
                return { status: "action-already-running" as const };
              }
              if (
                target.variants.length < 2 ||
                target.variants.some(
                  (variant) =>
                    variant.promptVersion.action !== target.action ||
                    !promptPassesQualityGate(variant.promptVersion),
                )
              ) {
                return { status: "quality-gate-rejected" as const };
              }
              try {
                validateExperiment({
                  id: target.id,
                  tenantId: target.tenantId,
                  action: COMMAND_KIND_BY_ACTION[target.action as StoredAction],
                  status: "draft",
                  variants: target.variants.map((variant) => ({
                    variantKey: variant.key,
                    promptVersionHash: variant.promptVersion.contentHash,
                    weightPct: variant.weightBasisPoints / 100,
                  })),
                });
              } catch {
                return { status: "quality-gate-rejected" as const };
              }
              await transaction.experiment.update({
                where: { id: target.id },
                data: { status: "RUNNING", startedAt: now(), stoppedAt: null },
              });
              return { status: "changed" as const };
            },
            "ai:operate",
          ),

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
                  : tenant.status === "SUSPENDED"
                    ? ("suspended" as const)
                    : ("deactivated" as const),
              // A deactivated account is not brought back from this screen.
              suspendable: tenant.status !== "DEACTIVATED",
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
            const tenant = await transaction.tenant.create({
              data: {
                slug: input.slug,
                name: input.name,
                locale: input.locale,
                category: input.category,
                businessProfile: { plan: input.plan },
                // Without an entry mode a venue admits nobody, and the Console
                // would still display a fallback value the column does not
                // hold. Open-QR is the only mode the Console can currently
                // make usable, since it cannot issue invitations yet.
                defaultEntryModeKey: "open-qr",
                configurationValues: {
                  locale: input.locale,
                  entryMode: "open-qr",
                },
                policy: (isRecord(platform?.defaultPolicy)
                  ? platform.defaultPolicy
                  : {}) as Prisma.InputJsonValue,
              },
            });

            /**
             * An account with no Actions, no Review Formats and no taxonomy is
             * provisioned but unusable: nothing can be configured and no
             * reviewer path exists. It therefore starts from the Platform
             * catalogue, which is the same data an operator would otherwise
             * have to reproduce by hand.
             */
            const [actions, formats] = await Promise.all([
              transaction.actionDefinition.findMany({
                where: { status: "ACTIVE" },
              }),
              transaction.reviewFormatVersion.findMany({
                where: {
                  status: "ACTIVE",
                  locale: { in: [input.locale, "any"] },
                },
                orderBy: [{ formatKey: "asc" }, { version: "desc" }],
              }),
            ]);

            if (actions.length > 0) {
              await transaction.tenantActionEnablement.createMany({
                data: actions.map((action, index) => ({
                  tenantId: tenant.id,
                  action: action.action,
                  enabled: isExecutableGenerationAction(
                    STORED_TO_ACTION[action.action as StoredAction],
                  ),
                  sortOrder: index,
                })),
              });
            }

            // Only the newest version of each Review Format, and only ones
            // this locale can serve.
            const newestByKey = new Map<string, (typeof formats)[number]>();
            for (const format of formats) {
              if (!newestByKey.has(format.formatKey)) {
                newestByKey.set(format.formatKey, format);
              }
            }
            const enabled = [...newestByKey.values()];
            if (enabled.length > 0) {
              await transaction.reviewFormatEnablement.createMany({
                data: enabled.map((format, index) => ({
                  tenantId: tenant.id,
                  reviewFormatVersionId: format.id,
                  enabled: true,
                  sortOrder: index,
                  allowedActions: format.supportedActions,
                })),
              });
            }

            await transaction.factOptionCategory.create({
              data: {
                tenantId: tenant.id,
                key: "service",
                label: { [input.locale]: "Service" },
                sortOrder: 0,
              },
            });

            return { status: "created" as const };
          }),

        setTenantStatus: async (input) =>
          await run(null, async (transaction) => {
            const updated = await transaction.tenant.updateMany({
              where: { id: input.tenantId },
              data: {
                status:
                  input.status === "active"
                    ? "ACTIVE"
                    : input.status === "suspended"
                      ? "SUSPENDED"
                      : "DEACTIVATED",
              },
            });
            return updated.count === 0
              ? { status: "not-found" as const }
              : { status: "saved" as const };
          }),

        createKeywordCategory: async (input) =>
          await run(input.tenantId, async (transaction) => {
            const clash = await transaction.factOptionCategory.findFirst({
              where: { tenantId: input.tenantId, key: input.key },
              select: { id: true },
            });
            if (clash !== null) {
              return { status: "key-taken" as const };
            }
            const tenant = await transaction.tenant.findUnique({
              where: { id: input.tenantId },
              select: { locale: true },
            });
            const highest = await transaction.factOptionCategory.aggregate({
              where: { tenantId: input.tenantId },
              _max: { sortOrder: true },
            });
            await transaction.factOptionCategory.create({
              data: {
                tenantId: input.tenantId,
                key: input.key,
                label: { [asLocale(tenant?.locale ?? "en-GB")]: input.label },
                sortOrder: (highest._max.sortOrder ?? 0) + 1,
              },
            });
            return { status: "created" as const };
          }),

        readPlatformConfigurationState: async () =>
          await run(
            null,
            async (transaction) => {
              const state = await transaction.platformConfigurationState.findUnique({
                where: { singleton: true },
              });
              if (state === null) {
                throw new Error("PLATFORM_CONFIGURATION_STATE_MISSING");
              }
              const draft =
                await transaction.platformConfigurationDraft.findFirst({
                  where: { singleton: true },
                  select: {
                    id: true,
                    revision: true,
                    baseRevision: true,
                    changes: true,
                  },
                });
              return {
                revision: String(state.publishedRevision),
                draft:
                  draft === null
                    ? null
                    : {
                        id: draft.id,
                        revision: String(draft.revision),
                        baseRevision: String(draft.baseRevision),
                        changes: readPlatformConfigurationChanges(draft.changes),
                      },
              };
            },
            "console:read",
          ),

        savePlatformConfigurationDraft: async (input) =>
          await run(
            null,
            async (transaction) => {
              const rows = await transaction.$queryRaw<
                { readonly revision: bigint }[]
              >`
                SELECT published_revision AS revision
                FROM platform_configuration_states
                WHERE singleton = true
                FOR UPDATE
              `;
              const revision = rows[0]?.revision;
              if (
                revision === undefined ||
                String(revision) !== input.expectedRevision
              ) {
                return { status: "conflict" as const };
              }
              const existing =
                await transaction.platformConfigurationDraft.findFirst({
                  where: { singleton: true },
                });
              if (
                (existing === null && input.expectedDraft !== null) ||
                (existing !== null &&
                  (input.expectedDraft === null ||
                    input.expectedDraft.id !== existing.id ||
                    input.expectedDraft.revision !== String(existing.revision)))
              ) {
                return { status: "conflict" as const };
              }
              const incoming = readPlatformConfigurationChanges(input.changes);
              const merged = new Map(
                (existing === null
                  ? []
                  : readPlatformConfigurationChanges(existing.changes)
                ).map((change) => [
                  platformConfigurationChangeIdentity(change),
                  change,
                ]),
              );
              for (const change of incoming) {
                merged.set(platformConfigurationChangeIdentity(change), change);
              }
              const changes = [...merged.values()];
              for (const capability of platformConfigurationCapabilities(changes)) {
                if (!(await grantedForPlatform(transaction, capability))) {
                  throw new ConsoleScopeDeniedError("Platform Configuration Draft");
                }
              }
              if (existing === null) {
                await transaction.platformConfigurationDraft.create({
                  data: {
                    baseRevision: revision,
                    changes: changes as unknown as Prisma.InputJsonValue,
                    createdBy: input.actorId,
                    updatedAt: now(),
                  },
                });
              } else {
                const updated =
                  await transaction.platformConfigurationDraft.updateMany({
                    where: { id: existing.id, revision: existing.revision },
                    data: {
                      revision: { increment: 1 },
                      changes: changes as unknown as Prisma.InputJsonValue,
                      updatedAt: now(),
                    },
                  });
                if (updated.count !== 1) {
                  return { status: "conflict" as const };
                }
              }
              return { status: "saved" as const };
            },
            "console:read",
          ),

        cancelPlatformConfigurationDraft: async (input) =>
          await run(
            null,
            async (transaction) => {
              const rows = await transaction.$queryRaw<
                { readonly revision: bigint }[]
              >`
                SELECT published_revision AS revision
                FROM platform_configuration_states
                WHERE singleton = true
                FOR UPDATE
              `;
              if (
                String(rows[0]?.revision) !== input.expectedRevision ||
                input.expectedDraft === null
              ) {
                return { status: "conflict" as const };
              }
              const deleted =
                await transaction.platformConfigurationDraft.deleteMany({
                  where: {
                    singleton: true,
                    id: input.expectedDraft.id,
                    revision: BigInt(input.expectedDraft.revision),
                  },
                });
              return deleted.count === 1
                ? { status: "cancelled" as const }
                : { status: "conflict" as const };
            },
            "console:read",
          ),

        publishPlatformConfiguration: async (input) => {
          try {
            return await run(
              null,
              async (transaction) => {
                // An operator who cannot see the complete mixed-capability Draft
                // must receive the public no-Draft result without acquiring a
                // write-side Prompt release lock. This read is only a preflight:
                // every path that can publish locks, then re-reads below.
                const visibleState = await transaction.$queryRaw<
                  { readonly revision: bigint }[]
                >`
                  SELECT published_revision AS revision
                  FROM platform_configuration_states
                  WHERE singleton = true
                `;
                const visibleRevision = visibleState[0]?.revision;
                const visibleExpectedRevision = /^\d+$/u.test(
                  input.expectedRevision,
                )
                  ? BigInt(input.expectedRevision)
                  : null;
                const visibleDraft =
                  await transaction.platformConfigurationDraft.findFirst({
                    where: { singleton: true },
                  });
                if (visibleDraft === null) {
                  if (
                    visibleRevision !== undefined &&
                    visibleExpectedRevision !== null &&
                    visibleRevision === visibleExpectedRevision + 1n &&
                    input.expectedDraft !== null
                  ) {
                    const completed =
                      await transaction.platformConfigurationPublication.findFirst({
                        where: {
                          publishedRevision: visibleRevision,
                          draftId: input.expectedDraft.id,
                          draftRevision: BigInt(input.expectedDraft.revision),
                        },
                        select: {
                          snapshotIds: true,
                          configurationReleaseId: true,
                        },
                      });
                    if (completed !== null) {
                      return {
                        status: "published" as const,
                        snapshotIds: completed.snapshotIds,
                        configurationReleaseId:
                          completed.configurationReleaseId,
                      };
                    }
                  }
                  return visibleRevision === undefined ||
                    String(visibleRevision) !== input.expectedRevision
                    ? { status: "conflict" as const }
                    : { status: "no-draft" as const };
                }
                const visibleChanges = readPlatformConfigurationChanges(
                  visibleDraft.changes,
                );
                for (const capability of platformConfigurationCapabilities(
                  visibleChanges,
                )) {
                  if (!(await grantedForPlatform(transaction, capability))) {
                    throw new ConsoleScopeDeniedError(
                      "Platform Configuration publication",
                    );
                  }
                }
                await transaction.$queryRaw`
                  SELECT public.console_lock_prompt_release_set(NULL::uuid)
                `;
                const rows = await transaction.$queryRaw<
                  { readonly revision: bigint }[]
                >`
                  SELECT published_revision AS revision
                  FROM platform_configuration_states
                  WHERE singleton = true
                  FOR UPDATE
                `;
                const revision = rows[0]?.revision;
                const expectedRevision = /^\d+$/u.test(input.expectedRevision)
                  ? BigInt(input.expectedRevision)
                  : null;
                if (
                  revision === undefined ||
                  String(revision) !== input.expectedRevision
                ) {
                  if (
                    revision !== undefined &&
                    expectedRevision !== null &&
                    revision === expectedRevision + 1n &&
                    input.expectedDraft !== null
                  ) {
                    const completed =
                      await transaction.platformConfigurationPublication.findFirst({
                        where: {
                          publishedRevision: revision,
                          draftId: input.expectedDraft.id,
                          draftRevision: BigInt(input.expectedDraft.revision),
                        },
                        select: {
                          snapshotIds: true,
                          configurationReleaseId: true,
                        },
                      });
                    if (completed !== null) {
                      return {
                        status: "published" as const,
                        snapshotIds: completed.snapshotIds,
                        configurationReleaseId:
                          completed.configurationReleaseId,
                      };
                    }
                  }
                  return { status: "conflict" as const };
                }
                const draft =
                  await transaction.platformConfigurationDraft.findFirst({
                    where: { singleton: true },
                  });
                if (draft === null) {
                  return { status: "no-draft" as const };
                }
                if (
                  input.expectedDraft === null ||
                  input.expectedDraft.id !== draft.id ||
                  input.expectedDraft.revision !== String(draft.revision) ||
                  draft.baseRevision !== revision
                ) {
                  return { status: "conflict" as const };
                }
                const changes = readPlatformConfigurationChanges(draft.changes);
                for (const capability of platformConfigurationCapabilities(changes)) {
                  if (!(await grantedForPlatform(transaction, capability))) {
                    throw new ConsoleScopeDeniedError("Platform Configuration publication");
                  }
                }
                if (
                  changes.filter(
                    (change) => change.operation === "set-provider-routing",
                  ).length > 1
                ) {
                  throw new ConfigurationPublicationIncompleteError([
                    "one deterministic primary Provider route change",
                  ]);
                }
                const transactionClockRows = await transaction.$queryRaw<
                  { readonly transaction_time: Date }[]
                >`SELECT transaction_timestamp() AS transaction_time`;
                const transactionTime =
                  transactionClockRows[0]?.transaction_time;
                if (transactionTime === undefined) {
                  throw new ConfigurationPublicationIncompleteError([
                    "the Platform publication time",
                  ]);
                }

                const settingsChange = changes.find(
                  (change) => change.operation === "save-platform-settings",
                );
                if (
                  settingsChange !== undefined &&
                  settingsChange.operation === "save-platform-settings"
                ) {
                  let defaultPolicy: unknown;
                  try {
                    defaultPolicy = JSON.parse(
                      settingsChange.defaultPolicyTemplate,
                    ) as unknown;
                  } catch {
                    throw new ConfigurationPublicationIncompleteError([
                      "a valid Platform default policy object",
                    ]);
                  }
                  if (!isRecord(defaultPolicy)) {
                    throw new ConfigurationPublicationIncompleteError([
                      "a valid Platform default policy object",
                    ]);
                  }
                  await transaction.platformSettings.upsert({
                    where: { id: "platform" },
                    create: {
                      id: "platform",
                      defaultPolicy: defaultPolicy as Prisma.InputJsonValue,
                      rateLimits: {
                        ...settingsChange.globalRateLimits,
                      },
                      logRetentionDays: settingsChange.logRetentionDays,
                    },
                    update: {
                      defaultPolicy: defaultPolicy as Prisma.InputJsonValue,
                      rateLimits: {
                        ...settingsChange.globalRateLimits,
                      },
                      logRetentionDays: settingsChange.logRetentionDays,
                    },
                  });
                  const flagKeys = settingsChange.featureFlags.map(
                    (flag) => flag.key,
                  );
                  if (new Set(flagKeys).size !== flagKeys.length) {
                    throw new ConfigurationPublicationIncompleteError([
                      "unique Platform Feature Flags",
                    ]);
                  }
                  for (const flag of settingsChange.featureFlags) {
                    const updated = await transaction.featureFlag.updateMany({
                      where: { key: flag.key },
                      data: { enabled: flag.enabled },
                    });
                    if (updated.count !== 1) {
                      throw new ConfigurationPublicationIncompleteError([
                        `Platform Feature Flag ${flag.key}`,
                      ]);
                    }
                  }
                }

                await transaction.$queryRaw<{ readonly id: string }[]>`
                  SELECT id FROM provider_models ORDER BY id FOR UPDATE
                `;
                for (const change of changes) {
                  if (change.operation !== "set-provider-routing") {
                    continue;
                  }
                  const model = await transaction.providerModel.findFirst({
                    where: {
                      modelKey: change.modelKey,
                      provider: { key: change.providerKey },
                    },
                    select: { id: true },
                  });
                  if (
                    model === null ||
                    change.routingPriority !== 1 ||
                    change.fallbackPriority !== null
                  ) {
                    throw new ConfigurationPublicationIncompleteError([
                      "exactly one primary Provider route",
                    ]);
                  }
                  const currentPrimary =
                    await transaction.providerModel.findFirst({
                      where: { routingPriority: 1 },
                      select: { id: true },
                    });
                  await transaction.providerModel.updateMany({
                    where: { id: { not: model.id }, routingPriority: 1 },
                    data: { routingPriority: null },
                  });
                  await transaction.providerModel.updateMany({
                    where: { fallbackPriority: 1 },
                    data: { fallbackPriority: null },
                  });
                  if (
                    currentPrimary !== null &&
                    currentPrimary.id !== model.id
                  ) {
                    await transaction.providerModel.update({
                      where: { id: currentPrimary.id },
                      data: { fallbackPriority: 1 },
                    });
                  }
                  await transaction.providerModel.update({
                    where: { id: model.id },
                    data: { routingPriority: 1, fallbackPriority: null },
                  });
                }
                if (
                  (await transaction.providerModel.count({
                    where: { routingPriority: 1 },
                  })) !== 1
                ) {
                  throw new ConfigurationPublicationIncompleteError([
                    "exactly one primary Provider route",
                  ]);
                }

                await transaction.$queryRaw<{ readonly id: string }[]>`
                  SELECT id
                  FROM price_rates
                  ORDER BY provider_model_id, effective_from, id
                  FOR UPDATE
                `;
                const rateChanges = changes
                  .filter(
                    (
                      change,
                    ): change is Extract<
                      PlatformConfigurationChange,
                      { readonly operation: "publish-price-rate" }
                    > => change.operation === "publish-price-rate",
                  )
                  .sort((left, right) =>
                    left.providerKey.localeCompare(right.providerKey) ||
                    left.modelKey.localeCompare(right.modelKey) ||
                    left.validFrom.localeCompare(right.validFrom),
                  );
                for (const change of rateChanges) {
                  const model = await transaction.providerModel.findFirst({
                    where: {
                      modelKey: change.modelKey,
                      provider: { key: change.providerKey },
                    },
                    select: { id: true },
                  });
                  const validFrom = new Date(change.validFrom);
                  if (model === null || !Number.isFinite(validFrom.getTime())) {
                    throw new ConfigurationPublicationIncompleteError([
                      "effective non-overlapping Price Rates",
                    ]);
                  }
                  // Equality is prospective: a Rate may begin exactly at this
                  // transaction's stable timestamp, but never before it.
                  if (validFrom < transactionTime) {
                    throw new ConfigurationPublicationIncompleteError([
                      "a prospective Price Rate start at or after the publication transaction",
                    ]);
                  }
                  const latest = await transaction.priceRate.findFirst({
                    where: { providerModelId: model.id },
                    orderBy: { effectiveFrom: "desc" },
                  });
                  if (
                    latest !== null &&
                    latest.effectiveFrom >= validFrom
                  ) {
                    throw new ConfigurationPublicationIncompleteError([
                      "effective non-overlapping Price Rates",
                    ]);
                  }
                  if (latest !== null && latest.effectiveTo === null) {
                    await transaction.priceRate.update({
                      where: { id: latest.id },
                      data: { effectiveTo: validFrom },
                    });
                  }
                  await transaction.priceRate.create({
                    data: {
                      providerModelId: model.id,
                      currency: change.currency,
                      inputPerMillionMicros: BigInt(
                        change.inputMicrosPerMillion,
                      ),
                      outputPerMillionMicros: BigInt(
                        change.outputMicrosPerMillion,
                      ),
                      effectiveFrom: validFrom,
                    },
                  });
                }
                const overlaps = await transaction.$queryRaw<
                  { readonly overlaps: boolean }[]
                >`
                  SELECT EXISTS (
                    SELECT 1
                    FROM price_rates AS left_rate
                    JOIN price_rates AS right_rate
                      ON right_rate.provider_model_id = left_rate.provider_model_id
                     AND right_rate.id > left_rate.id
                     AND tstzrange(
                       left_rate.effective_from,
                       left_rate.effective_to,
                       '[)'
                     ) && tstzrange(
                       right_rate.effective_from,
                       right_rate.effective_to,
                       '[)'
                     )
                  ) AS overlaps
                `;
                if (overlaps[0]?.overlaps === true) {
                  throw new ConfigurationPublicationIncompleteError([
                    "effective non-overlapping Price Rates",
                  ]);
                }

                const nextRevision = revision + 1n;
                const advanced =
                  await transaction.platformConfigurationState.updateMany({
                    where: {
                      singleton: true,
                      publishedRevision: revision,
                    },
                    data: {
                      publishedRevision: nextRevision,
                      updatedAt: now(),
                    },
                  });
                if (advanced.count !== 1) {
                  throw new ConfigurationPublicationConflictError();
                }
                const locations = await transaction.location.findMany({
                  where: {
                    status: "ACTIVE",
                    tenant: { status: "ACTIVE" },
                  },
                  select: { id: true, tenantId: true },
                  orderBy: [{ tenantId: "asc" }, { id: "asc" }],
                });
                const snapshotIds: string[] = [];
                for (const location of locations) {
                  const materialized = await materializePublishedConfiguration(
                    transaction,
                    {
                      tenantId: location.tenantId,
                      locationId: location.id,
                    },
                  );
                  if (materialized.status === "incomplete") {
                    throw new ConfigurationPublicationIncompleteError(
                      materialized.missing,
                    );
                  }
                  snapshotIds.push(materialized.snapshotId);
                }
                const configurationReleaseId = randomUUID();
                await transaction.$queryRaw`
                  SELECT public.register_configuration_release(
                    ${configurationReleaseId}::uuid,
                    ${snapshotIds}::uuid[],
                    ${input.actorId}::uuid,
                    true
                  )
                `;
                await transaction.platformConfigurationPublication.create({
                  data: {
                    publishedRevision: nextRevision,
                    draftId: draft.id,
                    draftRevision: draft.revision,
                    changes: changes as unknown as Prisma.InputJsonValue,
                    snapshotIds,
                    configurationReleaseId,
                    actorId: input.actorId,
                  },
                });
                const deleted =
                  await transaction.platformConfigurationDraft.deleteMany({
                    where: { id: draft.id, revision: draft.revision },
                  });
                if (deleted.count !== 1) {
                  throw new ConfigurationPublicationConflictError();
                }
                return {
                  status: "published" as const,
                  snapshotIds,
                  configurationReleaseId,
                };
              },
              "console:read",
            );
          } catch (error) {
            if (error instanceof ConfigurationPublicationIncompleteError) {
              return {
                status: "incomplete" as const,
                missing: [...error.missing],
              };
            }
            if (error instanceof ConfigurationPublicationConflictError) {
              return { status: "conflict" as const };
            }
            throw error;
          }
        },

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
            await transaction.$queryRaw<{ readonly id: string }[]>`
              SELECT id FROM provider_models ORDER BY id FOR UPDATE
            `;
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
            if (
              input.routingPriority !== 1 ||
              input.fallbackPriority !== null
            ) {
              return { status: "invalid-routing" as const };
            }
            const currentPrimary = await transaction.providerModel.findFirst({
              where: { routingPriority: 1 },
              select: { id: true },
            });
            await transaction.providerModel.updateMany({
              where: { id: { not: model.id }, routingPriority: 1 },
              data: { routingPriority: null },
            });
            await transaction.providerModel.updateMany({
              where: { fallbackPriority: 1 },
              data: { fallbackPriority: null },
            });
            if (currentPrimary !== null && currentPrimary.id !== model.id) {
              await transaction.providerModel.update({
                where: { id: currentPrimary.id },
                data: { fallbackPriority: 1 },
              });
            }
            await transaction.providerModel.update({
              where: { id: model.id },
              data: {
                routingPriority: 1,
                fallbackPriority: null,
              },
            });
            const primaryCount = await transaction.providerModel.count({
              where: { routingPriority: 1 },
            });
            if (primaryCount !== 1) {
              throw new Error("Provider routing must have exactly one primary");
            }
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
        readConfigurationState: async (input) =>
          await orEmpty(() => operations.readConfigurationState(input), null),
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
        listSelectableTenants: async () =>
          await orEmpty(() => operations.listSelectableTenants(), []),
        listPlatformStyles: async () =>
          await orEmpty(() => operations.listPlatformStyles(), []),
      };
    },
  };
}

function mapPrompt(row: PromptWithConsoleRelations): PromptRecord {
  const evaluation = latestEvaluation(row);
  const lifecycle = promptLifecycleStatus(row);
  return {
    id: row.id,
    action: STORED_TO_ACTION[row.action as StoredAction],
    version: row.version,
    hash: row.contentHash,
    status:
      lifecycle === "retired"
        ? "retired"
        : row.deployments.length > 0
        ? "published"
        : lifecycle === "in-experiment"
            ? "in-experiment"
            : lifecycle === "candidate"
              ? "candidate"
              : "draft",
    createdAt: iso(row.createdAt),
    createdBy: row.createdBy,
    evaluationScore: evaluation?.passRate ?? null,
    body: row.body,
    variables: [...row.variables],
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
