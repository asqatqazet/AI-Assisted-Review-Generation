import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { createPostgresReviewerGenerationAdmissionStore } from "./index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
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

describeDatabase("US-01.3 PostgreSQL reviewer Generation admission", () => {
  it("atomically freezes selected Assertions, configuration and one idempotent Batch", async () => {
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
    const snapshotId = randomUUID();
    const promptVersionId = randomUUID();
    const providerId =
      (await runSql("SELECT id FROM providers WHERE key = 'fake' LIMIT 1;")) ||
      randomUUID();
    const providerModelId =
      (await runSql(
        `SELECT id FROM provider_models WHERE provider_id = '${providerId}' AND model_key = 'fake-v1' LIMIT 1;`,
      )) || randomUUID();
    const priceRateId =
      (await runSql(
        `SELECT id FROM price_rates WHERE provider_model_id = '${providerModelId}' AND input_per_million_micros = 0 AND output_per_million_micros = 0 LIMIT 1;`,
      )) || randomUUID();
    const routeHandleHash = `sha256:route-${randomUUID()}`;
    const browserCapabilityHash = `sha256:browser-${randomUUID()}`;
    const snapshot = {
      snapshotId,
      schemaVersion: 2,
      tenantId,
      locationId,
      tenantName: "Apex Dental",
      locationName: "Central Clinic",
      provenance: {},
      settings: {
        locale: "en-GB",
        toneGuidelines: "Warm and specific.",
        entryMode: "open-qr",
        requireDisclosure: false,
        requireVerifiedExperience: false,
        maxReviewFormatsPerRequest: 1,
        bannedTerms: [],
        enabledReviewFormatVersionIds: [reviewFormatVersionId],
        enabledCommands: ["generate"],
        monthlyBudgetMicros: 0,
        alertThresholdPct: 80,
      },
      factOptions: [
        {
          id: factOptionId,
          version: "fact-attentive@1",
          owner: { scope: "tenant", tenantId },
          proposition: "The team was attentive.",
          categoryId,
          polarity: "positive",
          locale: "en-GB",
          active: true,
          sortOrder: 1,
        },
      ],
      reviewFormats: [
        {
          id: reviewFormatVersionId,
          key: "concise",
          version: "1.0.0",
          displayName: "Concise review",
          targetPlatform: "google",
          locale: "en-GB",
          description: { "en-GB": "One short paragraph." },
          sample: { "en-GB": "The team was attentive." },
          constraints: {
            minChars: 1,
            maxChars: 350,
            paragraphs: 1,
            emojiPolicy: "none",
            secondPerson: false,
          },
          supportedCommands: ["generate"],
        },
      ],
      promptVersions: [
        {
          id: promptVersionId,
          hash: "prompt-generate-v1",
          key: "review.generate",
          commandKind: "generate",
          body: "Use only supplied Assertions.",
          variables: ["locale", "tone"],
        },
      ],
      priceRates: [
        {
          id: priceRateId,
          providerModelId,
          provider: "fake",
          model: "fake-v1",
          inputPerMillionMicros: 0,
          outputPerMillionMicros: 0,
          currency: "EUR",
          unit: "token",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
        },
      ],
      providerRouting: {
        version: "routing-v1",
        providerModelId,
        primaryProvider: "fake",
        primaryModel: "fake-v1",
      },
    };

    await runSql(`
      INSERT INTO tenants (
        id, slug, name, locale, monthly_budget_micros, policy
      ) VALUES (
        '${tenantId}', 'tenant-${tenantId}', 'Apex Dental', 'en-GB', 0,
        '{"maxActiveGenerations":1,"minimumFactSelections":2}'::jsonb
      );
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
        '{"minChars":1,"maxChars":350,"paragraphs":1,"emojiPolicy":"none","secondPerson":false}'::jsonb,
        '{"displayName":{"en-GB":"Concise review"},"description":{"en-GB":"One short paragraph."},"sample":{"en-GB":"The team was attentive."}}'::jsonb,
        ARRAY['GENERATE']::generation_action[],
        'sha256:format-${reviewFormatVersionId}', 'ACTIVE'
      );
      INSERT INTO review_format_enablements (
        id, tenant_id, review_format_version_id, enabled, sort_order, allowed_actions
      ) VALUES (
        '${reviewFormatEnablementId}', '${tenantId}', '${reviewFormatVersionId}',
        true, 1, ARRAY['GENERATE']::generation_action[]
      );
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body
      ) VALUES (
        '${promptVersionId}', '${tenantId}', 'generate-v1', 'GENERATE',
        'prompt-generate-v1', 'Use only supplied Assertions.'
      );
      INSERT INTO providers (id, key, display_name, credential_reference)
      VALUES ('${providerId}', 'fake', 'Fake Provider', 'fake://local')
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO provider_models (id, provider_id, model_key)
      VALUES ('${providerModelId}', '${providerId}', 'fake-v1')
      ON CONFLICT (provider_id, model_key) DO NOTHING;
      INSERT INTO price_rates (
        id, provider_model_id, currency, input_per_million_micros,
        output_per_million_micros, effective_from
      ) VALUES (
        '${priceRateId}', '${providerModelId}', 'EUR', 0, 0,
        clock_timestamp() - interval '1 day'
      ) ON CONFLICT (id) DO NOTHING;
      INSERT INTO effective_configuration_snapshots (
        id, tenant_id, location_id, schema_version, content_hash, payload, provenance
      ) VALUES (
        '${snapshotId}', '${tenantId}', '${locationId}', 2,
        'sha256:snapshot-${snapshotId}', '${JSON.stringify(snapshot)}'::jsonb,
        '{}'::jsonb
      );
    `);

    const store = createPostgresReviewerGenerationAdmissionStore({ databaseUrl });
    try {
      await expect(
        store.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "below-minimum-facts",
          factOptionIds: [factOptionId],
          reviewFormatVersionId,
        }),
      ).resolves.toEqual({ status: "rejected" });
      await runSql(`
        UPDATE tenants
        SET policy = '{"maxActiveGenerations":1,"minimumFactSelections":1}'::jsonb
        WHERE id = '${tenantId}';
      `);
      const input = {
        routeHandleHash,
        browserCapabilityHash,
        idempotencyKey: "request-a",
        factOptionIds: [factOptionId],
        reviewFormatVersionId,
      };
      const first = await store.prepare(input);
      const replay = await store.prepare(input);

      expect(first).toMatchObject({
        status: "prepared",
        workload: {
          bindings: {
            tenantId,
            locationId,
            reviewSessionId,
            action: "generate",
            reviewFormatVersionId,
            snapshotId,
            snapshotHash: `sha256:snapshot-${snapshotId}`,
            providerModelId,
            priceRateId,
            idempotencyKey: "request-a",
          },
          snapshot,
          command: { kind: "generate", rating: 4 },
          assertions: [
            {
              reviewSessionId,
              semanticId: factOptionId,
              proposition: "The team was attentive.",
              source: { kind: "fact-option", factOptionId },
            },
          ],
        },
      });
      expect(replay).toEqual(first);
      if (first.status !== "prepared") {
        throw new Error("Expected a prepared reviewer Generation");
      }
      const workloadBindings = first.workload["bindings"] as Readonly<
        Record<string, string>
      >;
      const leaseId = randomUUID();
      const activation = await store.activate({
        tenantId,
        locationId,
        reviewSessionId,
        generationBatchId: workloadBindings["generationBatchId"]!,
        generationId: workloadBindings["generationId"]!,
        requestHash: workloadBindings["requestHash"]!,
        permitJti: first.permitJti,
        leaseId,
        leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
      });
      expect(activation).toMatchObject({ status: "activated", leaseId });
      await expect(
        store.settle({
          tenantId,
          locationId,
          reviewSessionId,
          generationBatchId: workloadBindings["generationBatchId"]!,
          generationId: workloadBindings["generationId"]!,
          requestHash: workloadBindings["requestHash"]!,
          permitJti: first.permitJti,
          leaseId,
          actualCostMicros: 0,
        }),
      ).resolves.toEqual({ status: "settled" });
      expect(
        await runSql(
          `SELECT count(*) FROM generation_batches WHERE tenant_id = '${tenantId}' AND review_session_id = '${reviewSessionId}';`,
        ),
      ).toBe("1");
      expect(
        await runSql(
          `SELECT count(*) FROM assertions WHERE tenant_id = '${tenantId}' AND review_session_id = '${reviewSessionId}';`,
        ),
      ).toBe("1");
      expect(
        await runSql(
          `SELECT status::text || '|' || actual_cost_micros::text FROM budget_reservations WHERE permit_jti = '${first.permitJti}';`,
        ),
      ).toBe("SETTLED|0");
    } finally {
      await store.disconnect();
    }
  });
});
