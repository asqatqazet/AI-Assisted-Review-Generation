import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  ConsoleScopeDeniedError,
  createPostgresConsoleControlPlaneStore,
} from "./index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl ? describe : describe.skip;

async function runSql(sql: string): Promise<void> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  await execFileAsync(
    psql,
    [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { maxBuffer: 1024 * 1024 },
  );
}

interface Fixture {
  readonly operatorId: string;
  readonly tenantId: string;
  readonly otherTenantId: string;
  readonly locationId: string;
}

async function seed(): Promise<Fixture> {
  const operatorId = randomUUID();
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const locationId = randomUUID();

  await runSql(`
    INSERT INTO operator_role_definitions (key, capabilities)
    VALUES ('tenant_admin', ARRAY['console:read', 'tenant:configure'])
    ON CONFLICT (key) DO UPDATE SET capabilities = EXCLUDED.capabilities;
    INSERT INTO operators (id, email, external_issuer, external_subject)
    VALUES ('${operatorId}', 'console-${operatorId}@example.com',
            'https://issuer.test', 'subject-${operatorId}');
    INSERT INTO entry_mode_definitions (key, semantics)
    VALUES ('invite', '{}'::jsonb)
    ON CONFLICT (key) DO NOTHING;

    BEGIN;
    SELECT set_config('app.tenant_id', '${tenantId}', true);
    INSERT INTO tenants (id, slug, name, locale, category, monthly_budget_micros, default_entry_mode_key)
    VALUES ('${tenantId}', 'tenant-${tenantId}', 'BrightSmile', 'en-GB', 'Dental', 1000000, 'invite');
    INSERT INTO locations (id, tenant_id, slug, name)
    VALUES ('${locationId}', '${tenantId}', 'downtown', 'Downtown');
    INSERT INTO fact_option_categories (tenant_id, key, label, sort_order)
    VALUES ('${tenantId}', 'service', '{"en-GB":"Service"}'::jsonb, 0);
    INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key)
    VALUES ('${tenantId}', '${operatorId}', 'tenant_admin');
    COMMIT;

    BEGIN;
    SELECT set_config('app.tenant_id', '${otherTenantId}', true);
    INSERT INTO tenants (id, slug, name, locale)
    VALUES ('${otherTenantId}', 'tenant-${otherTenantId}', 'Someone Else', 'de-DE');
    COMMIT;
  `);

  return { operatorId, tenantId, otherTenantId, locationId };
}

