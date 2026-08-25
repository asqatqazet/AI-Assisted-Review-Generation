import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { createPostgresConsoleExecutionAuthorizationStore } from "./control-plane/index.js";
import { createPostgresConsoleExecutionProjectionStore } from "./execution-plane/index.js";
import { databaseUrlForTestRole } from "./test-support/database-role-url.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const disconnectors: Array<() => Promise<void>> = [];
const consoleDatabaseAuthoritySecret = "ab".repeat(32);

const asRole = (role: string): string => {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  return databaseUrlForTestRole({ databaseUrl, role });
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

afterEach(async () => {
  await Promise.all(disconnectors.splice(0).map(async (disconnect) => disconnect()));
});

describeDatabase("exact PostgreSQL runtime capabilities", () => {
  it("uses three non-inheriting service logins and exposes only fixed runtime operations", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    await expect(
      runSql(
        databaseUrl,
        `SELECT string_agg(
           concat_ws('|', rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin),
           E'\\n' ORDER BY rolname
         )
         FROM pg_roles
         WHERE rolname IN (
           'console_control_svc', 'context_runtime_svc', 'generation_svc'
         );`,
      ),
    ).resolves.toBe(
      [
        "console_control_svc|f|f|f|t",
        "context_runtime_svc|f|f|f|t",
        "generation_svc|f|f|f|t",
      ].join("\n"),
    );

    const runtimeUrl = asRole("context_runtime_svc");
    await expect(runSql(runtimeUrl, "SELECT current_user;")).resolves.toBe(
      "context_runtime_svc",
    );
    await expect(
      runSql(runtimeUrl, "SELECT count(*) FROM review_session_browser_bindings;"),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      runSql(runtimeUrl, "SELECT count(*) FROM reconciliation_queue_items;"),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      runSql(
        runtimeUrl,
        `SELECT count(*) FROM lookup_live_review_session_browser_binding(
          'sha256:missing-route', 'sha256:missing-browser'
        );`,
      ),
    ).resolves.toBe("0");
    await expect(
      runSql(
        runtimeUrl,
        `SELECT count(*) FROM claim_due_reconciliation_queue(
          '${randomUUID()}'::uuid, 1
        );`,
      ),
    ).resolves.toBe("0");
    await expect(
      runSql(
        runtimeUrl,
        `SELECT count(*) FROM claim_due_reconciliation_queue(
          '${randomUUID()}'::uuid, 101
        );`,
      ),
    ).rejects.toThrow(/claim limit is invalid/iu);

    const generationUrl = asRole("generation_svc");
    await expect(
      runSql(
        generationUrl,
        `SELECT count(*) FROM lookup_live_review_session_browser_binding(
          'sha256:missing-route', 'sha256:missing-browser'
        );`,
      ),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("requires a DB-minted authorization before Generation can read a projection", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const operatorId = randomUUID();
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const otherTenantId = randomUUID();
    const otherLocationId = randomUUID();
    const reviewSessionId = randomUUID();
    const snapshotId = randomUUID();
    const reservationId = randomUUID();
    const generationBatchId = randomUUID();
    const generationId = randomUUID();
    const executionLeaseId = randomUUID();
    const promptVersionId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    const promptContentHash = `sha256:${generationId.replaceAll("-", "").repeat(2)}`;
    const roleKey = `runtime_reader_${operatorId.replaceAll("-", "")}`;
    await runSql(
      databaseUrl,
      `INSERT INTO console_database_authority_keys (singleton, secret)
       VALUES (true, decode('${consoleDatabaseAuthoritySecret}', 'hex'))
       ON CONFLICT (singleton) DO UPDATE SET secret = EXCLUDED.secret;
       INSERT INTO operator_role_definitions (key, capabilities, status)
       VALUES ('${roleKey}', ARRAY['console:read', 'analytics:read'], 'ACTIVE');
       INSERT INTO operators (id, email, status)
       VALUES ('${operatorId}', 'runtime-${operatorId}@example.test', 'ACTIVE');
       INSERT INTO tenants (id, slug, name, locale)
       VALUES
         ('${tenantId}', 'runtime-${tenantId}', 'Runtime Tenant', 'en-GB'),
         ('${otherTenantId}', 'runtime-${otherTenantId}', 'Other Tenant', 'en-GB');
       INSERT INTO locations (id, tenant_id, slug, name, status)
       VALUES
         ('${locationId}', '${tenantId}', 'runtime-location', 'Runtime Location', 'ACTIVE'),
         ('${otherLocationId}', '${otherTenantId}', 'other-location', 'Other Location', 'ACTIVE');
       INSERT INTO tenant_access_grants (
         tenant_id, operator_id, role_key, status
       ) VALUES ('${tenantId}', '${operatorId}', '${roleKey}', 'ACTIVE');
       INSERT INTO review_format_versions (
         id, format_key, version, locale, target_platform, constraints,
         localized_text, supported_actions, content_hash
       ) VALUES (
         '${reviewFormatVersionId}', 'runtime-${reviewFormatVersionId}', 1,
         'en-GB', 'google', '{}'::jsonb, '{}'::jsonb,
         ARRAY['GENERATE']::generation_action[],
         'format-${reviewFormatVersionId}'
       );
       INSERT INTO prompt_versions (
         id, tenant_id, prompt_key, action, content_hash, body, variables
       ) VALUES (
         '${promptVersionId}', '${tenantId}', 'runtime-${promptVersionId}',
         'GENERATE', '${promptContentHash}', 'Write a review.', ARRAY[]::text[]
       );
       INSERT INTO effective_configuration_snapshots (
         id, tenant_id, location_id, schema_version, content_hash, payload, provenance
       ) VALUES (
         '${snapshotId}', '${tenantId}', '${locationId}', 2,
         'snapshot-${snapshotId}',
         '{"tenantName":"Runtime Tenant","locationName":"Runtime Location"}'::jsonb,
         '{}'::jsonb
       );
       INSERT INTO review_sessions (
         id, tenant_id, location_id, configuration_snapshot_id, status, expires_at
       ) VALUES (
         '${reviewSessionId}', '${tenantId}', '${locationId}', '${snapshotId}', 'OPEN',
         clock_timestamp() + interval '2 hours'
       );
       INSERT INTO budget_reservations (
         id, tenant_id, location_id, review_session_id, snapshot_id, permit_jti,
         request_hash, action, reserved_micros, expires_at
       ) VALUES (
         '${reservationId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
         '${snapshotId}', 'permit-${reservationId}', 'request-${reservationId}',
         'GENERATE', 0, clock_timestamp() + interval '2 hours'
       );
       INSERT INTO generation_batches (
         id, tenant_id, location_id, review_session_id, snapshot_id,
         budget_reservation_id, idempotency_key, request_hash, action,
         normalized_input
       ) VALUES (
         '${generationBatchId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
         '${snapshotId}', '${reservationId}', 'batch-${generationBatchId}',
         'request-${generationBatchId}', 'GENERATE', '{}'::jsonb
       );
       INSERT INTO execution_leases (
         id, tenant_id, location_id, review_session_id, generation_batch_id,
         generation_id, permit_jti, permit_expires_at, lease_expires_at,
         state, running_at, terminal_at
       ) VALUES (
         '${executionLeaseId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
         '${generationBatchId}', '${generationId}', 'lease-${executionLeaseId}',
         clock_timestamp() + interval '2 hours',
         clock_timestamp() + interval '1 hour', 'TERMINAL',
         clock_timestamp(), clock_timestamp()
       );
       INSERT INTO generations (
         id, tenant_id, location_id, review_session_id, generation_batch_id,
         execution_lease_id, snapshot_id, prompt_version_id,
         review_format_version_id, action, status, grounded_output,
         grounding_verdict, policy_result
       ) VALUES (
         '${generationId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
         '${generationBatchId}', '${executionLeaseId}', '${snapshotId}',
         '${promptVersionId}', '${reviewFormatVersionId}', 'GENERATE', 'SUCCEEDED',
         'A grounded review.', 'PASSED', '{"violations":[]}'::jsonb
       );`,
    );

    const authority = createPostgresConsoleExecutionAuthorizationStore({
      databaseUrl: asRole("console_control_svc"),
      consoleDatabaseAuthoritySecret,
    });
    const projection = createPostgresConsoleExecutionProjectionStore({
      databaseUrl: asRole("generation_svc"),
    });
    disconnectors.push(authority.disconnect, projection.disconnect);
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const authorization = await authority.mint({
      operatorId,
      scope: { type: "location", tenantId, locationId },
      query: { view: "overview", from, to },
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    expect(authorization).toMatchObject({ readMode: "redacted" });
    if (authorization === null) {
      throw new Error("expected the database to mint an authorization");
    }
    await expect(
      projection.readOverview(authorization.authorizationId),
    ).resolves.toMatchObject({
      status: "overview",
      data: {
        metrics: { generations: 1 },
        byTenant: [
          {
            subject: {
              id: tenantId,
              name: "Runtime Tenant",
              slug: `runtime-${tenantId}`,
            },
          },
        ],
        byLocation: [
          {
            subject: {
              id: locationId,
              name: "Runtime Location",
              slug: "runtime-location",
            },
          },
        ],
      },
    });

    await expect(
      authority.mint({
        operatorId,
        scope: { type: "location", tenantId, locationId: otherLocationId },
        query: { view: "overview", from, to },
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    ).resolves.toBeNull();

    const generationUrl = asRole("generation_svc");
    await expect(
      runSql(
        generationUrl,
        "SELECT count(*) FROM console_execution_read_authorizations;",
      ),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      runSql(
        generationUrl,
        `SELECT console_execution_overview(
          '[]'::jsonb, NULL, clock_timestamp() - interval '1 hour',
          clock_timestamp()
        );`,
      ),
    ).rejects.toThrow(/permission denied/iu);
    await expect(
      runSql(
        asRole("console_control_svc"),
        "SELECT count(*) FROM console_execution_read_authorizations;",
      ),
    ).rejects.toThrow(/permission denied/iu);
  });
});
