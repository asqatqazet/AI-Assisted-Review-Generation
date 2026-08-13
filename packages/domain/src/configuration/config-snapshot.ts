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

export const CONFIG_SNAPSHOT_SCHEMA_VERSION = 1;

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
  readonly hash: string;
  readonly key: string;
  readonly commandKind: CommandKind;
  readonly body: string;
  readonly variables: readonly string[];
}

export interface PriceRate {
  readonly id: string;
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

export interface ConfigSnapshotPayload {
  readonly schemaVersion: typeof CONFIG_SNAPSHOT_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly locationId: string;
  readonly tenantName: string;
  readonly locationName: string;
  readonly settings: EffectiveSettings;
  readonly provenance: Readonly<Record<keyof EffectiveSettings, SourceProvenance>>;
  readonly factOptions: readonly FactOption[];
  readonly reviewFormats: readonly ReviewFormatVersion[];
  readonly promptVersions: readonly PromptVersion[];
  readonly priceRates: readonly PriceRate[];
  readonly providerRouting: ProviderRouting;
}

export interface ResolvedConfigSnapshot extends ConfigSnapshotPayload {
  readonly snapshotId: `sha256:${string}`;
}

const lexical = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const byId = <Value extends { readonly id: string }>(left: Value, right: Value): number =>
  lexical(left.id, right.id);

const byHash = <Value extends { readonly hash: string }>(left: Value, right: Value): number =>
  lexical(left.hash, right.hash);

const sortedStrings = (values: readonly string[]): readonly string[] =>
  [...values].sort(lexical);

const copyReviewFormat = (format: ReviewFormatVersion): ReviewFormatVersion => ({
  id: format.id,
  key: format.key,
  version: format.version,
  displayName: format.displayName,
  targetPlatform: format.targetPlatform,
  locale: format.locale,
  description: { ...format.description },
  sample: { ...format.sample },
  constraints: { ...format.constraints },
  supportedCommands: sortedStrings(format.supportedCommands) as readonly CommandKind[],
});

const copyPromptVersion = (prompt: PromptVersion): PromptVersion => ({
  hash: prompt.hash,
  key: prompt.key,
  commandKind: prompt.commandKind,
  body: prompt.body,
  variables: sortedStrings(prompt.variables),
});

const copyPriceRate = (rate: PriceRate): PriceRate => ({
  id: rate.id,
  provider: rate.provider,
  model: rate.model,
  inputPerMillionMicros: rate.inputPerMillionMicros,
  outputPerMillionMicros: rate.outputPerMillionMicros,
  currency: rate.currency,
  unit: rate.unit,
  effectiveFrom: rate.effectiveFrom,
  effectiveTo: rate.effectiveTo,
});

const copyFactOption = (option: FactOption): FactOption => ({
  id: option.id,
  version: option.version,
  owner: { ...option.owner },
  categoryId: option.categoryId,
  proposition: option.proposition,
  polarity: option.polarity,
  locale: option.locale,
  active: option.active,
  sortOrder: option.sortOrder,
});

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
  const enabledFormatIds = new Set(settings.enabledReviewFormatVersionIds);

  return {
    schemaVersion: CONFIG_SNAPSHOT_SCHEMA_VERSION,
    tenantId: input.tenant.id,
    locationId: input.location.id,
    tenantName: input.tenantName,
    locationName: input.locationName,
    settings,
    provenance: { ...resolved.provenance },
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
  snapshot: ConfigSnapshotPayload | ResolvedConfigSnapshot,
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

export function buildConfigSnapshot(
  input: BuildConfigSnapshotInput,
): ResolvedConfigSnapshot {
  const payload = buildPayload(input);
  const snapshot: ResolvedConfigSnapshot = {
    snapshotId: `sha256:${sha256(canonicalizeConfigSnapshotPayload(payload))}`,
    ...payload,
  };
  return deepFreeze(snapshot);
}
