import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  createPostgresEntryAdmissionStore,
  createPostgresReviewSessionReader,
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

describeDatabase("US-01.3 PostgreSQL open-QR entry admission", () => {
  it("prepares, reads and atomically starts one browser-bound Review Session", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const categoryId = randomUUID();
    const factOptionId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    const enablementId = randomUUID();
    const entryRouteHash = `sha256:entry-${randomUUID()}`;
    const browserHash = `sha256:browser-${randomUUID()}`;
    const reviewRouteHash = `sha256:review-${randomUUID()}`;
    await runSql(`
      INSERT INTO entry_mode_definitions (key, semantics)
      VALUES ('open-qr', '{"verification":false}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO tenants (
        id, slug, name, locale, default_entry_mode_key
      ) VALUES (
        '${tenantId}', 'tenant-${tenantId}', 'Apex Dental', 'en-GB', 'open-qr'
      );
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES (
        '${locationId}', '${tenantId}', 'location-${locationId}', 'Central Clinic'
      );
      INSERT INTO fact_option_categories (id, tenant_id, key, label)
      VALUES (
        '${categoryId}', '${tenantId}', 'service', '{"en-GB":"Service"}'::jsonb
      );
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
        '{"minChars":1,"maxChars":350,"paragraphs":1}'::jsonb,
        '{"displayName":{"en-GB":"Concise review"},"description":{"en-GB":"One short paragraph."},"sample":{"en-GB":"The team was attentive."}}'::jsonb,
        ARRAY['GENERATE']::generation_action[],
        'sha256:format-${reviewFormatVersionId}', 'ACTIVE'
      );
      INSERT INTO review_format_enablements (
        id, tenant_id, review_format_version_id, enabled, sort_order,
        allowed_actions
      ) VALUES (
        '${enablementId}', '${tenantId}', '${reviewFormatVersionId}', true, 1,
        ARRAY['GENERATE']::generation_action[]
      );
    `);
    const entryStore = createPostgresEntryAdmissionStore({ databaseUrl });
    const reader = createPostgresReviewSessionReader({ databaseUrl });

    try {
      await expect(
        entryStore.prepare({
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          routeHandleHash: entryRouteHash,
          browserCapabilityHash: browserHash,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }),
      ).resolves.toEqual({ status: "prepared" });
      await expect(
        entryStore.read({
          routeHandleHash: entryRouteHash,
          browserCapabilityHash: browserHash,
        }),
      ).resolves.toMatchObject({
        status: "ready",
        context: {
          tenantDisplayName: "Apex Dental",
          locationDisplayName: "Central Clinic",
          locale: "en-GB",
          entryMode: "open-qr",
          requirements: {
            minimumFactSelections: 1,
            maximumReviewFormatsPerGeneration: 1,
            maximumCustomerAssertionChars: 500,
          },
          factOptions: [{ id: factOptionId }],
          reviewFormats: [{ id: reviewFormatVersionId }],
        },
      });
      await expect(
        entryStore.advance({
          routeHandleHash: entryRouteHash,
          browserCapabilityHash: browserHash,
          reviewSessionRouteHandleHash: `sha256:review-${randomUUID()}`,
          rating: 4,
          action: "PARAPHRASE",
          reviewSessionExpiresAt: new Date(
            Date.now() + 60 * 60_000,
          ).toISOString(),
        }),
      ).resolves.toEqual({ status: "unavailable" });
      const admitted = await entryStore.advance({
        routeHandleHash: entryRouteHash,
        browserCapabilityHash: browserHash,
        reviewSessionRouteHandleHash: reviewRouteHash,
        rating: 4,
        action: "GENERATE",
        reviewSessionExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      });
      expect(admitted).toMatchObject({
        status: "admitted",
        tenantId,
        locationId,
      });
      await expect(
        entryStore.advance({
          routeHandleHash: entryRouteHash,
          browserCapabilityHash: browserHash,
          reviewSessionRouteHandleHash: `sha256:review-${randomUUID()}`,
          rating: 4,
          action: "GENERATE",
          reviewSessionExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        }),
      ).resolves.toEqual({ status: "unavailable" });
      await expect(
        reader.read({
          routeHandleHash: reviewRouteHash,
          browserCapabilityHash: browserHash,
        }),
      ).resolves.toMatchObject({
        tenantId,
        locationId,
        rating: 4,
        action: "generate",
      });
    } finally {
      await entryStore.disconnect();
      await reader.disconnect();
    }
  });
});
