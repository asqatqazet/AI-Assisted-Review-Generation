import { describe, expect, it } from "vitest";

import { withTenant } from "./tenant-context.js";

interface TestRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
}

class InvariantTenancyStore {
  readonly #records: TestRecord[] = [];

  public seed(records: readonly TestRecord[]): void {
    this.#records.push(...records);
  }

  public async findMany(
    contextTenantId: string | undefined,
  ): Promise<readonly TestRecord[]> {
    if (!contextTenantId) {
      return [];
    }
    return this.#records.filter((r) => r.tenantId === contextTenantId);
  }

  public async insert(
    contextTenantId: string | undefined,
    record: TestRecord,
  ): Promise<TestRecord> {
    if (!contextTenantId || contextTenantId !== record.tenantId) {
      throw new Error(
        `WITH CHECK policy violation: cannot insert record with tenantId '${record.tenantId}' into session '${contextTenantId}'`,
      );
    }
    this.#records.push(record);
    return record;
  }
}

describe("TS-06 Tenancy Isolation Test Suite", () => {
  it("isolates tenant data inside withTenant and prevents cross-tenant reads", async () => {
    const store = new InvariantTenancyStore();
    store.seed([
      { id: "loc-1", tenantId: "tenant-a", name: "Location A" },
      { id: "loc-2", tenantId: "tenant-b", name: "Location B" },
    ]);

    const tenantAResults = await withTenant("tenant-a", async (ctx) => {
      return await store.findMany(ctx.tenantId);
    });

    expect(tenantAResults).toHaveLength(1);
    expect(tenantAResults[0]?.tenantId).toBe("tenant-a");
    expect(tenantAResults[0]?.name).toBe("Location A");
  });

  it("returns zero rows when querying without an active tenant session", async () => {
    const store = new InvariantTenancyStore();
    store.seed([
      { id: "loc-1", tenantId: "tenant-a", name: "Location A" },
      { id: "loc-2", tenantId: "tenant-b", name: "Location B" },
    ]);

    const unauthenticatedResults = await store.findMany(undefined);
    expect(unauthenticatedResults).toHaveLength(0);
  });

  it("rejects mismatched tenant insertions with WITH CHECK violation", async () => {
    const store = new InvariantTenancyStore();

    await expect(
      withTenant("tenant-a", async (ctx) => {
        return await store.insert(ctx.tenantId, {
          id: "loc-bad",
          tenantId: "tenant-b", // Mismatched tenantId
          name: "Illegal Cross-Tenant Location",
        });
      }),
    ).rejects.toThrowError(/WITH CHECK policy violation/i);
  });

  it("rejects empty tenantId in withTenant", async () => {
    await expect(withTenant("", async () => "ok")).rejects.toThrowError(
      /valid non-empty tenantId/i,
    );
  });
});
