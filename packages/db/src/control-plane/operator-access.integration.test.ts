import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { createPostgresOperatorAccessStore } from "./index.js";

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

describeDatabase("US-04.1 PostgreSQL Operator Access Grants", () => {
  it("resolves only current grants for the authenticated OIDC subject", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const operatorId = randomUUID();
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const issuer =
      "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_test";

    await runSql(`
      INSERT INTO operator_role_definitions (key, capabilities)
      VALUES ('tenant_admin', ARRAY['console:read', 'tenant:configure'])
      ON CONFLICT (key) DO UPDATE SET capabilities = EXCLUDED.capabilities;
      INSERT INTO operators (id, email, external_issuer, external_subject)
      VALUES ('${operatorId}', 'owner-${operatorId}@example.com', '${issuer}', 'subject-${operatorId}');
      BEGIN;
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      INSERT INTO tenants (id, slug, name, locale)
      VALUES ('${tenantId}', 'tenant-${tenantId}', 'Apex Dental', 'en-GB');
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES ('${locationId}', '${tenantId}', 'central', 'Central Clinic');
      INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key)
      VALUES ('${tenantId}', '${operatorId}', 'tenant_admin');
      COMMIT;
    `);

    const store = createPostgresOperatorAccessStore({ databaseUrl });
    try {
      await expect(
        store.resolveAccess({
          issuer,
          subject: `subject-${operatorId}`,
          email: `owner-${operatorId}@example.com`,
        }),
      ).resolves.toEqual({
        status: "authorized",
        operator: {
          id: operatorId,
          email: `owner-${operatorId}@example.com`,
        },
        platformGrants: [],
        tenantGrants: [
          {
            tenantId,
            tenantSlug: `tenant-${tenantId}`,
            tenantName: "Apex Dental",
            roleKey: "tenant_admin",
            capabilities: ["console:read", "tenant:configure"],
            locations: [
              {
                locationId,
                locationSlug: "central",
                locationName: "Central Clinic",
                status: "active",
              },
            ],
          },
        ],
      });

      await expect(
        store.resolveAccess({
          issuer,
          subject: "different-subject",
          email: `owner-${operatorId}@example.com`,
        }),
      ).resolves.toEqual({ status: "unauthorized" });

      await runSql(`
        UPDATE tenant_access_grants
        SET status = 'REVOKED', revoked_at = clock_timestamp()
        WHERE tenant_id = '${tenantId}'
          AND operator_id = '${operatorId}'
          AND role_key = 'tenant_admin';
      `);
      await expect(
        store.resolveAccess({
          issuer,
          subject: `subject-${operatorId}`,
          email: `owner-${operatorId}@example.com`,
        }),
      ).resolves.toEqual({ status: "unauthorized" });
    } finally {
      await store.disconnect();
    }
  });
});
