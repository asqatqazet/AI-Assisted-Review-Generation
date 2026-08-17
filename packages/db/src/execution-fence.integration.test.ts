import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const psql = process.env.PSQL_BIN ?? "psql";
const describeDatabase = databaseUrl ? describe : describe.skip;

async function runSql(sql: string): Promise<string> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const { stdout } = await execFileAsync(
    psql,
    [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

interface SeededScope {
  readonly tenantId: string;
  readonly locationId: string;
  readonly reviewSessionId: string;
  readonly generationBatchId: string;
  readonly generationId: string;
  readonly permitJti: string;
}

async function seedScope(): Promise<SeededScope> {
  const tenantId = randomUUID();
  const locationId = randomUUID();
  const reviewSessionId = randomUUID();
  const snapshotId = randomUUID();
  const reservationId = randomUUID();
  const generationBatchId = randomUUID();
  const generationId = randomUUID();
  const permitJti = `child-${randomUUID()}`;

  await runSql(`
    INSERT INTO tenants (id, slug, name, locale)
    VALUES ('${tenantId}', 'tenant-${tenantId}', 'TDD Tenant', 'en-GB');
    INSERT INTO locations (id, tenant_id, slug, name)
    VALUES ('${locationId}', '${tenantId}', 'location-${locationId}', 'TDD Location');
    INSERT INTO review_sessions (
      id, tenant_id, location_id, status, expires_at
    ) VALUES (
      '${reviewSessionId}', '${tenantId}', '${locationId}', 'OPEN',
      clock_timestamp() + interval '1 hour'
    );
    INSERT INTO effective_configuration_snapshots (
      id, tenant_id, location_id, schema_version, content_hash, payload, provenance
    ) VALUES (
      '${snapshotId}', '${tenantId}', '${locationId}', 1,
      'snapshot-${snapshotId}', '{}'::jsonb, '{}'::jsonb
    );
    INSERT INTO budget_reservations (
      id, tenant_id, location_id, review_session_id, snapshot_id, permit_jti,
      request_hash, action, reserved_micros, expires_at
    ) VALUES (
      '${reservationId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
      '${snapshotId}', 'reservation-${reservationId}', 'request-${reservationId}',
      'GENERATE', 0, clock_timestamp() + interval '1 hour'
    );
    INSERT INTO generation_batches (
      id, tenant_id, location_id, review_session_id, snapshot_id,
      budget_reservation_id, idempotency_key, request_hash, action, normalized_input
    ) VALUES (
      '${generationBatchId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
      '${snapshotId}', '${reservationId}', 'idempotency-${generationBatchId}',
      'request-${generationBatchId}', 'GENERATE', '{}'::jsonb
    );
  `);

  return {
    tenantId,
    locationId,
    reviewSessionId,
    generationBatchId,
    generationId,
    permitJti,
  };
}

function tenantTransaction(tenantId: string, sql: string): string {
  return `
    BEGIN;
    SET LOCAL ROLE generation_svc;
    SET LOCAL app.tenant_id = '${tenantId}';
    ${sql}
    COMMIT;
  `;
}

describeDatabase("US-03.2 PostgreSQL execution fence", () => {
  it("prepares one scoped lease idempotently and exposes its status", async () => {
    const scope = await seedScope();
    const prepareSql = tenantTransaction(
      scope.tenantId,
      `SELECT outcome, lease_id FROM prepare_generation_lease(
        '${scope.tenantId}',
        '${scope.locationId}',
        '${scope.reviewSessionId}',
        '${scope.generationBatchId}',
        '${scope.generationId}',
        '${scope.permitJti}',
        clock_timestamp() + interval '1 minute'
      );`,
    );

    const first = await runSql(prepareSql);
    const second = await runSql(prepareSql);
    const leaseId = first.split("|").at(-1);

    expect(first).toContain("leased|");
    expect(second).toBe(`existing|${leaseId}`);

    const status = await runSql(
      tenantTransaction(
        scope.tenantId,
        `SELECT generation_lease_status(
          '${scope.tenantId}',
          '${scope.locationId}',
          '${scope.reviewSessionId}',
          '${scope.generationBatchId}',
          '${scope.generationId}',
          '${scope.permitJti}'
        );`,
      ),
    );
    expect(status).toBe("leased");
  });
});
