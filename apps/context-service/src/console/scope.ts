import type {
  ConsoleCommandDto,
  ConsoleQueryDto,
  ConsoleScopeDto,
  ConsoleScopeRequestDto,
} from "@review/contracts/console";
import type { OperatorAccessProjectionDto } from "@review/contracts/context";
import {
  authorizeConsoleScope,
  type ConsoleCapability,
} from "@review/domain/console";

import type {
  ConsoleControlPlaneStore,
  ConsoleScopeSelector,
} from "./store.port.js";

type AuthorizedAccess = Extract<
  OperatorAccessProjectionDto,
  { status: "authorized" }
>;

export type ScopeShape =
  | "none"
  | "tenant"
  | "location"
  | "platform"
  | "tenant-or-location"
  | "tenant-or-platform";

export interface ScopePolicy {
  readonly shape: ScopeShape;
  readonly capability?: ConsoleCapability | undefined;
}

/**
 * What each Console view needs before it may resolve. The read policy is
 * deliberately separate from the write policy below: seeing a venue's
 * configuration and changing it are different grants.
 */
export const QUERY_POLICIES: Readonly<
  Record<ConsoleQueryDto["view"], ScopePolicy>
> = {
  bootstrap: { shape: "none" },
  overview: { shape: "tenant-or-platform" },
  locations: { shape: "tenant" },
  "location-settings": { shape: "location" },
  "tenant-settings": { shape: "tenant" },
  distribution: { shape: "location" },
  "distribution-overview": { shape: "tenant" },
  destinations: { shape: "location" },
  context: { shape: "tenant" },
  keywords: { shape: "tenant" },
  styles: { shape: "tenant" },
  "style-detail": { shape: "tenant" },
  actions: { shape: "tenant" },
  prompts: { shape: "tenant", capability: "ai:operate" },
  "prompt-comparison": { shape: "tenant", capability: "ai:operate" },
  experiments: { shape: "tenant", capability: "ai:operate" },
  "bench-form": { shape: "tenant", capability: "ai:operate" },
  analytics: { shape: "tenant-or-platform", capability: "analytics:read" },
  "generation-detail": { shape: "tenant", capability: "analytics:read" },
  "platform-tenants": { shape: "platform", capability: "platform:admin" },
  "platform-providers": { shape: "platform", capability: "platform:admin" },
  "platform-styles": { shape: "platform", capability: "platform:admin" },
  "platform-settings": { shape: "platform", capability: "platform:admin" },
};

export const COMMAND_POLICIES: Readonly<
  Record<ConsoleCommandDto["command"], ScopePolicy>
> = {
  "create-location": { shape: "tenant", capability: "tenant:configure" },
  "update-location": { shape: "tenant", capability: "tenant:configure" },
  "save-tenant-settings": { shape: "tenant", capability: "tenant:configure" },
  "stage-configuration-changes": {
    shape: "tenant-or-location",
    capability: "tenant:configure",
  },
  "stage-platform-configuration-changes": { shape: "platform" },
  "set-location-override": { shape: "location", capability: "tenant:configure" },
  "reset-location-override": {
    shape: "location",
    capability: "tenant:configure",
  },
  "save-destination": { shape: "location", capability: "tenant:configure" },
  "republish-configuration": {
    shape: "location",
    capability: "tenant:configure",
  },
  "cancel-configuration-draft": {
    shape: "tenant-or-location",
    capability: "tenant:configure",
  },
  "publish-configuration": {
    shape: "tenant-or-location",
    capability: "tenant:configure",
  },
  "cancel-platform-configuration-draft": { shape: "platform" },
  "publish-platform-configuration": { shape: "platform" },
  "publish-context-version": { shape: "tenant", capability: "tenant:configure" },
  "create-keyword": { shape: "tenant", capability: "tenant:configure" },
  "update-keyword": { shape: "tenant", capability: "tenant:configure" },
  "reorder-keywords": { shape: "tenant", capability: "tenant:configure" },
  "delete-keyword": { shape: "tenant", capability: "tenant:configure" },
  "set-style-enablement": { shape: "tenant", capability: "tenant:configure" },
  "reorder-styles": { shape: "tenant", capability: "tenant:configure" },
  "validate-style": { shape: "tenant" },
  "set-action-enablement": { shape: "tenant", capability: "tenant:configure" },
  "create-prompt-version": { shape: "tenant", capability: "ai:operate" },
  "promote-prompt-version": { shape: "tenant", capability: "ai:operate" },
  "create-experiment": { shape: "tenant", capability: "ai:operate" },
  "start-experiment": { shape: "tenant", capability: "ai:operate" },
  "stop-experiment": { shape: "tenant", capability: "ai:operate" },
  "run-bench": { shape: "tenant", capability: "ai:operate" },
  "create-tenant": { shape: "platform", capability: "platform:admin" },
  "set-tenant-status": { shape: "platform", capability: "platform:admin" },
  "create-keyword-category": {
    shape: "tenant",
    capability: "tenant:configure",
  },
  "set-provider-routing": { shape: "platform", capability: "provider:manage" },
  "publish-price-rate": { shape: "platform", capability: "provider:manage" },
  "import-platform-style": { shape: "platform", capability: "platform:admin" },
  "save-platform-settings": { shape: "platform", capability: "platform:admin" },
};

