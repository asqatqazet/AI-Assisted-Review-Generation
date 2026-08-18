/**
 * Console access rules. Grants are the only authority: nothing the browser
 * sends can widen a role, add a Tenant or reach Platform scope.
 */

export const CONSOLE_CAPABILITIES = [
  "console:read",
  "platform:admin",
  "provider:manage",
  "tenant:configure",
  "tenant:switch",
  "analytics:read",
  "ai:operate",
] as const;

export type ConsoleCapability = (typeof CONSOLE_CAPABILITIES)[number];

export interface ConsoleLocationGrant {
  readonly locationId: string;
  readonly locationSlug: string;
  readonly locationName: string;
  readonly status: "active" | "inactive";
}

export interface ConsoleTenantGrant {
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly tenantName: string;
  readonly roleKey: string;
  readonly capabilities: readonly string[];
  readonly locations: readonly ConsoleLocationGrant[];
}

export interface ConsolePlatformGrant {
  readonly roleKey: string;
  readonly capabilities: readonly string[];
}

export interface ConsoleGrants {
  readonly platformGrants: readonly ConsolePlatformGrant[];
  readonly tenantGrants: readonly ConsoleTenantGrant[];
}

export type ConsoleRole =
  | "tenant_operator"
  | "agency_operator"
  | "platform_admin";

export interface ConsoleCapabilities {
  readonly canAccessPlatform: boolean;
  readonly canSwitchTenant: boolean;
  readonly canManageLocations: boolean;
  readonly canManageConfiguration: boolean;
  readonly canViewAnalytics: boolean;
  readonly canManageAiOperations: boolean;
  readonly canManageProviders: boolean;
}

function platformCapabilities(grants: ConsoleGrants): ReadonlySet<string> {
  return new Set(grants.platformGrants.flatMap((grant) => [...grant.capabilities]));
}

function anyCapabilities(grants: ConsoleGrants): ReadonlySet<string> {
  return new Set([
    ...grants.platformGrants.flatMap((grant) => [...grant.capabilities]),
    ...grants.tenantGrants.flatMap((grant) => [...grant.capabilities]),
  ]);
}

export function deriveConsoleRole(grants: ConsoleGrants): ConsoleRole {
  if (platformCapabilities(grants).has("platform:admin")) {
    return "platform_admin";
  }
  return grants.tenantGrants.length > 1 ? "agency_operator" : "tenant_operator";
}

/**
 * Capabilities are derived from held capability keys, never from a role name
 * or an email domain, so a new role definition needs no frontend change.
 */
export function deriveConsoleCapabilities(
  grants: ConsoleGrants,
): ConsoleCapabilities {
  const held = anyCapabilities(grants);
  const canAccessPlatform = platformCapabilities(grants).has("platform:admin");
  return {
    canAccessPlatform,
    canSwitchTenant:
      canAccessPlatform ||
      held.has("tenant:switch") ||
      grants.tenantGrants.length > 1,
    canManageLocations: held.has("tenant:configure"),
    canManageConfiguration: held.has("tenant:configure"),
    canViewAnalytics: held.has("analytics:read"),
    canManageAiOperations: held.has("ai:operate"),
    canManageProviders: held.has("provider:manage"),
  };
}

export function mayReadConsole(grants: ConsoleGrants): boolean {
  return anyCapabilities(grants).has("console:read");
}

export interface ConsoleScopeRequest {
  readonly tenantId: string | null;
  readonly locationId: string | null;
}

export type ConsoleScopeAuthorization =
  | { readonly decision: "denied" }
  | { readonly decision: "platform" }
  | {
      readonly decision: "tenant";
      readonly tenantId: string;
      readonly source: "grant" | "platform";
    }
  | {
      readonly decision: "location";
      readonly tenantId: string;
      readonly locationId: string;
      readonly source: "grant" | "platform";
    };

/**
 * Resolves a requested scope against held Grants.
 *
 * A denial is deliberately shapeless: an unknown Tenant, another Tenant's
 * Location and an insufficient capability all produce the same `denied`, which
 * the transport renders as the not-found projection.
 */
export function authorizeConsoleScope({
  grants,
  request,
  requiredCapability,
}: {
  readonly grants: ConsoleGrants;
  readonly request: ConsoleScopeRequest;
  readonly requiredCapability?: ConsoleCapability | undefined;
}): ConsoleScopeAuthorization {
  if (!mayReadConsole(grants)) {
    return { decision: "denied" };
  }
  const isPlatformAdmin = platformCapabilities(grants).has("platform:admin");

  if (request.tenantId === null) {
    if (request.locationId !== null || !isPlatformAdmin) {
      return { decision: "denied" };
    }
    return holdsCapability(grants, null, requiredCapability)
      ? { decision: "platform" }
      : { decision: "denied" };
  }

  const tenantGrant = grants.tenantGrants.find(
    (grant) => grant.tenantId === request.tenantId,
  );
  if (tenantGrant === undefined && !isPlatformAdmin) {
    return { decision: "denied" };
  }
  if (!holdsCapability(grants, tenantGrant ?? null, requiredCapability)) {
    return { decision: "denied" };
  }
  const source = tenantGrant === undefined ? "platform" : "grant";

  if (request.locationId === null) {
    return { decision: "tenant", tenantId: request.tenantId, source };
  }
  if (
    tenantGrant !== undefined &&
    !tenantGrant.locations.some(
      (location) => location.locationId === request.locationId,
    )
  ) {
    return { decision: "denied" };
  }
  return {
    decision: "location",
    tenantId: request.tenantId,
    locationId: request.locationId,
    source,
  };
}

function holdsCapability(
  grants: ConsoleGrants,
  tenantGrant: ConsoleTenantGrant | null,
  requiredCapability: ConsoleCapability | undefined,
): boolean {
  if (requiredCapability === undefined) {
    return true;
  }
  if (platformCapabilities(grants).has(requiredCapability)) {
    return true;
  }
  if (requiredCapability === "platform:admin") {
    return false;
  }
  return tenantGrant !== null
    ? tenantGrant.capabilities.includes(requiredCapability)
    : false;
}