describeDatabase("EP-04 Console control-plane store", () => {
  it("reads a granted Tenant and refuses another Tenant through RLS", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      const operations = store.forOperator(fixture.operatorId);

      await expect(operations.readTenant(fixture.tenantId)).resolves.toMatchObject(
        { slug: `tenant-${fixture.tenantId}`, name: "BrightSmile", locale: "en-GB" },
      );

      // The operator holds no Grant here; RLS must hide it entirely.
      await expect(
        operations.readTenant(fixture.otherTenantId),
      ).resolves.toBeNull();
    } finally {
      await store.disconnect();
    }
  });

  it("publishes a business context version instead of rewriting one", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.publishContextVersion({
        tenantId: fixture.tenantId,
        version: 1,
        context: "Family dental practice.",
        bannedTerms: ["painless"],
        createdBy: fixture.operatorId,
      });
      await operations.publishContextVersion({
        tenantId: fixture.tenantId,
        version: 2,
        context: "Family dental practice. Two surgeries.",
        bannedTerms: ["painless", "guaranteed"],
        createdBy: fixture.operatorId,
      });

      const versions = await operations.listContextVersions(fixture.tenantId);

      expect(versions.map((version) => version.version)).toEqual([2, 1]);
      expect(versions[1]?.context).toBe("Family dental practice.");
    } finally {
      await store.disconnect();
    }
  });

  it("refuses a duplicate Location slug inside one Tenant", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      const address = {
        line1: "1 High Street",
        line2: "",
        postalCode: "BS1 1AA",
        city: "Bristol",
        country: "GB",
      };

      await expect(
        operations.createLocation({
          tenantId: fixture.tenantId,
          name: "Downtown Annexe",
          slug: "downtown",
          address,
          entryMode: null,
        }),
      ).resolves.toEqual({ status: "slug-taken" });

      await expect(
        operations.createLocation({
          tenantId: fixture.tenantId,
          name: "Harbour",
          slug: "harbour",
          address,
          entryMode: "open-qr",
        }),
      ).resolves.toEqual({ status: "created" });
    } finally {
      await store.disconnect();
    }
  });

  it("stores a Location override and removes it again on reset", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      const operations = store.forOperator(fixture.operatorId);

      await operations.writeLocationOverrides({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
        overrides: { requireDisclosure: false },
      });
      await expect(
        operations.readLocation(fixture.tenantId, fixture.locationId),
      ).resolves.toMatchObject({ overrides: { requireDisclosure: false } });

      await operations.writeLocationOverrides({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
        overrides: {},
      });
      const location = await operations.readLocation(
        fixture.tenantId,
        fixture.locationId,
      );
      expect(Object.hasOwn(location!.overrides, "requireDisclosure")).toBe(false);
    } finally {
      await store.disconnect();
    }
  });

  it("builds the distribution link from the venue's own slugs", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      const distribution = await store
        .forOperator(fixture.operatorId)
        .readDistribution(
          fixture.tenantId,
          fixture.locationId,
          "https://review.example.test",
        );

      expect(distribution?.surveyUrl).toBe(
        `https://review.example.test/s/tenant-${fixture.tenantId}/downtown`,
      );
      expect(distribution?.counters).toEqual({
        issued: 0,
        opened: 0,
        completed: 0,
      });
    } finally {
      await store.disconnect();
    }
  });

  it("publishes a Fact Option and edits it as a new version", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      const operations = store.forOperator(fixture.operatorId);

      await expect(
        operations.createKeyword({
          tenantId: fixture.tenantId,
          locationId: null,
          label: "Friendly staff",
          categoryKey: "service",
          polarity: "positive",
        }),
      ).resolves.toEqual({ status: "created" });

      await expect(
        operations.createKeyword({
          tenantId: fixture.tenantId,
          locationId: null,
          label: "Friendly staff",
          categoryKey: "not-a-category",
          polarity: "positive",
        }),
      ).resolves.toEqual({ status: "unknown-category" });

      const [created] = await operations.listKeywords(fixture.tenantId, null);
      expect(created).toMatchObject({
        label: "Friendly staff",
        ownerScope: "tenant",
        active: true,
      });

      await operations.updateKeyword({
        tenantId: fixture.tenantId,
        keywordId: created!.id,
        label: "Consistently friendly staff",
        polarity: "positive",
        active: true,
      });

      const live = await operations.listKeywords(fixture.tenantId, null);
      expect(live).toHaveLength(1);
      expect(live[0]?.label).toBe("Consistently friendly staff");
      expect(live[0]?.id).not.toBe(created!.id);
    } finally {
      await store.disconnect();
    }
  });

  it("refuses to write into a Tenant the operator holds no Grant for", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      // A read degrades to the empty projection; a write must not quietly
      // succeed against someone else's account.
      await expect(
        store.forOperator(fixture.operatorId).createLocation({
          tenantId: fixture.otherTenantId,
          name: "Not mine",
          slug: "not-mine",
          address: {
            line1: "",
            line2: "",
            postalCode: "",
            city: "",
            country: "",
          },
          entryMode: null,
        }),
      ).rejects.toBeInstanceOf(ConsoleScopeDeniedError);

      await expect(
        store.forOperator(fixture.operatorId).listLocations(fixture.otherTenantId),
      ).resolves.toEqual([]);
    } finally {
      await store.disconnect();
    }
  });

  it("keeps Platform-only projections empty for a Tenant operator", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      // The service refuses this scope first; the store refuses it again.
      await expect(
        store.forOperator(fixture.operatorId).listPlatformTenants(),
      ).resolves.toEqual([]);
    } finally {
      await store.disconnect();
    }
  });

  it("provisions and suspends an account from Platform scope", async () => {
    const fixture = await seed();
    await runSql(`
      INSERT INTO platform_access_grants (operator_id, role_key)
      VALUES ('${fixture.operatorId}', 'platform_admin')
      ON CONFLICT (operator_id, role_key) DO NOTHING;
      INSERT INTO operator_role_definitions (key, capabilities)
      VALUES ('platform_admin', ARRAY['console:read', 'platform:admin'])
      ON CONFLICT (key) DO UPDATE SET capabilities = EXCLUDED.capabilities;
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      const slug = `provisioned-${fixture.tenantId}`;

      // Platform scope sets no app.tenant_id, so this INSERT is exactly the
      // one Row-Level Security used to reject.
      await expect(
        operations.createTenant({
          name: "Provisioned Account",
          slug,
          locale: "en-GB",
          category: "Dental",
          plan: "growth",
        }),
      ).resolves.toEqual({ status: "created" });

      const created = (await operations.listPlatformTenants()).find(
        (tenant) => tenant.slug === slug,
      );
      expect(created).toMatchObject({ status: "active", suspendable: true });

      await expect(
        operations.setTenantStatus({
          tenantId: created!.id,
          status: "suspended",
        }),
      ).resolves.toEqual({ status: "saved" });

      expect(
        (await operations.listPlatformTenants()).find(
          (tenant) => tenant.slug === slug,
        ),
      ).toMatchObject({ status: "suspended" });
    } finally {
      await store.disconnect();
    }
  });

  it("refuses account provisioning to an operator without a Platform Grant", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: databaseUrl!,
    });
    try {
      await expect(
        store.forOperator(fixture.operatorId).createTenant({
          name: "Not Allowed",
          slug: `not-allowed-${fixture.tenantId}`,
          locale: "en-GB",
          category: "",
          plan: "lite",
        }),
      ).rejects.toBeInstanceOf(ConsoleScopeDeniedError);
    } finally {
      await store.disconnect();
    }
  });
});