export type ResolvedScope =
  | { readonly status: "denied" }
  | {
      readonly status: "resolved";
      readonly scope: ConsoleScopeDto;
      readonly selector: ConsoleScopeSelector;
      readonly tenantId: string | null;
      readonly locationId: string | null;
    };

/**
 * Turns a requested scope into an authorized one, or into a denial that the
 * transport renders as not-found. Resolution deliberately hits the store: a
 * Platform administrator naming a Tenant that does not exist and a Tenant
 * operator naming someone else's Tenant must be indistinguishable.
 */
export async function resolveConsoleScope({
  access,
  request,
  policy,
  store,
}: {
  readonly access: AuthorizedAccess;
  readonly request: ConsoleScopeRequestDto;
  readonly policy: ScopePolicy;
  readonly store: ConsoleControlPlaneStore;
}): Promise<ResolvedScope> {
  if (policy.shape === "none") {
    return {
      status: "resolved",
      scope: { type: "platform" },
      selector: { type: "platform" },
      tenantId: null,
      locationId: null,
    };
  }

  const authorization = authorizeConsoleScope({
    grants: access,
    request,
    requiredCapability: policy.capability,
  });
  if (authorization.decision === "denied") {
    return { status: "denied" };
  }

  if (authorization.decision === "platform") {
    return policy.shape === "platform" || policy.shape === "tenant-or-platform"
      ? {
          status: "resolved",
          scope: { type: "platform" },
          selector: { type: "platform" },
          tenantId: null,
          locationId: null,
        }
      : { status: "denied" };
  }

  if (policy.shape === "platform") {
    return { status: "denied" };
  }

  const tenant = await store.readTenant(authorization.tenantId);
  if (tenant === null) {
    return { status: "denied" };
  }
  const tenantSummary = {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
  };

  if (authorization.decision === "tenant") {
    return policy.shape === "location"
      ? { status: "denied" }
      : {
          status: "resolved",
          scope: { type: "tenant", tenant: tenantSummary },
          selector: { type: "tenant", tenantId: tenant.id },
          tenantId: tenant.id,
          locationId: null,
        };
  }

  const location = await store.readLocation(
    authorization.tenantId,
    authorization.locationId,
  );
  if (location === null) {
    return { status: "denied" };
  }

  if (policy.shape === "tenant" || policy.shape === "tenant-or-platform") {
    // A venue selection narrows a Tenant view; it never widens it.
    return {
      status: "resolved",
      scope:
        policy.shape === "tenant"
          ? { type: "tenant", tenant: tenantSummary }
          : {
              type: "location",
              tenant: tenantSummary,
              location: {
                id: location.id,
                slug: location.slug,
                name: location.name,
              },
            },
      selector:
        policy.shape === "tenant"
          ? { type: "tenant", tenantId: tenant.id }
          : { type: "location", tenantId: tenant.id, locationId: location.id },
      tenantId: tenant.id,
      locationId: location.id,
    };
  }

  return {
    status: "resolved",
    scope: {
      type: "location",
      tenant: tenantSummary,
      location: { id: location.id, slug: location.slug, name: location.name },
    },
    selector: {
      type: "location",
      tenantId: tenant.id,
      locationId: location.id,
    },
    tenantId: tenant.id,
    locationId: location.id,
  };
}
