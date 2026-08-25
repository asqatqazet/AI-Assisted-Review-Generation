import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

import { createPostgresOperatorAccessStore } from "./index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl ? describe : describe.skip;
const consoleDatabaseAuthoritySecret = "ab".repeat(32);

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

async function runSqlText(sql: string): Promise<string> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const { stdout } = await execFileAsync(
    psql,
    [databaseUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

async function runOperatorBootstrap(input: {
  readonly email: string;
  readonly issuer: string;
  readonly subject: string;
  readonly tenantId: string;
}): Promise<void> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  await execFileAsync(
    psql,
    [
      databaseUrl,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `operator_email=${input.email}`,
      "-v",
      `operator_issuer=${input.issuer}`,
      "-v",
      `operator_subject=${input.subject}`,
      "-v",
      `tenant_id=${input.tenantId}`,
      "-f",
      path.join(__dirname, "../../../../infra/aws/seed-operator-access.sql"),
    ],
    { maxBuffer: 1024 * 1024 },
  );
}

async function runTenantOperatorBootstrap(input: {
  readonly email: string;
  readonly issuer: string;
  readonly subject: string;
  readonly tenantId: string;
}): Promise<void> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  await execFileAsync(
    psql,
    [
      databaseUrl,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `operator_email=${input.email}`,
      "-v",
      `operator_issuer=${input.issuer}`,
      "-v",
      `operator_subject=${input.subject}`,
      "-v",
      `tenant_id=${input.tenantId}`,
      "-f",
      path.join(
        __dirname,
        "../../../../infra/aws/seed-tenant-operator-access.sql",
      ),
    ],
    { maxBuffer: 1024 * 1024 },
  );
}

describeDatabase("US-04.1 PostgreSQL Operator Access Grants", () => {
  beforeAll(async () => {
    await runSql(`
      INSERT INTO console_database_authority_keys (singleton, secret)
      VALUES (true, decode('${consoleDatabaseAuthoritySecret}', 'hex'))
      ON CONFLICT (singleton) DO UPDATE
      SET secret = EXCLUDED.secret, rotated_at = clock_timestamp();
    `);
  });

  it("ignores an active Access Grant whose Role Definition is inactive", async () => {
    const operatorId = randomUUID();
    const tenantId = randomUUID();
    const roleKey = `inactive_${operatorId}`;
    const issuer = "https://issuer.inactive-role.test";
    await runSql(`
      INSERT INTO operator_role_definitions (key, capabilities, status)
      VALUES ('${roleKey}', ARRAY['console:read', 'tenant:configure'], 'RETIRED');
      INSERT INTO operators (id, email, external_issuer, external_subject)
      VALUES ('${operatorId}', 'inactive-${operatorId}@example.com',
              '${issuer}', 'subject-${operatorId}');
      BEGIN;
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      INSERT INTO tenants (id, slug, name, locale)
      VALUES ('${tenantId}', 'inactive-${tenantId}', 'Inactive Role Tenant', 'en-GB');
      INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key)
      VALUES ('${tenantId}', '${operatorId}', '${roleKey}');
      COMMIT;
    `);

    const store = createPostgresOperatorAccessStore({
      databaseUrl: databaseUrl!,
      consoleDatabaseAuthoritySecret,
    });
    try {
      await expect(
        store.resolveAccess({
          issuer,
          subject: `subject-${operatorId}`,
          email: `inactive-${operatorId}@example.com`,
        }),
      ).resolves.toEqual({ status: "unauthorized" });
    } finally {
      await store.disconnect();
    }
  });

  it("never reactivates a revoked bootstrap Operator or either Access Grant", async () => {
    const operatorId = randomUUID();
    const tenantId = randomUUID();
    const email = `bootstrap-${operatorId}@example.com`;
    const issuer = "https://issuer.bootstrap.test";
    const subject = `subject-${operatorId}`;

    await runSql(`
      BEGIN;
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      INSERT INTO tenants (id, slug, name, locale)
      VALUES ('${tenantId}', 'bootstrap-${tenantId}', 'Bootstrap Tenant', 'en-GB');
      COMMIT;
    `);
    await runOperatorBootstrap({ email, issuer, subject, tenantId });
    await runSql(`
      UPDATE operators
      SET status = 'DISABLED'
      WHERE email = '${email}';
      UPDATE platform_access_grants
      SET status = 'REVOKED', revoked_at = clock_timestamp()
      WHERE operator_id = (SELECT id FROM operators WHERE email = '${email}');
      BEGIN;
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      UPDATE tenant_access_grants
      SET status = 'REVOKED', revoked_at = clock_timestamp()
      WHERE tenant_id = '${tenantId}'
        AND operator_id = (SELECT id FROM operators WHERE email = '${email}');
      COMMIT;
    `);

    await runOperatorBootstrap({ email, issuer, subject, tenantId });

    await expect(
      runSqlText(`
        SELECT concat_ws('|', operator.status, platform_grant.status, tenant_grant.status)
        FROM operators AS operator
        JOIN platform_access_grants AS platform_grant
          ON platform_grant.operator_id = operator.id
         AND platform_grant.role_key = 'platform_admin'
        JOIN tenant_access_grants AS tenant_grant
          ON tenant_grant.operator_id = operator.id
         AND tenant_grant.tenant_id = '${tenantId}'
         AND tenant_grant.role_key = 'tenant_admin'
        WHERE operator.email = '${email}';
      `),
    ).resolves.toBe("DISABLED|REVOKED|REVOKED");
  });

  it("bootstraps a Tenant-only Operator without creating a Platform Grant", async () => {
    const tenantId = randomUUID();
    const operatorId = randomUUID();
    const email = `tenant-only-${operatorId}@example.com`;
    const issuer = "https://issuer.tenant-only.test";
    const subject = `subject-${operatorId}`;

    await runSql(`
      BEGIN;
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      INSERT INTO tenants (id, slug, name, locale)
      VALUES ('${tenantId}', 'tenant-only-${tenantId}', 'Tenant-only Fixture', 'en-GB');
      COMMIT;
    `);
    await runTenantOperatorBootstrap({ email, issuer, subject, tenantId });

    const store = createPostgresOperatorAccessStore({
      databaseUrl: databaseUrl!,
      consoleDatabaseAuthoritySecret,
    });
    try {
      const access = await store.resolveAccess({ issuer, subject, email });
      expect(access).toMatchObject({
        status: "authorized",
        platformGrants: [],
        tenantGrants: [
          {
            tenantId,
            roleKey: "tenant_admin",
          },
        ],
      });
      await expect(
        runSqlText(`
          SELECT count(*)
          FROM platform_access_grants
          WHERE operator_id = (SELECT id FROM operators WHERE email = '${email}');
        `),
      ).resolves.toBe("0");
    } finally {
      await store.disconnect();
    }
  });

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

    const store = createPostgresOperatorAccessStore({
      databaseUrl,
      consoleDatabaseAuthoritySecret,
    });
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
