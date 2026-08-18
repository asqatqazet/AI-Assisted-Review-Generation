import {
  LOCATION_OVERRIDE_FIELDS,
  type LocationOverrideField,
} from "../configuration/index.js";

export type ConsoleSettingValue = string | number | boolean | readonly string[];

export type ConsoleSettingKind =
  | "boolean"
  | "number"
  | "text"
  | "locale"
  | "entry-mode"
  | "string-list";

export interface ConsoleSettingDefinition {
  readonly key: string;
  readonly label: string;
  readonly kind: ConsoleSettingKind;
  /** Only a Location-overridable field may carry a Location override row. */
  readonly overridable: boolean;
}

export interface ResolvedInheritedSetting extends ConsoleSettingDefinition {
  readonly effectiveValue: ConsoleSettingValue;
  readonly source: "tenant" | "location";
  readonly tenantValue: ConsoleSettingValue;
  readonly locationOverride: ConsoleSettingValue | null;
}

/**
 * The Tenant-owned settings a Console operator edits, and which of them a
 * single venue may override. Ordering is the rendered order.
 */
export const CONSOLE_SETTING_DEFINITIONS: readonly ConsoleSettingDefinition[] = [
  { key: "locale", label: "Locale", kind: "locale", overridable: false },
  {
    key: "toneGuidelines",
    label: "Tone guidelines",
    kind: "text",
    overridable: false,
  },
  {
    key: "entryMode",
    label: "Entry mode",
    kind: "entry-mode",
    overridable: true,
  },
  {
    key: "requireDisclosure",
    label: "Review disclosure",
    kind: "boolean",
    overridable: true,
  },
  {
    key: "requireVerifiedExperience",
    label: "Require verified experience",
    kind: "boolean",
    overridable: true,
  },
  {
    key: "maxReviewFormatsPerRequest",
    label: "Review Formats per request",
    kind: "number",
    overridable: true,
  },
  {
    key: "bannedTerms",
    label: "Banned terms",
    kind: "string-list",
    overridable: true,
  },
  {
    key: "monthlyBudgetMicros",
    label: "Monthly budget",
    kind: "number",
    overridable: false,
  },
  {
    key: "alertThresholdPct",
    label: "Budget alert threshold",
    kind: "number",
    overridable: false,
  },
];

const overridableFields = new Set<string>(LOCATION_OVERRIDE_FIELDS);

export function isLocationOverridable(
  key: string,
): key is LocationOverrideField {
  return overridableFields.has(key);
}

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Projects one venue's settings. `locationOverride === null` is what makes the
 * Console able to say "Inherited from tenant" truthfully; it is the absence of
 * an override row, not a value that happens to equal the Tenant's.
 */
export function resolveInheritedSettings({
  tenantSettings,
  locationOverrides,
  definitions = CONSOLE_SETTING_DEFINITIONS,
}: {
  readonly tenantSettings: Readonly<Record<string, ConsoleSettingValue>>;
  readonly locationOverrides: Readonly<Record<string, unknown>>;
  readonly definitions?: readonly ConsoleSettingDefinition[] | undefined;
}): readonly ResolvedInheritedSetting[] {
  return definitions.flatMap((definition) => {
    const tenantValue = tenantSettings[definition.key];
    if (tenantValue === undefined) {
      return [];
    }
    const overridden =
      definition.overridable && hasOwn(locationOverrides, definition.key);
    const locationOverride = overridden
      ? (locationOverrides[definition.key] as ConsoleSettingValue)
      : null;
    return [
      {
        ...definition,
        tenantValue,
        locationOverride,
        effectiveValue: overridden
          ? (locationOverride as ConsoleSettingValue)
          : tenantValue,
        source: overridden ? ("location" as const) : ("tenant" as const),
      },
    ];
  });
}

export type OverrideMutation =
  | { readonly status: "rejected"; readonly code: "NOT_OVERRIDABLE" }
  | {
      readonly status: "applied";
      readonly overrides: Readonly<Record<string, unknown>>;
    };

export function applyLocationOverride({
  overrides,
  key,
  value,
}: {
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly key: string;
  readonly value: ConsoleSettingValue;
}): OverrideMutation {
  if (!isLocationOverridable(key)) {
    return { status: "rejected", code: "NOT_OVERRIDABLE" };
  }
  return {
    status: "applied",
    overrides: { ...overrides, [key]: value },
  };
}

/**
 * ADM-LOC-03's critical rule: reset removes the override key so the venue
 * follows later Tenant changes again. Copying the Tenant value in would
 * silently freeze the venue at today's value.
 */
export function clearLocationOverride({
  overrides,
  key,
}: {
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly key: string;
}): OverrideMutation {
  if (!isLocationOverridable(key)) {
    return { status: "rejected", code: "NOT_OVERRIDABLE" };
  }
  return {
    status: "applied",
    overrides: Object.fromEntries(
      Object.entries(overrides).filter(([name]) => name !== key),
    ),
  };
}
