import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createPostgresOperatorAccessStore } from "./control-plane/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const authoritySecretHex = "ab".repeat(32);

const operatorProof = (operatorId: string, issuedAtMs: number, nonce: string) =>
  createHmac("sha256", Buffer.from(authoritySecretHex, "hex"))
    .update(`operator|${operatorId}|${issuedAtMs}|${nonce}`, "utf8")
    .digest("hex");

const asRole = (role: string): string => {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = "";
  return url.toString();
};

async function runSql(connectionUrl: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync(
    psql,
    [
      connectionUrl,
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

async function createPlatformAdminFixture(): Promise<{
  readonly operatorId: string;
  readonly unboundOperatorId: string;
}> {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const operatorId = randomUUID();
  const unboundOperatorId = randomUUID();
  const roleKey = `forged_admin_${operatorId.replaceAll("-", "")}`;
  await runSql(
    databaseUrl,
    `INSERT INTO operator_role_definitions (key, capabilities, status)
     VALUES ('${roleKey}', ARRAY['console:read', 'platform:admin'], 'ACTIVE');
     INSERT INTO operators (
       id, email, external_issuer, external_subject, status
     ) VALUES (
       '${operatorId}', 'admin-${operatorId}@example.test',
       'https://issuer.example.test', 'admin-${operatorId}', 'ACTIVE'
     ), (
       '${unboundOperatorId}', 'unbound-${unboundOperatorId}@example.test',
       NULL, NULL, 'ACTIVE'
     );
     INSERT INTO platform_access_grants (
       operator_id, role_key, status
     ) VALUES ('${operatorId}', '${roleKey}', 'ACTIVE');`,
  );
  return { operatorId, unboundOperatorId };
}

describeDatabase("Console database authority", () => {
  it("keeps a bounded legacy Context bridge for the alias rollback window", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const operatorId = randomUUID();
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const roleKey = `legacy_context_${operatorId.replaceAll("-", "")}`;
    await runSql(
      databaseUrl,
      `INSERT INTO operator_role_definitions (key, capabilities, status)
       VALUES ('${roleKey}', ARRAY['console:read'], 'ACTIVE');
       INSERT INTO operators (id, email, status)
       VALUES ('${operatorId}', 'legacy-${operatorId}@example.test', 'ACTIVE');
       INSERT INTO tenants (id, slug, name, locale)
       VALUES
         ('${tenantId}', 'legacy-${tenantId}', 'Legacy Tenant', 'en-GB'),
         ('${otherTenantId}', 'legacy-${otherTenantId}', 'Other Tenant', 'en-GB');
       INSERT INTO tenant_access_grants (
         tenant_id, operator_id, role_key, status
       ) VALUES ('${tenantId}', '${operatorId}', '${roleKey}', 'ACTIVE');`,
    );

    const legacyUrl = asRole("context_svc");
    await expect(
      runSql(
        databaseUrl,
        `SELECT concat_ws('|', rolsuper, rolbypassrls, rolinherit, rolcanlogin)
         FROM pg_roles WHERE rolname = 'context_svc';`,
      ),
    ).resolves.toBe("f|f|f|t");
    await expect(
      runSql(
        legacyUrl,
        `BEGIN;
         SET LOCAL app.operator_id = '${operatorId}';
         SET LOCAL app.tenant_id = '${tenantId}';
         SELECT
           review_operator_has_tenant_capability(
             '${tenantId}'::uuid, 'console:read'
           )::text || '|' ||
           (SELECT count(*) FROM tenants WHERE id = '${tenantId}'::uuid)::text || '|' ||
           (SELECT count(*) FROM tenants WHERE id = '${otherTenantId}'::uuid)::text;
         ROLLBACK;`,
      ),
    ).resolves.toBe("true|1|0");
    await expect(
      runSql(legacyUrl, "SELECT count(*) FROM console_database_authority_keys;"),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("does not treat a caller-controlled app.operator_id as an admin binding", async () => {
    const { operatorId } = await createPlatformAdminFixture();

    await expect(
      runSql(
        asRole("console_control_svc"),
        `WITH forged AS MATERIALIZED (
           SELECT set_config('app.operator_id', '${operatorId}', true)
         )
         SELECT review_operator_has_platform_capability('platform:admin')
         FROM forged;`,
      ),
    ).resolves.toBe("f");
  });

  it("cannot enumerate or rebind Operators through the base table", async () => {
    const { operatorId, unboundOperatorId } =
      await createPlatformAdminFixture();
    const consoleUrl = asRole("console_control_svc");

    await expect(
      runSql(consoleUrl, "SELECT count(*) FROM operators;"),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      runSql(
        consoleUrl,
        `BEGIN;
         SELECT set_config('app.operator_id', '${operatorId}', true);
         UPDATE operators
         SET external_issuer = 'https://attacker.example.test',
             external_subject = 'attacker'
         WHERE id = '${unboundOperatorId}';
         COMMIT;`,
      ),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("accepts one short-lived HMAC binding and rejects its replay", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const { operatorId } = await createPlatformAdminFixture();
    const issuedAtMs = Date.now();
    const nonce = randomUUID();
    const mac = operatorProof(operatorId, issuedAtMs, nonce);
    await runSql(
      databaseUrl,
      `INSERT INTO console_database_authority_keys (singleton, secret)
       VALUES (true, decode('${authoritySecretHex}', 'hex'))
       ON CONFLICT (singleton) DO UPDATE
       SET secret = EXCLUDED.secret, rotated_at = clock_timestamp();`,
    );

    await expect(
      runSql(
        asRole("console_control_svc"),
        `SELECT console_bind_operator_authorization(
          NULL, ${issuedAtMs}, '${nonce}', '${"0".repeat(64)}'
        );`,
      ),
    ).resolves.toBe("f");
    await expect(
      runSql(
        asRole("console_control_svc"),
        `BEGIN;
         SELECT console_bind_operator_authorization(
           '${operatorId}', ${issuedAtMs}, '${nonce}', '${mac}'
         );
         SELECT review_operator_has_platform_capability('platform:admin');
         COMMIT;`,
      ),
    ).resolves.toBe("t\nt");
    await expect(
      runSql(
        asRole("console_control_svc"),
        `SELECT console_bind_operator_authorization(
           '${operatorId}', ${issuedAtMs}, '${nonce}', '${mac}'
         );`,
      ),
    ).resolves.toBe("f");
  });

  it("lets the proof-carrying Console adapter resolve the exact OIDC identity", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const { operatorId } = await createPlatformAdminFixture();
    await runSql(
      databaseUrl,
      `INSERT INTO console_database_authority_keys (singleton, secret)
       VALUES (true, decode('${authoritySecretHex}', 'hex'))
       ON CONFLICT (singleton) DO UPDATE
       SET secret = EXCLUDED.secret, rotated_at = clock_timestamp();`,
    );
    const store = createPostgresOperatorAccessStore({
      databaseUrl: asRole("console_control_svc"),
      consoleDatabaseAuthoritySecret: authoritySecretHex,
    });
    try {
      await expect(
        store.resolveAccess({
          issuer: "https://issuer.example.test",
          subject: `admin-${operatorId}`,
          email: `admin-${operatorId}@example.test`,
        }),
      ).resolves.toMatchObject({
        status: "authorized",
        operator: { id: operatorId },
        platformGrants: [
          { capabilities: expect.arrayContaining(["platform:admin"]) },
        ],
      });
    } finally {
      await store.disconnect();
    }
  });
});
