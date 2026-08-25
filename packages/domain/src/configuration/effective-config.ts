export type Locale = "en-GB" | "de-DE";
export type EntryMode = "invite" | "open-qr" | "both";
export type CommandKind =
  | "generate"
  | "paraphrase"
  | "reformat"
  | "condense"
  | "expand"
  | "revise-wording";

export interface EffectiveSettings {
  readonly locale: Locale;
  readonly toneGuidelines: string;
  readonly entryMode: EntryMode;
  readonly requireDisclosure: boolean;
  readonly requireVerifiedExperience: boolean;
  readonly maxReviewFormatsPerRequest: number;
  readonly minimumFactSelections: number;
  readonly maximumCustomerAssertionChars: number;
  readonly bannedTerms: readonly string[];
  readonly enabledReviewFormatVersionIds: readonly string[];
  readonly enabledCommands: readonly CommandKind[];
  readonly monthlyBudgetMicros: number;
  readonly alertThresholdPct: number;
}

export type ConfigurationField = keyof EffectiveSettings;
export type ConfigurationScope = "platform" | "tenant" | "location";

export interface SourceProvenance {
  readonly scope: ConfigurationScope;
  readonly sourceId: string;
  readonly revision: string;
}

export interface FactOption {
  readonly id: string;
  readonly version: string;
  /** Published reviewer-facing text; older schema-v2 snapshots may omit it. */
  readonly label?: string | undefined;
  /** Published reviewer-facing category text; older schema-v2 snapshots may omit it. */
  readonly categoryLabel?: string | undefined;
  readonly owner:
    | { readonly scope: "tenant"; readonly tenantId: string }
    | {
        readonly scope: "location";
        readonly tenantId: string;
        readonly locationId: string;
      };
  readonly categoryId: string;
  readonly proposition: string;
  readonly polarity: "positive" | "neutral" | "negative";
  readonly locale: Locale;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface PlatformConfiguration {
  readonly id: string;
  readonly revision: string;
  readonly defaults: EffectiveSettings;
}

export interface TenantConfiguration {
  readonly id: string;
  readonly revision: string;
  readonly settings: Partial<EffectiveSettings>;
  readonly factOptions: readonly FactOption[];
}

export interface LocationConfiguration {
  readonly id: string;
  readonly tenantId: string;
  readonly revision: string;
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly factOptionAdditions: readonly FactOption[];
}

export interface EffectiveConfiguration extends EffectiveSettings {
  readonly factOptions: readonly FactOption[];
}

export interface EffectiveConfigurationResolution {
  readonly value: EffectiveConfiguration;
  readonly provenance: Readonly<Record<ConfigurationField, SourceProvenance>>;
}

export const LOCATION_OVERRIDE_FIELDS = [
  "entryMode",
  "requireDisclosure",
  "requireVerifiedExperience",
  "maxReviewFormatsPerRequest",
  "bannedTerms",
] as const satisfies readonly ConfigurationField[];

export type LocationOverrideField = (typeof LOCATION_OVERRIDE_FIELDS)[number];

const locationOverrideFields = new Set<string>(LOCATION_OVERRIDE_FIELDS);

export class ConfigurationResolutionError extends Error {
  public constructor(
    public readonly code:
      | "unknown-location-override"
      | "location-tenant-mismatch"
      | "invalid-fact-option-owner"
      | "duplicate-fact-option",
    message: string,
  ) {
    super(message);
    this.name = "ConfigurationResolutionError";
  }
}

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export function resetLocationOverride(
  location: LocationConfiguration,
  field: LocationOverrideField,
): LocationConfiguration {
  if (!hasOwn(location.overrides, field)) {
    return location;
  }

  return {
    ...location,
    overrides: Object.fromEntries(
      Object.entries(location.overrides).filter(([key]) => key !== field),
    ),
  };
}

const byScopeOrder = (left: FactOption, right: FactOption): number =>
  left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);

function mergeFactOptions(
  tenant: TenantConfiguration,
  location: LocationConfiguration,
): readonly FactOption[] {
  for (const option of tenant.factOptions) {
    if (option.owner.scope !== "tenant" || option.owner.tenantId !== tenant.id) {
      throw new ConfigurationResolutionError(
        "invalid-fact-option-owner",
        `Fact Option ${option.id} is not owned by Tenant ${tenant.id}.`,
      );
    }
  }

  for (const option of location.factOptionAdditions) {
    if (
      option.owner.scope !== "location" ||
      option.owner.tenantId !== tenant.id ||
      option.owner.locationId !== location.id
    ) {
      throw new ConfigurationResolutionError(
        "invalid-fact-option-owner",
        `Fact Option ${option.id} is not owned by Location ${location.id}.`,
      );
    }
  }

  const options = [...tenant.factOptions, ...location.factOptionAdditions];
  const identities = new Set<string>();
  for (const option of options) {
    if (identities.has(option.id)) {
      throw new ConfigurationResolutionError(
        "duplicate-fact-option",
        `Fact Option identity ${option.id} occurs more than once.`,
      );
    }
    identities.add(option.id);
  }

  return [
    ...tenant.factOptions.toSorted(byScopeOrder),
    ...location.factOptionAdditions.toSorted(byScopeOrder),
  ];
}

