import type {
  ConsoleBootstrapDto,
  ConsoleScopeRequestDto,
} from "@review/contracts/console";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export interface ConsoleScopeController {
  readonly scope: ConsoleScopeRequestDto;
  readonly tenant: ConsoleBootstrapDto["tenants"][number] | undefined;
  readonly locations: ConsoleBootstrapDto["tenants"][number]["locations"];
  selectTenant(tenantId: string | null): void;
  selectLocation(locationId: string | null): void;
  /** Keeps the current scope on every in-Console link. */
  href(path: string, extra?: Readonly<Record<string, string>>): string;
}

/**
 * Scope lives in the URL, not in a feature page's state: refreshing, sharing
 * or deep-linking a Console screen must reproduce the same scope.
 */
export function useConsoleScope(
  bootstrap: ConsoleBootstrapDto,
): ConsoleScopeController {
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTenantId = searchParams.get("tenantId");
  const requestedLocationId = searchParams.get("locationId");

  const tenant = useMemo(() => {
    if (requestedTenantId !== null) {
      return bootstrap.tenants.find(
        (candidate) => candidate.id === requestedTenantId,
      );
    }
    return bootstrap.activeContext.tenantId === null
      ? undefined
      : bootstrap.tenants.find(
          (candidate) => candidate.id === bootstrap.activeContext.tenantId,
        );
  }, [bootstrap, requestedTenantId]);

  const locations = tenant?.locations ?? [];
  const scope: ConsoleScopeRequestDto = {
    // Preserve explicit URL values until the server authorizes the pair. If
    // the client silently normalizes an unknown/crossed Location to null, the
    // screen becomes a distinguishable "select a Location" oracle instead of
    // receiving the generic not-found response.
    tenantId: requestedTenantId ?? tenant?.id ?? null,
    locationId:
      requestedLocationId ??
      (requestedTenantId === null ? bootstrap.activeContext.locationId : null),
  };

  const selectTenant = useCallback(
    (tenantId: string | null) => {
      const next = new URLSearchParams(searchParams);
      next.delete("locationId");
      if (tenantId === null) {
        next.delete("tenantId");
      } else {
        next.set("tenantId", tenantId);
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const selectLocation = useCallback(
    (locationId: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (locationId === null) {
        next.delete("locationId");
      } else {
        next.set("locationId", locationId);
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const href = useCallback(
    (path: string, extra: Readonly<Record<string, string>> = {}) => {
      const next = new URLSearchParams();
      if (scope.tenantId !== null) {
        next.set("tenantId", scope.tenantId);
      }
      if (scope.locationId !== null) {
        next.set("locationId", scope.locationId);
      }
      for (const [name, value] of Object.entries(extra)) {
        next.set(name, value);
      }
      const search = next.toString();
      return search === "" ? path : `${path}?${search}`;
    },
    [scope.tenantId, scope.locationId],
  );

  return { scope, tenant, locations, selectTenant, selectLocation, href };
}
