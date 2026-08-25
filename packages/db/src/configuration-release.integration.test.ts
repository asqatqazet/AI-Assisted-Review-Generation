import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const authoritySecretHex = "cd".repeat(32);

const asRole = (role: string): string => {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = "";
  return url.toString();
};

const operatorProof = (operatorId: string, issuedAtMs: number, nonce: string) =>
  createHmac("sha256", Buffer.from(authoritySecretHex, "hex"))
    .update(`operator|${operatorId}|${issuedAtMs}|${nonce}`, "utf8")
    .digest("hex");

async function runSql(statement: string): Promise<string> {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  const { stdout } = await execFileAsync(psql, [
    databaseUrl,
    "-X",
    "-q",
    "-A",
    "-t",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ]);
  return stdout.trim();
}

async function runSqlAs(connectionUrl: string, statement: string): Promise<string> {
  const { stdout } = await execFileAsync(psql, [
    connectionUrl,
    "-X",
    "-q",
    "-A",
    "-t",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ]);
  return stdout.trim();
}

describeDatabase("immutable Configuration Releases", () => {
  it("stages by id, promotes with CAS, and restores through append-only compensation", async () => {
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const oldSnapshotId = randomUUID();
    const candidateSnapshotId = randomUUID();
    const oldReleaseId = randomUUID();
    const candidateReleaseId = randomUUID();
    const activationReleaseId = randomUUID();
    const secondActivationReleaseId = randomUUID();
    const emptyReleaseId = randomUUID();
    const emptyActivationReleaseId = randomUUID();
    const secondLocationId = randomUUID();
    const secondSnapshotId = randomUUID();
    const legacyReviewSessionId = randomUUID();

    await runSql(`
      INSERT INTO entry_mode_definitions (key, semantics)
      VALUES ('open-qr', '{}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO tenants (id, slug, name, locale, default_entry_mode_key)
      VALUES ('${tenantId}', 'release-${tenantId}', 'Release Tenant', 'en-GB', 'open-qr');
      INSERT INTO locations (id, tenant_id, slug, name, address)
      VALUES
        ('${locationId}', '${tenantId}', 'main', 'Main', '{}'::jsonb),
        ('${secondLocationId}', '${tenantId}', 'annex', 'Annex', '{}'::jsonb);
      INSERT INTO effective_configuration_snapshots (
        id, tenant_id, location_id, schema_version, content_hash, payload, provenance
      ) VALUES
        ('${oldSnapshotId}', '${tenantId}', '${locationId}', 2,
         'sha256:${"1".repeat(64)}', '{}'::jsonb, '{}'::jsonb),
        ('${candidateSnapshotId}', '${tenantId}', '${locationId}', 2,
         'sha256:${"2".repeat(64)}', '{}'::jsonb, '{}'::jsonb),
        ('${secondSnapshotId}', '${tenantId}', '${secondLocationId}', 2,
         'sha256:${"3".repeat(64)}', '{}'::jsonb, '{}'::jsonb);

      SELECT public.register_configuration_release(
        '${oldReleaseId}'::uuid,
        ARRAY['${oldSnapshotId}'::uuid],
        NULL::uuid,
        true
      );
      SELECT public.register_configuration_release(
        '${candidateReleaseId}'::uuid,
        ARRAY['${candidateSnapshotId}'::uuid],
        NULL::uuid,
        false
      );
      SELECT public.register_configuration_release(
        '${candidateReleaseId}'::uuid,
        ARRAY['${candidateSnapshotId}'::uuid],
        NULL::uuid,
        false
      );
      SELECT public.register_configuration_release(
        '${emptyReleaseId}'::uuid, ARRAY[]::uuid[], NULL::uuid, false
      );
      INSERT INTO review_sessions (id, tenant_id, location_id, expires_at)
      VALUES (
        '${legacyReviewSessionId}', '${tenantId}', '${locationId}',
        clock_timestamp() + interval '1 hour'
      );
    `);

    await expect(
      runSql(`SELECT public.register_configuration_release(
        '${candidateReleaseId}'::uuid,
        ARRAY['${candidateSnapshotId}'::uuid, '${secondSnapshotId}'::uuid],
        NULL::uuid,
        false
      );`),
    ).rejects.toThrow(/CONFIGURATION_RELEASE_ID_REUSED/u);
    await expect(
      runSql(`SELECT public.register_configuration_release(
        '${emptyReleaseId}'::uuid,
        ARRAY['${secondSnapshotId}'::uuid],
        NULL::uuid,
        false
      );`),
    ).rejects.toThrow(/CONFIGURATION_RELEASE_ID_REUSED/u);
    await expect(
      runSql(`SELECT
        public.promote_configuration_release('${emptyReleaseId}'::uuid, NULL::uuid)::text || '|' ||
        public.restore_configuration_release('${emptyReleaseId}'::uuid, NULL::uuid)::text || '|' ||
        public.activate_configuration_release(
          '${emptyActivationReleaseId}'::uuid,
          '${emptyReleaseId}'::uuid,
          NULL::uuid
        )::text;`),
    ).resolves.toBe("true|true|true");

    await expect(
      runSql(`
        SELECT
          public.resolve_configuration_snapshot(
            '${tenantId}'::uuid, '${locationId}'::uuid, NULL::uuid
          )::text || '|' ||
          public.resolve_configuration_snapshot(
            '${tenantId}'::uuid, '${locationId}'::uuid,
            '${candidateReleaseId}'::uuid
          )::text;
      `),
    ).resolves.toMatch(new RegExp(`${oldSnapshotId}\\|${candidateSnapshotId}$`, "u"));

    await runSql(
      `SELECT public.promote_configuration_release('${candidateReleaseId}'::uuid, NULL::uuid);`,
    );
    await expect(
      runSql(`SELECT public.resolve_configuration_snapshot(
        '${tenantId}'::uuid, '${locationId}'::uuid, NULL::uuid
      )::text;`),
    ).resolves.toBe(candidateSnapshotId);

    await runSql(
      `SELECT public.restore_configuration_release('${candidateReleaseId}'::uuid, NULL::uuid);`,
    );
    await expect(
      runSql(`
        SELECT
          public.resolve_configuration_snapshot(
            '${tenantId}'::uuid, '${locationId}'::uuid, NULL::uuid
          )::text || '|' ||
          (SELECT string_agg(kind::text, ',' ORDER BY occurred_at, id)
             FROM configuration_release_pointer_events
            WHERE release_id = '${candidateReleaseId}'::uuid) || '|' ||
          (SELECT configuration_snapshot_id::text
             FROM review_sessions
            WHERE id = '${legacyReviewSessionId}'::uuid);
      `),
    ).resolves.toBe(`${oldSnapshotId}|PROMOTE,RESTORE|${oldSnapshotId}`);

    await expect(
      runSql(
        `SELECT public.promote_configuration_release('${candidateReleaseId}'::uuid, NULL::uuid);`,
      ),
    ).rejects.toThrow(/CONFIGURATION_RELEASE_POINTER_CONFLICT/u);

    await runSql(
      `SELECT public.activate_configuration_release(
        '${activationReleaseId}'::uuid,
        '${candidateReleaseId}'::uuid,
        NULL::uuid
      );`,
    );
    await expect(
      runSql(`SELECT public.resolve_configuration_snapshot(
        '${tenantId}'::uuid, '${locationId}'::uuid, NULL::uuid
      )::text;`),
    ).resolves.toBe(candidateSnapshotId);
    await runSql(
      `SELECT public.restore_configuration_release('${activationReleaseId}'::uuid, NULL::uuid);`,
    );
    await expect(
      runSql(`SELECT public.resolve_configuration_snapshot(
        '${tenantId}'::uuid, '${locationId}'::uuid, NULL::uuid
      )::text;`),
    ).resolves.toBe(oldSnapshotId);

    await expect(
      runSql(
        `SELECT public.restore_configuration_release('${candidateReleaseId}'::uuid, NULL::uuid);`,
      ),
    ).rejects.toThrow(/CONFIGURATION_RELEASE_NOT_LIVE/u);

    await runSql(
      `SELECT public.activate_configuration_release(
        '${secondActivationReleaseId}'::uuid,
        '${candidateReleaseId}'::uuid,
        NULL::uuid
      );`,
    );
    await expect(
      runSql(
        `SELECT public.restore_configuration_release('${candidateReleaseId}'::uuid, NULL::uuid);`,
      ),
    ).rejects.toThrow(/CONFIGURATION_RELEASE_NOT_LIVE/u);
    await runSql(
      `SELECT public.restore_configuration_release('${secondActivationReleaseId}'::uuid, NULL::uuid);`,
    );
  });

  it("returns no foreign snapshot identifier and binds Console registration to its authenticated actor", async () => {
    const operatorId = randomUUID();
    const otherOperatorId = randomUUID();
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const snapshotId = randomUUID();
    const foreignTenantId = randomUUID();
    const foreignLocationId = randomUUID();
    const foreignSnapshotId = randomUUID();
    const roleKey = `release_configurer_${operatorId.replaceAll("-", "")}`;
    await runSql(`
      INSERT INTO console_database_authority_keys (singleton, secret)
      VALUES (true, decode('${authoritySecretHex}', 'hex'))
      ON CONFLICT (singleton) DO UPDATE
      SET secret = EXCLUDED.secret, rotated_at = clock_timestamp();
      INSERT INTO operator_role_definitions (key, capabilities, status)
      VALUES ('${roleKey}', ARRAY['tenant:configure'], 'ACTIVE');
      INSERT INTO operators (id, email, status)
      VALUES
        ('${operatorId}', 'release-${operatorId}@example.test', 'ACTIVE'),
        ('${otherOperatorId}', 'release-${otherOperatorId}@example.test', 'ACTIVE');
      INSERT INTO tenants (id, slug, name, locale)
      VALUES
        ('${tenantId}', 'release-${tenantId}', 'Owned Tenant', 'en-GB'),
        ('${foreignTenantId}', 'release-${foreignTenantId}', 'Foreign Tenant', 'en-GB');
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES
        ('${locationId}', '${tenantId}', 'owned', 'Owned'),
        ('${foreignLocationId}', '${foreignTenantId}', 'foreign', 'Foreign');
      INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key, status)
      VALUES ('${tenantId}', '${operatorId}', '${roleKey}', 'ACTIVE');
      INSERT INTO effective_configuration_snapshots (
        id, tenant_id, location_id, schema_version, content_hash, payload, provenance
      ) VALUES
        ('${snapshotId}', '${tenantId}', '${locationId}', 2,
         'sha256:${"4".repeat(64)}', '{}'::jsonb, '{}'::jsonb),
        ('${foreignSnapshotId}', '${foreignTenantId}', '${foreignLocationId}', 2,
         'sha256:${"5".repeat(64)}', '{}'::jsonb, '{}'::jsonb);
    `);

    const bind = (body: string): string => {
      const issuedAtMs = Date.now();
      const nonce = randomUUID();
      return `BEGIN;
        SELECT console_bind_operator_authorization(
          '${operatorId}', ${issuedAtMs}, '${nonce}',
          '${operatorProof(operatorId, issuedAtMs, nonce)}'
        );
        ${body}
        COMMIT;`;
    };
    const consoleUrl = asRole("console_control_svc");
    await expect(
      runSqlAs(
        consoleUrl,
        bind(`SELECT COALESCE(public.resolve_configuration_snapshot(
          '${foreignTenantId}'::uuid, '${foreignLocationId}'::uuid, NULL::uuid
        )::text, 'hidden');`),
      ),
    ).resolves.toBe("t\nhidden");
    await expect(
      runSqlAs(
        consoleUrl,
        bind(`SELECT public.register_configuration_release(
          '${randomUUID()}'::uuid, ARRAY['${foreignSnapshotId}'::uuid],
          '${operatorId}'::uuid, false
        );`),
      ),
    ).rejects.toThrow(/CONFIGURATION_RELEASE_SCOPE_FORBIDDEN/u);
    await expect(
      runSqlAs(
        consoleUrl,
        bind(`SELECT public.register_configuration_release(
          '${randomUUID()}'::uuid, ARRAY['${randomUUID()}'::uuid],
          '${operatorId}'::uuid, false
        );`),
      ),
    ).rejects.toThrow(/CONFIGURATION_RELEASE_SCOPE_FORBIDDEN/u);
    await expect(
      runSqlAs(
        consoleUrl,
        bind(`SELECT public.register_configuration_release(
          '${randomUUID()}'::uuid, ARRAY['${snapshotId}'::uuid],
          '${otherOperatorId}'::uuid, false
        );`),
      ),
    ).rejects.toThrow(/CONFIGURATION_RELEASE_ACTOR_FORBIDDEN/u);
  });
});
