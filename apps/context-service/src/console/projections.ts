import type {
  ConsoleActionsDto,
  ConsoleContextDto,
  ConsoleDistributionDto,
  ConsoleKeywordsDto,
  ConsoleLocationListDto,
  ConsoleLocationSettingsDto,
  ConsoleScopeDto,
  ConsoleStyleDetailDto,
  ConsoleStylesDto,
  ConsoleTenantSettingsDto,
} from "@review/contracts/console";
import {
  CONSOLE_SETTING_DEFINITIONS,
  qrIsUsableForEntryMode,
  renderQrSvg,
  resolveInheritedSettings,
  type ConsoleSettingValue,
} from "@review/domain/console";

import type {
  ConsoleActionRecord,
  ConsoleContextVersionRecord,
  ConsoleDistributionRecord,
  ConsoleLocationRecord,
  ConsoleStyleRecord,
  ConsoleTenantRecord,
} from "./store.port.js";

const PLATFORM_OWNED_SETTINGS = new Set(["logRetentionDays"]);

export function projectLocations({
  scope,
  tenant,
  locations,
  editable,
}: {
  readonly scope: ConsoleScopeDto;
  readonly tenant: ConsoleTenantRecord;
  readonly locations: readonly ConsoleLocationRecord[];
  readonly editable: boolean;
}): ConsoleLocationListDto {
  const tenantEntryMode = tenant.settings["entryMode"];
  return {
    scope,
    editable,
    locations: locations.map((location) => {
      const override = location.overrides["entryMode"];
      return {
        id: location.id,
        slug: location.slug,
        name: location.name,
        address: location.address,
        active: location.active,
        entryMode: (override ?? tenantEntryMode ?? "invite") as
          | "invite"
          | "open-qr"
          | "both",
        entryModeSource: override === undefined ? "tenant" : "location",
      };
    }),
  };
}

export function projectTenantSettings({
  scope,
  tenant,
  editable,
}: {
  readonly scope: ConsoleScopeDto;
  readonly tenant: ConsoleTenantRecord;
  readonly editable: boolean;
}): ConsoleTenantSettingsDto {
  return {
    scope,
    editable,
    settings: CONSOLE_SETTING_DEFINITIONS.flatMap((definition) => {
      const value = tenant.settings[definition.key];
      if (value === undefined) {
        return [];
      }
      const platformOwned = PLATFORM_OWNED_SETTINGS.has(definition.key);
      return [
        {
          key: definition.key,
          label: definition.label,
          kind: definition.kind,
          ownerScope: platformOwned ? ("platform" as const) : ("tenant" as const),
          value,
          platformDefault: null,
          editable: editable && !platformOwned,
        },
      ];
    }),
    keywordCategories: tenant.keywordCategories.map((category) => ({
      key: category.key,
      label: category.label,
      sortOrder: category.sortOrder,
    })),
  };
}

export function projectLocationSettings({
  scope,
  tenant,
  location,
  editable,
}: {
  readonly scope: ConsoleScopeDto;
  readonly tenant: ConsoleTenantRecord;
  readonly location: ConsoleLocationRecord;
  readonly editable: boolean;
}): ConsoleLocationSettingsDto {
  return {
    scope,
    editable,
    settings: resolveInheritedSettings({
      tenantSettings: tenant.settings as Readonly<
        Record<string, ConsoleSettingValue>
      >,
      locationOverrides: location.overrides,
    }).map((setting) => ({
      key: setting.key,
      label: setting.label,
      kind: setting.kind,
      ownerScope: "tenant" as const,
      effectiveValue: setting.effectiveValue as never,
      source: setting.source,
      tenantValue: setting.tenantValue as never,
      locationOverride: setting.locationOverride as never,
      overridable: setting.overridable,
    })),
  };
}

export function projectDistribution({
  scope,
  distribution,
}: {
  readonly scope: ConsoleScopeDto;
  readonly distribution: ConsoleDistributionRecord;
}): ConsoleDistributionDto {
  const qrUsable = qrIsUsableForEntryMode(distribution.entryMode);
  return {
    scope,
    liveUrl: distribution.surveyUrl,
    // The code carries no invitation token, so an invite-only venue would be
    // handed an asset that always refuses the person who scans it.
    qrSvg: qrUsable ? renderQrSvg(distribution.surveyUrl) : null,
    qrUnavailableReason: qrUsable
      ? null
      : "This venue admits invited reviewers only, so a scanned code cannot start a review. Change the entry mode to open-qr, or distribute invitation links instead.",
    entryMode: distribution.entryMode,
    // Open-QR admits anyone who scans, so it proves no visit occurred.
    verifiesVisit: distribution.entryMode !== "open-qr",
    invitationTemplate: distribution.invitationTemplate,
    tableQrCopy: distribution.tableQrCopy,
    counters: distribution.counters,
  };
}

