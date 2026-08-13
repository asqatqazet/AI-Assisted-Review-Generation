import { describe, expect, it } from "vitest";

import {
  resolveEntry,
  type EntryResolutionInput,
  type VenueDataLookup,
} from "./entry-resolver.js";

const mockVenueLookup: VenueDataLookup = {
  findTenantBySlug: (slug) =>
    slug === "apex-dental"
      ? { id: "tenant-apex", name: "Apex Dental", status: "ACTIVE" }
      : undefined,
  findLocationBySlug: (tenantId, slug) =>
    tenantId === "tenant-apex" && slug === "central"
      ? {
          id: "loc-central",
          name: "Central Clinic",
          status: "ACTIVE",
          entryMode: "invite",
        }
      : tenantId === "tenant-apex" && slug === "open-branch"
        ? {
            id: "loc-open",
            name: "Open Branch",
            status: "ACTIVE",
            entryMode: "open-qr",
          }
        : undefined,
  findVisitToken: (token) => {
    if (token === "valid-token-123") {
      return {
        id: "tok-1",
        visitId: "visit-1",
        tenantId: "tenant-apex",
        locationId: "loc-central",
        expiresAt: new Date(Date.now() + 3600_000),
        consumedAt: null,
      };
    }
    if (token === "expired-token-456") {
      return {
        id: "tok-2",
        visitId: "visit-2",
        tenantId: "tenant-apex",
        locationId: "loc-central",
        expiresAt: new Date(Date.now() - 3600_000),
        consumedAt: null,
      };
    }
    if (token === "consumed-token-789") {
      return {
        id: "tok-3",
        visitId: "visit-3",
        tenantId: "tenant-apex",
        locationId: "loc-central",
        expiresAt: new Date(Date.now() + 3600_000),
        consumedAt: new Date(Date.now() - 1000),
      };
    }
    return undefined;
  },
};

describe("TS-17 Entry Link Resolution", () => {
  it("resolves valid token for invite venue", () => {
    const input: EntryResolutionInput = {
      tenantSlug: "apex-dental",
      locationSlug: "central",
      visitToken: "valid-token-123",
      tableRef: "Table-4",
    };

    const result = resolveEntry(input, mockVenueLookup);
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.tenantId).toBe("tenant-apex");
      expect(result.locationId).toBe("loc-central");
      expect(result.visitId).toBe("visit-1");
      expect(result.tableRef).toBe("Table-4");
    }
  });

  it("distinguishes unknown tenant without leaking existence", () => {
    const input: EntryResolutionInput = {
      tenantSlug: "non-existent-tenant",
      locationSlug: "central",
    };

    const result = resolveEntry(input, mockVenueLookup);
    expect(result.status).toBe("unknown-tenant");
  });

  it("distinguishes unknown location without leaking existence", () => {
    const input: EntryResolutionInput = {
      tenantSlug: "apex-dental",
      locationSlug: "non-existent-loc",
    };

    const result = resolveEntry(input, mockVenueLookup);
    expect(result.status).toBe("unknown-location");
  });

  it("distinguishes expired token", () => {
    const input: EntryResolutionInput = {
      tenantSlug: "apex-dental",
      locationSlug: "central",
      visitToken: "expired-token-456",
    };

    const result = resolveEntry(input, mockVenueLookup);
    expect(result.status).toBe("expired-token");
  });

  it("distinguishes already-consumed token", () => {
    const input: EntryResolutionInput = {
      tenantSlug: "apex-dental",
      locationSlug: "central",
      visitToken: "consumed-token-789",
    };

    const result = resolveEntry(input, mockVenueLookup);
    expect(result.status).toBe("already-consumed-token");
  });

  it("distinguishes malformed / missing token on invite venue", () => {
    const input: EntryResolutionInput = {
      tenantSlug: "apex-dental",
      locationSlug: "central",
      visitToken: "non-existent-token",
    };

    const result = resolveEntry(input, mockVenueLookup);
    expect(result.status).toBe("malformed-token");
  });

  it("falls through to requires-verification when token is omitted on invite venue", () => {
    const input: EntryResolutionInput = {
      tenantSlug: "apex-dental",
      locationSlug: "central",
    };

    const result = resolveEntry(input, mockVenueLookup);
    expect(result.status).toBe("requires-verification");
  });

  it("resolves open-qr venue without visit token", () => {
    const input: EntryResolutionInput = {
      tenantSlug: "apex-dental",
      locationSlug: "open-branch",
    };

    const result = resolveEntry(input, mockVenueLookup);
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.tenantId).toBe("tenant-apex");
      expect(result.locationId).toBe("loc-open");
      expect(result.visitId).toBeNull();
    }
  });

  it("validates and sanitizes tableRef against pattern", () => {
    const validRef = resolveEntry(
      {
        tenantSlug: "apex-dental",
        locationSlug: "open-branch",
        tableRef: "Booth. 12",
      },
      mockVenueLookup,
    );
    expect(validRef.status).toBe("valid");
    if (validRef.status === "valid") {
      expect(validRef.tableRef).toBe("Booth. 12");
    }

    const invalidRef = resolveEntry(
      {
        tenantSlug: "apex-dental",
        locationSlug: "open-branch",
        tableRef: "<script>alert(1)</script>",
      },
      mockVenueLookup,
    );
    expect(invalidRef.status).toBe("valid");
    if (invalidRef.status === "valid") {
      expect(invalidRef.tableRef).toBeNull(); // Untrusted invalid tableRef sanitized to null
    }
  });
});
