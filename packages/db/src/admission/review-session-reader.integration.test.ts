import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { createPostgresReviewSessionReader } from "./index.js";

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

describeDatabase("US-01.3 PostgreSQL Review Session projection", () => {
  it("resolves a browser-bound route and reads only its tenant-scoped facts", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const reviewSessionId = randomUUID();
    const categoryId = randomUUID();
    const factOptionId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    const reviewFormatEnablementId = randomUUID();
    const bindingId = randomUUID();
    const routeHandleHash = `sha256:route-${randomUUID()}`;
    const browserCapabilityHash = `sha256:browser-${randomUUID()}`;

    await runSql(`
      INSERT INTO tenants (id, slug, name, locale)
      VALUES ('${tenantId}', 'tenant-${tenantId}', 'Apex Dental', 'en-GB');
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES ('${locationId}', '${tenantId}', 'location-${locationId}', 'Central Clinic');
      INSERT INTO review_sessions (
        id, tenant_id, location_id, status, rating, selected_action, expires_at
      ) VALUES (
        '${reviewSessionId}', '${tenantId}', '${locationId}', 'OPEN', 4,
        'GENERATE', clock_timestamp() + interval '1 hour'
      );
      INSERT INTO review_session_browser_bindings (
        id, tenant_id, location_id, review_session_id, route_handle_hash,
        browser_capability_hash, expires_at
      ) VALUES (
        '${bindingId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
        '${routeHandleHash}', '${browserCapabilityHash}',
        clock_timestamp() + interval '1 hour'
      );
      INSERT INTO fact_option_categories (id, tenant_id, key, label)
      VALUES ('${categoryId}', '${tenantId}', 'service', '{"en-GB":"Service"}'::jsonb);
      INSERT INTO fact_option_versions (
        id, tenant_id, category_id, fact_option_key, version, owner_scope,
        label, proposition, polarity, sort_order, is_active
      ) VALUES (
        '${factOptionId}', '${tenantId}', '${categoryId}', 'attentive', 1,
        'TENANT', '{"en-GB":"The team was attentive"}'::jsonb,
        'The team was attentive.', 'POSITIVE', 1, true
      );
      INSERT INTO review_format_versions (
        id, format_key, version, locale, target_platform, constraints,
        localized_text, supported_actions, content_hash, status
      ) VALUES (
        '${reviewFormatVersionId}', 'concise-${reviewFormatVersionId}', 1,
        'en-GB', 'google',
        '{"minChars":20,"maxChars":350,"paragraphs":1}'::jsonb,
        '{"displayName":{"en-GB":"Concise review"},"description":{"en-GB":"One short paragraph."},"sample":{"en-GB":"The team was attentive."}}'::jsonb,
        ARRAY['GENERATE']::generation_action[],
        'sha256:format-${reviewFormatVersionId}', 'ACTIVE'
      );
      INSERT INTO review_format_enablements (
        id, tenant_id, review_format_version_id, enabled, sort_order,
        allowed_actions
      ) VALUES (
        '${reviewFormatEnablementId}', '${tenantId}',
        '${reviewFormatVersionId}', true, 1,
        ARRAY['GENERATE']::generation_action[]
      );
    `);

    const reader = createPostgresReviewSessionReader({ databaseUrl });
    try {
      await expect(
        reader.read({ routeHandleHash, browserCapabilityHash }),
      ).resolves.toMatchObject({
        reviewSessionId,
        tenantId,
        locationId,
        tenantDisplayName: "Apex Dental",
        locationDisplayName: "Central Clinic",
        locale: "en-GB",
        rating: 4,
        action: "generate",
        factOptions: [
          {
            id: factOptionId,
            label: "The team was attentive",
            categoryLabel: "Service",
            polarity: "positive",
          },
        ],
        reviewFormats: [
          {
            id: reviewFormatVersionId,
            displayName: "Concise review",
            description: "One short paragraph.",
            sample: "The team was attentive.",
            availableCommands: ["generate"],
          },
        ],
      });
    } finally {
      await reader.disconnect();
    }
  });
});
