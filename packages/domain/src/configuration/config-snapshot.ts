import {
  resolveEffectiveConfig,
  type CommandKind,
  type EffectiveSettings,
  type FactOption,
  type LocationConfiguration,
  type PlatformConfiguration,
  type SourceProvenance,
  type TenantConfiguration,
} from "./effective-config.js";
import { resolveExecutableGenerationActions } from "../generation/action-capabilities.js";

export const CONFIG_SNAPSHOT_SCHEMA_VERSION = 2;

export type ReviewFormatLocale = EffectiveSettings["locale"] | "any";

export interface ReviewFormatConstraints {
  readonly minChars: number;
  readonly maxChars: number;
  readonly paragraphs: number;
  readonly emojiPolicy: "none" | "allowed";
  readonly secondPerson: boolean;
}

export interface ReviewFormatVersion {
  readonly id: string;
  readonly key: string;
  readonly version: string;
  readonly displayName: string;
  readonly targetPlatform: string;
  readonly locale: ReviewFormatLocale;
  readonly description: Readonly<Partial<Record<EffectiveSettings["locale"], string>>>;
  readonly sample: Readonly<Partial<Record<EffectiveSettings["locale"], string>>>;
  readonly constraints: ReviewFormatConstraints;
  readonly supportedCommands: readonly CommandKind[];
}

export interface PromptVersion {
  readonly id: string;
  readonly hash: string;
  readonly key: string;
  readonly commandKind: CommandKind;
  readonly body: string;
  readonly variables: readonly string[];
}

export interface PriceRate {
  readonly id: string;
  readonly providerModelId: string;
  readonly provider: string;
  readonly model: string;
  readonly inputPerMillionMicros: number;
  readonly outputPerMillionMicros: number;
  readonly currency: string;
  readonly unit: "token";
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface ProviderRouting {
  readonly version?: string;
  readonly providerModelId: string;
  readonly primaryProvider: string;
  readonly primaryModel: string;
}

export interface BuildConfigSnapshotInput {
  platform: PlatformConfiguration;
  tenant: TenantConfiguration;
  location: LocationConfiguration;
  tenantName: string;
  locationName: string;
  reviewFormats: readonly ReviewFormatVersion[];
  promptVersions: readonly PromptVersion[];
  priceRates: readonly PriceRate[];
  providerRouting: ProviderRouting;
}

export type ConfigSnapshotProvenanceKey =
  | keyof EffectiveSettings
  | "tenantName"
  | "locationName"
  | "providerRouting";

export interface ConfigSnapshotPayload {
  readonly schemaVersion: typeof CONFIG_SNAPSHOT_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly locationId: string;
  readonly tenantName: string;
  readonly locationName: string;
  readonly settings: EffectiveSettings;
  readonly provenance: Readonly<Record<ConfigSnapshotProvenanceKey, SourceProvenance>>;
  readonly factOptions: readonly FactOption[];
  readonly reviewFormats: readonly ReviewFormatVersion[];
  readonly promptVersions: readonly PromptVersion[];
  readonly priceRates: readonly PriceRate[];
  readonly providerRouting: ProviderRouting;
}

export interface ResolvedConfigSnapshot extends ConfigSnapshotPayload {
  readonly snapshotId: `sha256:${string}`;
}

/**
 * Persistence may use a row identifier while retaining the canonical content
 * hash beside it. Canonicalization intentionally ignores that identifier.
 */
export interface PersistedConfigSnapshotDocument
  extends Omit<ConfigSnapshotPayload, "provenance"> {
  readonly snapshotId: string;
  readonly provenance: Readonly<Record<string, SourceProvenance>>;
}

export type ConfigSnapshotErrorCode =
  | "duplicate-review-format-id"
  | "duplicate-review-format-version"
  | "duplicate-prompt-hash"
  | "duplicate-price-rate-id"
  | "invalid-price-rate-interval"
  | "overlapping-price-rate-interval"
  | "missing-enabled-review-format"
  | "no-executable-action"
  | "unpriced-provider-route"
  | "provider-model-identity-mismatch";

export class ConfigSnapshotError extends Error {
  readonly code: ConfigSnapshotErrorCode;