export function resolveEffectiveConfig(input: {
  readonly platform: PlatformConfiguration;
  readonly tenant: TenantConfiguration;
  readonly location: LocationConfiguration;
}): EffectiveConfigurationResolution {
  const { platform, tenant, location } = input;

  if (location.tenantId !== tenant.id) {
    throw new ConfigurationResolutionError(
      "location-tenant-mismatch",
      `Location ${location.id} does not belong to Tenant ${tenant.id}.`,
    );
  }

  const unknownOverrideKeys = Object.keys(location.overrides).filter(
    (key) => !locationOverrideFields.has(key),
  );
  if (unknownOverrideKeys.length > 0) {
    throw new ConfigurationResolutionError(
      "unknown-location-override",
      `Unknown Location override keys: ${unknownOverrideKeys.sort().join(", ")}.`,
    );
  }

  const resolveField = <Field extends ConfigurationField>(field: Field) => {
    if (hasOwn(location.overrides, field)) {
      return {
        value: location.overrides[field] as EffectiveSettings[Field],
        provenance: {
          scope: "location",
          sourceId: location.id,
          revision: location.revision,
        } satisfies SourceProvenance,
      };
    }
    if (hasOwn(tenant.settings, field)) {
      return {
        value: tenant.settings[field] as EffectiveSettings[Field],
        provenance: {
          scope: "tenant",
          sourceId: tenant.id,
          revision: tenant.revision,
        } satisfies SourceProvenance,
      };
    }
    return {
      value: platform.defaults[field],
      provenance: {
        scope: "platform",
        sourceId: platform.id,
        revision: platform.revision,
      } satisfies SourceProvenance,
    };
  };

  const locale = resolveField("locale");
  const toneGuidelines = resolveField("toneGuidelines");
  const entryMode = resolveField("entryMode");
  const requireDisclosure = resolveField("requireDisclosure");
  const requireVerifiedExperience = resolveField("requireVerifiedExperience");
  const maxReviewFormatsPerRequest = resolveField("maxReviewFormatsPerRequest");
  const minimumFactSelections = resolveField("minimumFactSelections");
  const maximumCustomerAssertionChars = resolveField(
    "maximumCustomerAssertionChars",
  );
  const bannedTerms = resolveField("bannedTerms");
  const enabledReviewFormatVersionIds = resolveField(
    "enabledReviewFormatVersionIds",
  );
  const enabledCommands = resolveField("enabledCommands");
  const monthlyBudgetMicros = resolveField("monthlyBudgetMicros");
  const alertThresholdPct = resolveField("alertThresholdPct");

  return {
    value: {
      locale: locale.value,
      toneGuidelines: toneGuidelines.value,
      entryMode: entryMode.value,
      requireDisclosure: requireDisclosure.value,
      requireVerifiedExperience: requireVerifiedExperience.value,
      maxReviewFormatsPerRequest: maxReviewFormatsPerRequest.value,
      minimumFactSelections: minimumFactSelections.value,
      maximumCustomerAssertionChars: maximumCustomerAssertionChars.value,
      bannedTerms: bannedTerms.value,
      enabledReviewFormatVersionIds: enabledReviewFormatVersionIds.value,
      enabledCommands: enabledCommands.value,
      monthlyBudgetMicros: monthlyBudgetMicros.value,
      alertThresholdPct: alertThresholdPct.value,
      factOptions: mergeFactOptions(tenant, location),
    },
    provenance: {
      locale: locale.provenance,
      toneGuidelines: toneGuidelines.provenance,
      entryMode: entryMode.provenance,
      requireDisclosure: requireDisclosure.provenance,
      requireVerifiedExperience: requireVerifiedExperience.provenance,
      maxReviewFormatsPerRequest: maxReviewFormatsPerRequest.provenance,
      minimumFactSelections: minimumFactSelections.provenance,
      maximumCustomerAssertionChars: maximumCustomerAssertionChars.provenance,
      bannedTerms: bannedTerms.provenance,
      enabledReviewFormatVersionIds: enabledReviewFormatVersionIds.provenance,
      enabledCommands: enabledCommands.provenance,
      monthlyBudgetMicros: monthlyBudgetMicros.provenance,
      alertThresholdPct: alertThresholdPct.provenance,
    },
  };
}
