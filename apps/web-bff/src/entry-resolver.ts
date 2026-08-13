export interface EntryResolutionInput {
  readonly tenantSlug: string;
  readonly locationSlug: string;
  readonly visitToken?: string | undefined;
  readonly tableRef?: string | undefined;
}

export interface VenueTenant {
  readonly id: string;
  readonly name: string;
  readonly status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
}

export interface VenueLocation {
  readonly id: string;
  readonly name: string;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly entryMode: "open-qr" | "invite";
}

export interface VenueVisitToken {
  readonly id: string;
  readonly visitId: string;
  readonly tenantId: string;
  readonly locationId: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

export interface VenueDataLookup {
  findTenantBySlug(slug: string): VenueTenant | undefined;
  findLocationBySlug(tenantId: string, slug: string): VenueLocation | undefined;
  findVisitToken(token: string): VenueVisitToken | undefined;
}

export type EntryResolution =
  | { readonly status: "unknown-tenant" }
  | { readonly status: "unknown-location" }
  | { readonly status: "requires-verification" }
  | { readonly status: "malformed-token" }
  | { readonly status: "expired-token" }
  | { readonly status: "already-consumed-token" }
  | {
      readonly status: "valid";
      readonly tenantId: string;
      readonly locationId: string;
      readonly visitId: string | null;
      readonly tableRef: string | null;
    };

const TABLE_REF_PATTERN = /^[\w .-]{1,12}$/;

export function resolveEntry(
  input: EntryResolutionInput,
  lookup: VenueDataLookup,
  now: Date = new Date(),
): EntryResolution {
  const tenant = lookup.findTenantBySlug(input.tenantSlug);
  if (!tenant || tenant.status !== "ACTIVE") {
    return { status: "unknown-tenant" };
  }

  const location = lookup.findLocationBySlug(tenant.id, input.locationSlug);
  if (!location || location.status !== "ACTIVE") {
    return { status: "unknown-location" };
  }

  const sanitizedTableRef =
    input.tableRef && TABLE_REF_PATTERN.test(input.tableRef)
      ? input.tableRef
      : null;

  if (location.entryMode === "open-qr") {
    return {
      status: "valid",
      tenantId: tenant.id,
      locationId: location.id,
      visitId: null,
      tableRef: sanitizedTableRef,
    };
  }

  // Invite entryMode requires a valid token
  if (!input.visitToken || input.visitToken.trim().length === 0) {
    return { status: "requires-verification" };
  }

  const tokenRecord = lookup.findVisitToken(input.visitToken);
  if (
    !tokenRecord ||
    tokenRecord.tenantId !== tenant.id ||
    tokenRecord.locationId !== location.id
  ) {
    return { status: "malformed-token" };
  }

  if (tokenRecord.consumedAt !== null) {
    return { status: "already-consumed-token" };
  }

  if (tokenRecord.expiresAt.getTime() < now.getTime()) {
    return { status: "expired-token" };
  }

  return {
    status: "valid",
    tenantId: tenant.id,
    locationId: location.id,
    visitId: tokenRecord.visitId,
    tableRef: sanitizedTableRef,
  };
}