export function projectContext({
  scope,
  versions,
  editable,
}: {
  readonly scope: ConsoleScopeDto;
  readonly versions: readonly ConsoleContextVersionRecord[];
  readonly editable: boolean;
}): ConsoleContextDto {
  const ordered = [...versions].sort((left, right) => right.version - left.version);
  const current = ordered[0];
  return {
    scope,
    editable,
    current:
      current === undefined
        ? null
        : {
            id: current.id,
            version: current.version,
            status: "published",
            createdAt: current.createdAt,
            createdBy: current.createdBy,
            context: current.context,
            bannedTerms: [...current.bannedTerms],
          },
    history: ordered.map((version) => ({
      id: version.id,
      version: version.version,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
    })),
  };
}

export function projectKeywords({
  scope,
  tenant,
  keywords,
  editable,
}: {
  readonly scope: ConsoleScopeDto;
  readonly tenant: ConsoleTenantRecord;
  readonly keywords: ConsoleKeywordsDto["keywords"];
  readonly editable: boolean;
}): ConsoleKeywordsDto {
  return {
    scope,
    editable,
    categories: tenant.keywordCategories.map((category) => ({
      key: category.key,
      label: category.label,
      sortOrder: category.sortOrder,
    })),
    keywords: [...keywords].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.label.localeCompare(right.label),
    ),
  };
}

/**
 * A style whose locale cannot serve the Tenant is listed but refused, with the
 * reason in operator language rather than a silently missing row.
 */
export function styleIncompatibility(
  style: ConsoleStyleRecord,
  tenantLocale: "en-GB" | "de-DE",
): string | null {
  if (style.locale !== "any" && style.locale !== tenantLocale) {
    return `This style is written for ${style.locale}; this account operates in ${tenantLocale}.`;
  }
  if (style.validationStatus === "invalid") {
    return "This style's manifest failed validation and cannot be enabled.";
  }
  return null;
}

export function projectStyles({
  scope,
  styles,
  tenantLocale,
  editable,
}: {
  readonly scope: ConsoleScopeDto;
  readonly styles: readonly ConsoleStyleRecord[];
  readonly tenantLocale: "en-GB" | "de-DE";
  readonly editable: boolean;
}): ConsoleStylesDto {
  return {
    scope,
    editable,
    tenantLocale,
    styles: [...styles]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((style) => projectStyleRow(style, tenantLocale)),
  };
}

function projectStyleRow(
  style: ConsoleStyleRecord,
  tenantLocale: "en-GB" | "de-DE",
): ConsoleStylesDto["styles"][number] {
  return {
    id: style.id,
    key: style.key,
    name: style.name,
    version: style.version,
    locale: style.locale,
    targetPlatform: style.targetPlatform,
    maxChars: style.maxChars,
    supportedActions: [...style.supportedActions],
    enabled: style.enabled,
    sortOrder: style.sortOrder,
    enabledActions: [...style.enabledActions],
    incompatibility: styleIncompatibility(style, tenantLocale),
  };
}

export function projectStyleDetail({
  scope,
  style,
  tenantLocale,
  validation,
}: {
  readonly scope: ConsoleScopeDto;
  readonly style: ConsoleStyleRecord;
  readonly tenantLocale: "en-GB" | "de-DE";
  readonly validation: ConsoleStyleDetailDto["validation"];
}): ConsoleStyleDetailDto {
  return {
    scope,
    style: projectStyleRow(style, tenantLocale),
    // Review Format manifests are Platform artefacts; Tenant scope reads them.
    manifestEditable: false,
    manifest: style.manifest,
    validation,
  };
}

export function projectActions({
  scope,
  actions,
  editable,
}: {
  readonly scope: ConsoleScopeDto;
  readonly actions: readonly ConsoleActionRecord[];
  readonly editable: boolean;
}): ConsoleActionsDto {
  const enabledEntryActions = actions.filter(
    (action) => action.isEntryAction && action.enabled,
  );
  return {
    scope,
    editable,
    actions: actions.map((action) => ({
      key: action.key,
      label: action.label,
      enabled: action.enabled,
      requiredInputs: [...action.requiredInputs],
      groundingRule: action.groundingRule,
      relativeCost: action.relativeCost,
      disableBlockedReason:
        action.isEntryAction &&
        action.enabled &&
        enabledEntryActions.length === 1
          ? "This is the last entry Action; disabling it would leave the Survey with no way to start."
          : null,
    })),
  };
}
