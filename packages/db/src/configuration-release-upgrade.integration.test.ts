import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const workspaceRoot = path.resolve(__dirname, "../../..");
const prisma = path.join(
  workspaceRoot,
  "packages/db/node_modules/.bin/prisma",
);
const schema = path.join(workspaceRoot, "packages/db/prisma/schema.prisma");
const migrations = path.join(workspaceRoot, "packages/db/prisma/migrations");
const releaseMigration = "20260824000034_configuration_release_pointers";

async function runSql(connectionUrl: string, statement: string): Promise<string> {
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
      statement,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

async function deployMigrations(
  connectionUrl: string,
  stagedSchema: string,
): Promise<void> {
  await execFileAsync(prisma, ["migrate", "deploy", "--schema", stagedSchema], {
    cwd: workspaceRoot,
    env: { ...process.env, DATABASE_URL: connectionUrl },
    maxBuffer: 4 * 1024 * 1024,
  });
}

describeDatabase.sequential("Configuration Release upgrade provenance", () => {
  let stagedRoot: string;
  let stagedSchema: string;
  let successfulUrl: string;
  let ambiguousUrl: string;
  let maintenanceUrl: string;
  const databaseNames: string[] = [];

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required");
    }
    stagedRoot = await mkdtemp(path.join(os.tmpdir(), "review-release-upgrade-"));
    stagedSchema = path.join(stagedRoot, "schema.prisma");
    const stagedMigrations = path.join(stagedRoot, "migrations");
    await cp(schema, stagedSchema);
    await cp(migrations, stagedMigrations, { recursive: true });
    for (const entry of await readdir(stagedMigrations)) {
      if (entry >= releaseMigration) {
        await rm(path.join(stagedMigrations, entry), {
          force: true,
          recursive: true,
        });
      }
    }

    const base = new URL(databaseUrl);
    base.pathname = "/postgres";
    maintenanceUrl = base.toString();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    databaseNames.push(
      `release_upgrade_ok_${suffix}`,
      `release_upgrade_bad_${suffix}`,
    );
    for (const name of databaseNames) {
      await runSql(maintenanceUrl, `CREATE DATABASE ${name};`);
    }
    const successful = new URL(databaseUrl);
    successful.pathname = `/${databaseNames[0]}`;
    successfulUrl = successful.toString();
    const ambiguous = new URL(databaseUrl);
    ambiguous.pathname = `/${databaseNames[1]}`;
    ambiguousUrl = ambiguous.toString();
    await deployMigrations(successfulUrl, stagedSchema);
    await deployMigrations(ambiguousUrl, stagedSchema);
  }, 120_000);

  afterAll(async () => {
    for (const name of databaseNames) {
      await runSql(maintenanceUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE);`);
    }
    if (stagedRoot !== undefined) {
      await rm(stagedRoot, { force: true, recursive: true });
    }
  });

  it("derives historical evidence, preserves closed unknowns, and binds old-binary inserts once", async () => {
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const evidencedSnapshotId = randomUUID();
    const liveSnapshotId = randomUUID();
    const nextSnapshotId = randomUUID();
    const evidencedSessionId = randomUUID();
    const unknownClosedSessionId = randomUUID();
    const openSessionId = randomUUID();
    const oldBinarySessionId = randomUUID();
    const reservationId = randomUUID();
    const nextReleaseId = randomUUID();
    await runSql(
      successfulUrl,
      `
        INSERT INTO tenants (id, slug, name, locale)
        VALUES ('${tenantId}', 'upgrade-${tenantId}', 'Upgrade Tenant', 'en-GB');
        INSERT INTO locations (id, tenant_id, slug, name)
        VALUES ('${locationId}', '${tenantId}', 'main', 'Main');
        INSERT INTO effective_configuration_snapshots (
          id, tenant_id, location_id, schema_version, content_hash, payload,
          provenance, created_at
        ) VALUES
          ('${evidencedSnapshotId}', '${tenantId}', '${locationId}', 2,
           'sha256:${"6".repeat(64)}',
           jsonb_build_object(
             'tenantId', '${tenantId}', 'locationId', '${locationId}',
             'snapshotId', '${evidencedSnapshotId}'
           ), '{}'::jsonb, clock_timestamp() - interval '2 hours'),
          ('${liveSnapshotId}', '${tenantId}', '${locationId}', 2,
           'sha256:${"7".repeat(64)}',
           jsonb_build_object(
             'tenantId', '${tenantId}', 'locationId', '${locationId}',
             'snapshotId', '${liveSnapshotId}'
           ), '{}'::jsonb, clock_timestamp() - interval '1 hour');
        INSERT INTO review_sessions (
          id, tenant_id, location_id, status, expires_at
        ) VALUES
          ('${evidencedSessionId}', '${tenantId}', '${locationId}', 'CLOSED',
           clock_timestamp() + interval '1 hour'),
          ('${unknownClosedSessionId}', '${tenantId}', '${locationId}', 'CLOSED',
           clock_timestamp() + interval '1 hour'),
          ('${openSessionId}', '${tenantId}', '${locationId}', 'OPEN',
           clock_timestamp() + interval '1 hour');
        INSERT INTO budget_reservations (
          id, tenant_id, location_id, review_session_id, snapshot_id,
          permit_jti, request_hash, action, reserved_micros, expires_at
        ) VALUES (
          '${reservationId}', '${tenantId}', '${locationId}',
          '${evidencedSessionId}', '${evidencedSnapshotId}',
          'permit-${reservationId}', 'request-${reservationId}', 'GENERATE', 0,
          clock_timestamp() + interval '1 hour'
        );
      `,
    );

    await execFileAsync(
      psql,
      [
        successfulUrl,
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "--single-transaction",
        "-f",
        path.join(migrations, releaseMigration, "migration.sql"),
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    await expect(
      runSql(
        successfulUrl,
        `SELECT string_agg(
           session.id::text || '=' || COALESCE(session.configuration_snapshot_id::text, 'unknown'),
           ',' ORDER BY session.id
         )
         FROM review_sessions AS session
         WHERE session.id IN (
           '${evidencedSessionId}'::uuid,
           '${unknownClosedSessionId}'::uuid,
           '${openSessionId}'::uuid
         );`,
      ),
    ).resolves.toBe(
      (
        [
        [evidencedSessionId, evidencedSnapshotId],
        [unknownClosedSessionId, "unknown"],
        [openSessionId, liveSnapshotId],
        ] as [string, string][]
      )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, snapshot]) => `${id}=${snapshot}`)
        .join(","),
    );

    await runSql(
      successfulUrl,
      `
        INSERT INTO review_sessions (id, tenant_id, location_id, expires_at)
        VALUES (
          '${oldBinarySessionId}', '${tenantId}', '${locationId}',
          clock_timestamp() + interval '1 hour'
        );
        INSERT INTO effective_configuration_snapshots (
          id, tenant_id, location_id, schema_version, content_hash, payload, provenance
        ) VALUES (
          '${nextSnapshotId}', '${tenantId}', '${locationId}', 2,
          'sha256:${"8".repeat(64)}',
          jsonb_build_object(
            'tenantId', '${tenantId}', 'locationId', '${locationId}',
            'snapshotId', '${nextSnapshotId}'
          ), '{}'::jsonb
        );
        SELECT public.register_configuration_release(
          '${nextReleaseId}'::uuid, ARRAY['${nextSnapshotId}'::uuid], NULL::uuid, true
        );
      `,
    );
    await expect(
      runSql(
        successfulUrl,
        `SELECT configuration_snapshot_id::text FROM review_sessions
         WHERE id = '${oldBinarySessionId}'::uuid;`,
      ),
    ).resolves.toBe(liveSnapshotId);
  }, 30_000);

  it("fails the upgrade atomically instead of guessing between conflicting persisted evidence", async () => {
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const firstSnapshotId = randomUUID();
    const secondSnapshotId = randomUUID();
    const reviewSessionId = randomUUID();
    const firstReservationId = randomUUID();
    const secondReservationId = randomUUID();
    await runSql(
      ambiguousUrl,
      `
        INSERT INTO tenants (id, slug, name, locale)
        VALUES ('${tenantId}', 'upgrade-${tenantId}', 'Ambiguous Tenant', 'en-GB');
        INSERT INTO locations (id, tenant_id, slug, name)
        VALUES ('${locationId}', '${tenantId}', 'main', 'Main');
        INSERT INTO effective_configuration_snapshots (
          id, tenant_id, location_id, schema_version, content_hash, payload,
          provenance, created_at
        ) VALUES
          ('${firstSnapshotId}', '${tenantId}', '${locationId}', 2,
           'sha256:${"9".repeat(64)}',
           jsonb_build_object(
             'tenantId', '${tenantId}', 'locationId', '${locationId}',
             'snapshotId', '${firstSnapshotId}'
           ), '{}'::jsonb, clock_timestamp() - interval '2 hours'),
          ('${secondSnapshotId}', '${tenantId}', '${locationId}', 2,
           'sha256:${"a".repeat(64)}',
           jsonb_build_object(
             'tenantId', '${tenantId}', 'locationId', '${locationId}',
             'snapshotId', '${secondSnapshotId}'
           ), '{}'::jsonb, clock_timestamp() - interval '1 hour');
        INSERT INTO review_sessions (id, tenant_id, location_id, status, expires_at)
        VALUES (
          '${reviewSessionId}', '${tenantId}', '${locationId}', 'OPEN',
          clock_timestamp() + interval '1 hour'
        );
        INSERT INTO budget_reservations (
          id, tenant_id, location_id, review_session_id, snapshot_id,
          permit_jti, request_hash, action, reserved_micros, expires_at
        ) VALUES
          ('${firstReservationId}', '${tenantId}', '${locationId}',
           '${reviewSessionId}', '${firstSnapshotId}',
           'permit-${firstReservationId}', 'request-${firstReservationId}',
           'GENERATE', 0, clock_timestamp() + interval '1 hour'),
          ('${secondReservationId}', '${tenantId}', '${locationId}',
           '${reviewSessionId}', '${secondSnapshotId}',
           'permit-${secondReservationId}', 'request-${secondReservationId}',
           'GENERATE', 0, clock_timestamp() + interval '1 hour');
      `,
    );
    await expect(
      execFileAsync(
        psql,
        [
          ambiguousUrl,
          "-X",
          "-q",
          "-v",
          "ON_ERROR_STOP=1",
          "--single-transaction",
          "-f",
          path.join(migrations, releaseMigration, "migration.sql"),
        ],
        { maxBuffer: 4 * 1024 * 1024 },
      ),
    ).rejects.toThrow(/REVIEW_SESSION_CONFIGURATION_SNAPSHOT_AMBIGUOUS/u);
    await expect(
      runSql(
        ambiguousUrl,
        `SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'review_sessions'
           AND column_name = 'configuration_snapshot_id';`,
      ),
    ).resolves.toBe("0");
  }, 30_000);
});
