import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { createPostgresReviewSessionProgressStore } from "./index.js";

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

function contextRuntimeDatabaseUrl(): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const url = new URL(databaseUrl);
  url.username = "context_runtime_svc";
  url.password = "";
  return url.toString();
}

describeDatabase("US-02.3 server-owned Review Session progress", () => {
  it("saves with an epoch, resumes in the bound browser and rejects stale writes", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const reviewSessionId = randomUUID();
    const snapshotId = randomUUID();
    const bindingId = randomUUID();
    const categoryId = randomUUID();
    const factOptionId = randomUUID();
    const reviewFormatId = randomUUID();
    const enablementId = randomUUID();
    const actionEnablementId = randomUUID();
    const routeHandleHash = `sha256:route-${randomUUID()}`;
    const browserCapabilityHash = `sha256:browser-${randomUUID()}`;

    await runSql(`
      INSERT INTO action_definitions (action, input_contract, status)
      VALUES ('GENERATE', '{}'::jsonb, 'ACTIVE')
      ON CONFLICT (action) DO NOTHING;
      INSERT INTO tenants (id, slug, name, locale, policy)
      VALUES (
        '${tenantId}', 'tenant-${tenantId}', 'Apex Dental', 'en-GB',
        '{"minimumFactSelections":2,"maximumCustomerAssertionChars":500}'::jsonb
      );
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES ('${locationId}', '${tenantId}', 'location-${locationId}', 'Central');
      INSERT INTO effective_configuration_snapshots (
        id, tenant_id, location_id, schema_version, content_hash, payload, provenance
      ) VALUES (
        '${snapshotId}', '${tenantId}', '${locationId}', 1,
        'snapshot-${snapshotId}', '{}'::jsonb, '{}'::jsonb
      );
      INSERT INTO review_sessions (
        id, tenant_id, location_id, configuration_snapshot_id, status, rating,
        selected_action, expires_at
      ) VALUES (
        '${reviewSessionId}', '${tenantId}', '${locationId}', '${snapshotId}', 'OPEN', 4,
        'GENERATE', clock_timestamp() + interval '24 hours'
      );
      INSERT INTO review_session_browser_bindings (
        id, tenant_id, location_id, review_session_id, route_handle_hash,
        browser_capability_hash, expires_at
      ) VALUES (
        '${bindingId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
        '${routeHandleHash}', '${browserCapabilityHash}',
        clock_timestamp() + interval '24 hours'
      );
      INSERT INTO tenant_action_enablements (id, tenant_id, action, enabled)
      VALUES ('${actionEnablementId}', '${tenantId}', 'GENERATE', true);
      INSERT INTO fact_option_categories (id, tenant_id, key, label)
      VALUES ('${categoryId}', '${tenantId}', 'service', '{"en-GB":"Service"}'::jsonb);
      INSERT INTO fact_option_versions (
        id, tenant_id, category_id, fact_option_key, version, owner_scope,
        label, proposition, polarity, sort_order, is_active
      ) VALUES (
        '${factOptionId}', '${tenantId}', '${categoryId}', 'attentive', 1,
        'TENANT', '{"en-GB":"Attentive"}'::jsonb,
        'The team was attentive.', 'POSITIVE', 1, true
      );
      INSERT INTO review_format_versions (
        id, format_key, version, locale, target_platform, constraints,
        localized_text, supported_actions, content_hash, status
      ) VALUES (
        '${reviewFormatId}', 'short-${reviewFormatId}', 1, 'en-GB', 'google',
        '{"minChars":20,"maxChars":350}'::jsonb,
        '{"displayName":{"en-GB":"Short"},"description":{"en-GB":"Short"},"sample":{"en-GB":"Sample"}}'::jsonb,
        ARRAY['GENERATE']::generation_action[], 'sha256:${reviewFormatId}', 'ACTIVE'
      );
      INSERT INTO review_format_enablements (
        id, tenant_id, review_format_version_id, enabled, allowed_actions
      ) VALUES (
        '${enablementId}', '${tenantId}', '${reviewFormatId}', true,
        ARRAY['GENERATE']::generation_action[]
      );
    `);

    const store = createPostgresReviewSessionProgressStore({
      databaseUrl: contextRuntimeDatabaseUrl(),
    });
    try {
      const saved = await store.save({
        routeHandleHash,
        browserCapabilityHash,
        expectedEpoch: 1,
        progress: {
          phase: "format",
          selectedFactOptionIds: [],
          customerAssertion: "The reception was calm.",
          sourceText: "",
          selectedReviewFormatId: reviewFormatId,
        },
      });
      expect(saved).toMatchObject({
        status: "saved",
        progress: {
          epoch: 2,
          phase: "format",
          selectedFactOptionIds: [],
          customerAssertion: "The reception was calm.",
          selectedReviewFormatId: reviewFormatId,
        },
      });
      await expect(
        store.save({
          routeHandleHash,
          browserCapabilityHash,
          expectedEpoch: 1,
          progress: {
            phase: "facts",
            selectedFactOptionIds: [factOptionId],
            customerAssertion: "",
            sourceText: "",
            selectedReviewFormatId: null,
          },
        }),
      ).resolves.toMatchObject({ status: "conflict", progress: { epoch: 2 } });
      await expect(
        store.read({
          routeHandleHash,
          browserCapabilityHash: `sha256:other-${randomUUID()}`,
        }),
      ).resolves.toEqual({ status: "unavailable" });
    } finally {
      await store.disconnect();
    }
  });
});