  constructor(code: ConfigSnapshotErrorCode, message: string) {
    super(message);
    this.name = "ConfigSnapshotError";
    this.code = code;
  }
}

const lexical = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const byId = <Value extends { readonly id: string }>(left: Value, right: Value): number =>
  lexical(left.id, right.id);

const byHash = <Value extends { readonly hash: string }>(left: Value, right: Value): number =>
  lexical(left.hash, right.hash);

const sortedStrings = (values: readonly string[]): readonly string[] =>
  [...values].sort(lexical);

const copyReviewFormatConstraints = (
  constraints: ReviewFormatConstraints,
): ReviewFormatConstraints => ({
  minChars: constraints.minChars,
  maxChars: constraints.maxChars,
  paragraphs: constraints.paragraphs,
  emojiPolicy: constraints.emojiPolicy,
  secondPerson: constraints.secondPerson,
});

const copyLocalizedMap = (
  map: Readonly<Partial<Record<EffectiveSettings["locale"], string>>>,
): Readonly<Partial<Record<EffectiveSettings["locale"], string>>> => {
  const allowedLocales: readonly EffectiveSettings["locale"][] = [
    "en-GB",
    "de-DE",
  ];
  const result: Partial<Record<EffectiveSettings["locale"], string>> = {};
  for (const loc of allowedLocales) {
    if (typeof map[loc] === "string") {
      result[loc] = map[loc];
    }
  }
  return result;
};

const copyReviewFormat = (format: ReviewFormatVersion): ReviewFormatVersion => ({
  id: format.id,
  key: format.key,
  version: format.version,
  displayName: format.displayName,
  targetPlatform: format.targetPlatform,
  locale: format.locale,
  description: copyLocalizedMap(format.description),
  sample: copyLocalizedMap(format.sample),
  constraints: copyReviewFormatConstraints(format.constraints),
  supportedCommands: sortedStrings(format.supportedCommands) as readonly CommandKind[],
});

const copyPromptVersion = (prompt: PromptVersion): PromptVersion => ({
  id: prompt.id,
  hash: prompt.hash,
  key: prompt.key,
  commandKind: prompt.commandKind,
  body: prompt.body,
  variables: sortedStrings(prompt.variables),
});

const copyPriceRate = (rate: PriceRate): PriceRate => ({
  id: rate.id,
  providerModelId: rate.providerModelId,
  provider: rate.provider,
  model: rate.model,
  inputPerMillionMicros: rate.inputPerMillionMicros,
  outputPerMillionMicros: rate.outputPerMillionMicros,
  currency: rate.currency,
  unit: rate.unit,
  effectiveFrom: rate.effectiveFrom,
  effectiveTo: rate.effectiveTo,
});

const copyFactOwner = (owner: FactOption["owner"]): FactOption["owner"] =>
  owner.scope === "tenant"
    ? { scope: "tenant", tenantId: owner.tenantId }
    : { scope: "location", tenantId: owner.tenantId, locationId: owner.locationId };

const copyFactOption = (option: FactOption): FactOption => ({
  id: option.id,
  version: option.version,
  ...(option.label === undefined ? {} : { label: option.label }),
  ...(option.categoryLabel === undefined
    ? {}
    : { categoryLabel: option.categoryLabel }),
  owner: copyFactOwner(option.owner),
  categoryId: option.categoryId,
  proposition: option.proposition,
  polarity: option.polarity,
  locale: option.locale,
  active: option.active,
  sortOrder: option.sortOrder,
});

function validateInputs(
  input: BuildConfigSnapshotInput,
  resolvedSettings: EffectiveSettings,
): void {
  const seenFormatIds = new Set<string>();
  const seenFormatKeyVersions = new Set<string>();
  for (const format of input.reviewFormats) {
    if (seenFormatIds.has(format.id)) {
      throw new ConfigSnapshotError(
        "duplicate-review-format-id",
        `Duplicate review format id: ${format.id}`,
      );
    }
    seenFormatIds.add(format.id);
    const keyVersion = `${format.key}@${format.version}`;
    if (seenFormatKeyVersions.has(keyVersion)) {
      throw new ConfigSnapshotError(
        "duplicate-review-format-version",
        `Duplicate review format key/version: ${keyVersion}`,
      );
    }
    seenFormatKeyVersions.add(keyVersion);
  }

  const seenPromptHashes = new Set<string>();
  for (const prompt of input.promptVersions) {
    if (seenPromptHashes.has(prompt.hash)) {
      throw new ConfigSnapshotError(
        "duplicate-prompt-hash",
        `Duplicate prompt hash: ${prompt.hash}`,
      );
    }
    seenPromptHashes.add(prompt.hash);
  }

  const seenRateIds = new Set<string>();
  const ratesByModel = new Map<string, PriceRate[]>();
  for (const rate of input.priceRates) {
    if (seenRateIds.has(rate.id)) {
      throw new ConfigSnapshotError(
        "duplicate-price-rate-id",
        `Duplicate price rate id: ${rate.id}`,
      );
    }
    seenRateIds.add(rate.id);

    const fromMs = Date.parse(rate.effectiveFrom);
    if (Number.isNaN(fromMs)) {
      throw new ConfigSnapshotError(
        "invalid-price-rate-interval",
        `Invalid effectiveFrom timestamp: ${rate.effectiveFrom}`,
      );
    }
    if (rate.effectiveTo !== null) {
      const toMs = Date.parse(rate.effectiveTo);
      if (Number.isNaN(toMs) || toMs <= fromMs) {
        throw new ConfigSnapshotError(
          "invalid-price-rate-interval",
          `Invalid effectiveTo timestamp or interval: ${rate.effectiveTo} (from: ${rate.effectiveFrom})`,
        );
      }
    }

    const modelKey = `${rate.provider}:${rate.model}`;
    const list = ratesByModel.get(modelKey) ?? [];
    list.push(rate);
    ratesByModel.set(modelKey, list);
  }

  for (const rates of ratesByModel.values()) {
    for (let i = 0; i < rates.length; i++) {
      const r1 = rates[i]!;
      const start1 = Date.parse(r1.effectiveFrom);
      const end1 = r1.effectiveTo ? Date.parse(r1.effectiveTo) : Infinity;

      for (let j = i + 1; j < rates.length; j++) {
        const r2 = rates[j]!;
        const start2 = Date.parse(r2.effectiveFrom);
        const end2 = r2.effectiveTo ? Date.parse(r2.effectiveTo) : Infinity;

        if (Math.max(start1, start2) < Math.min(end1, end2)) {
          throw new ConfigSnapshotError(
            "overlapping-price-rate-interval",
            `Overlapping price rate intervals for ${r1.provider}:${r1.model}`,
          );
        }
      }
    }
  }

  for (const enabledId of resolvedSettings.enabledReviewFormatVersionIds) {
    if (!seenFormatIds.has(enabledId)) {
      throw new ConfigSnapshotError(
        "missing-enabled-review-format",
        `Enabled review format id not found in catalogue: ${enabledId}`,
      );
    }
  }

  const enabledFormatIds = new Set(
    resolvedSettings.enabledReviewFormatVersionIds,
  );
  const localeCompatibleFormats = input.reviewFormats.filter(
    (format) =>
      enabledFormatIds.has(format.id) &&
      (format.locale === "any" || format.locale === resolvedSettings.locale),
  );
  if (
    resolveExecutableGenerationActions({
      enabledActions: resolvedSettings.enabledCommands,
      promptActions: input.promptVersions.map((prompt) => prompt.commandKind),
      reviewFormats: localeCompatibleFormats.map((format) => ({
        supportedActions: format.supportedCommands,
      })),
    }).length === 0
  ) {
    throw new ConfigSnapshotError(
      "no-executable-action",
      "No executable Action has exactly one Prompt and a locale-compatible Review Format.",
    );
  }

  const primaryModelKey = `${input.providerRouting.primaryProvider}:${input.providerRouting.primaryModel}`;
  if (!ratesByModel.has(primaryModelKey) || (ratesByModel.get(primaryModelKey)?.length ?? 0) === 0) {
    throw new ConfigSnapshotError(
      "unpriced-provider-route",
      `No price rate for provider routing: ${primaryModelKey}`,
    );
  }

  const routedRates = ratesByModel.get(primaryModelKey) ?? [];
  if (
    routedRates.some(
      (rate) => rate.providerModelId !== input.providerRouting.providerModelId,
    )
  ) {
    throw new ConfigSnapshotError(
      "provider-model-identity-mismatch",
      `Provider Model identity does not match routing for: ${primaryModelKey}`,
    );
  }
}

function buildPayload(input: BuildConfigSnapshotInput): ConfigSnapshotPayload {
  const resolved = resolveEffectiveConfig({
    platform: input.platform,
    tenant: input.tenant,
    location: input.location,
  });
  const settings: EffectiveSettings = {
    locale: resolved.value.locale,
    toneGuidelines: resolved.value.toneGuidelines,
    entryMode: resolved.value.entryMode,
    requireDisclosure: resolved.value.requireDisclosure,
    requireVerifiedExperience: resolved.value.requireVerifiedExperience,
    maxReviewFormatsPerRequest: resolved.value.maxReviewFormatsPerRequest,
    minimumFactSelections: resolved.value.minimumFactSelections,
    maximumCustomerAssertionChars:
      resolved.value.maximumCustomerAssertionChars,
    bannedTerms: sortedStrings(resolved.value.bannedTerms),
    enabledReviewFormatVersionIds: sortedStrings(
      resolved.value.enabledReviewFormatVersionIds,
    ),
    enabledCommands: sortedStrings(
      resolved.value.enabledCommands,
    ) as readonly CommandKind[],
    monthlyBudgetMicros: resolved.value.monthlyBudgetMicros,
    alertThresholdPct: resolved.value.alertThresholdPct,
  };

  validateInputs(input, settings);

  const enabledFormatIds = new Set(settings.enabledReviewFormatVersionIds);
  const provenance: Record<ConfigSnapshotProvenanceKey, SourceProvenance> = {
    ...resolved.provenance,
    tenantName: {
      scope: "tenant",
      sourceId: input.tenant.id,
      revision: input.tenant.revision,
    },
    locationName: {
      scope: "location",
      sourceId: input.location.id,
      revision: input.location.revision,
    },
    providerRouting: {
      scope: "platform",
      sourceId: input.platform.id,
      revision: input.platform.revision,
    },
  };

  return {
    schemaVersion: CONFIG_SNAPSHOT_SCHEMA_VERSION,
    tenantId: input.tenant.id,
    locationId: input.location.id,
    tenantName: input.tenantName,
    locationName: input.locationName,
    settings,
    provenance,
    factOptions: resolved.value.factOptions.map(copyFactOption),
    reviewFormats: input.reviewFormats
      .filter(
        (format) =>
          enabledFormatIds.has(format.id) &&
          (format.locale === "any" || format.locale === settings.locale),
      )
      .map(copyReviewFormat)
      .sort(byId),
    promptVersions: input.promptVersions.map(copyPromptVersion).sort(byHash),
    priceRates: input.priceRates.map(copyPriceRate).sort(byId),
    providerRouting: {
      ...(input.providerRouting.version !== undefined
        ? { version: input.providerRouting.version }
        : {}),
      providerModelId: input.providerRouting.providerModelId,
      primaryProvider: input.providerRouting.primaryProvider,
      primaryModel: input.providerRouting.primaryModel,
    },
  };
}

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const record = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(record)
    .sort(lexical)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key] ?? null)}`)
    .join(",")}}`;
}

export function canonicalizeConfigSnapshotPayload(
  snapshot:
    | ConfigSnapshotPayload
    | ResolvedConfigSnapshot
    | PersistedConfigSnapshotDocument,
): string {
  const { snapshotId: _snapshotId, ...payload } = snapshot as ResolvedConfigSnapshot;
  void _snapshotId;
  return canonicalJson(payload as unknown as JsonValue);
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_ROUND = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
] as const;

const rotateRight = (value: number, shift: number): number =>
  (value >>> shift) | (value << (32 - shift));

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point <= 0x7f) bytes.push(point);
    else if (point <= 0x7ff) bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
    else if (point <= 0xffff) {
      bytes.push(
        0xe0 | (point >>> 12),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (point >>> 18),
        0x80 | ((point >>> 12) & 0x3f),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

function sha256(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) {
    bytes.push(shift >= 32 ? 0 : (bitLength >>> shift) & 0xff);
  }

  const hash: number[] = [...SHA256_INITIAL];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const byte = offset + index * 4;
      words[index] =
        (((bytes[byte] ?? 0) << 24) |
          ((bytes[byte + 1] ?? 0) << 16) |
          ((bytes[byte + 2] ?? 0) << 8) |
          (bytes[byte + 3] ?? 0)) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upperE = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choose = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 =
        ((h ?? 0) + upperE + choose + (SHA256_ROUND[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const upperA = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = (upperA + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < hash.length; index += 1) {
      hash[index] = ((hash[index] ?? 0) + (next[index] ?? 0)) >>> 0;
    }
  }

  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function deriveConfigSnapshotId(
  snapshot:
    | ConfigSnapshotPayload
    | ResolvedConfigSnapshot
    | PersistedConfigSnapshotDocument,
): `sha256:${string}` {
  return `sha256:${sha256(canonicalizeConfigSnapshotPayload(snapshot))}`;
}

export function verifyConfigSnapshot(
  snapshot: ResolvedConfigSnapshot,
): boolean {
  if (!snapshot || typeof snapshot.snapshotId !== "string") {
    return false;
  }
  return snapshot.snapshotId === deriveConfigSnapshotId(snapshot);
}

export function buildConfigSnapshot(
  input: BuildConfigSnapshotInput,
): ResolvedConfigSnapshot {
  const payload = buildPayload(input);
  const snapshot: ResolvedConfigSnapshot = {
    snapshotId: deriveConfigSnapshotId(payload),
    ...payload,
  };
  return deepFreeze(snapshot);
}
