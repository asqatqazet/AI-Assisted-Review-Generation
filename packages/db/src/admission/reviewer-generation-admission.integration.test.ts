import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { deriveConfigSnapshotId } from "@review/domain/configuration";

import { databaseUrlForTestRole } from "../test-support/database-role-url.js";
import { createPostgresReviewerGenerationAdmissionStore } from "./index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl ? describe : describe.skip;

const contentHashOf = (snapshot: unknown): string =>
  deriveConfigSnapshotId(snapshot as never);

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
};

const admissionRequestHashOf = (value: unknown): string =>
  `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;

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

function contextServiceDatabaseUrl(): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  return databaseUrlForTestRole({
    databaseUrl,
    role: "context_runtime_svc",
  });
}

describeDatabase("US-01.3 PostgreSQL reviewer Generation admission", () => {
  beforeEach(async () => {
    await runSql("DELETE FROM platform_generation_admissions;");
  });

  it("atomically freezes selected Assertions, configuration and its published Price Rate after rollover", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const reviewSessionId = randomUUID();
    const categoryId = randomUUID();
    const factOptionId = randomUUID();
    const secondFactOptionId = randomUUID();
    const unpublishedFactOptionId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    const reviewFormatEnablementId = randomUUID();
    const bindingId = randomUUID();
    const snapshotId = randomUUID();
    const promptVersionId = randomUUID();
    const promptContentHash = `sha256:${createHash("sha256")
      .update(promptVersionId)
      .digest("hex")}`;
    const providerId =
      (await runSql("SELECT id FROM providers WHERE key = 'fake' LIMIT 1;")) ||
      randomUUID();
    const providerModelId =
      (await runSql(
        `SELECT id FROM provider_models WHERE provider_id = '${providerId}' AND model_key = 'fake-v1' LIMIT 1;`,
      )) || randomUUID();
    const priceRateId = randomUUID();
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
        minimumFactSelections: 2,
        maximumCustomerAssertionChars: 80,
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
        {
          id: secondFactOptionId,
          version: "fact-well-seasoned@1",
          owner: { scope: "tenant", tenantId },
          proposition: "The food was well seasoned.",
          categoryId,
          polarity: "positive",
          locale: "en-GB",
          active: true,
          sortOrder: 2,
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
          hash: promptContentHash,
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
          effectiveFrom: "2000-01-01T00:00:00.000Z",
          effectiveTo: "2000-02-01T00:00:00.000Z",
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
        '{"maxActiveGenerations":1,"minimumFactSelections":1,"maximumCustomerAssertionChars":500}'::jsonb
      );
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES ('${locationId}', '${tenantId}', 'location-${locationId}', 'Central Clinic');
      INSERT INTO effective_configuration_snapshots (
        id, tenant_id, location_id, schema_version, content_hash, payload, provenance
      ) VALUES (
        '${snapshotId}', '${tenantId}', '${locationId}', 2,
        '${contentHashOf(snapshot)}', '${JSON.stringify(snapshot)}'::jsonb,
        '{}'::jsonb
      );
      INSERT INTO review_sessions (
        id, tenant_id, location_id, configuration_snapshot_id, status, rating,
        selected_action, expires_at
      ) VALUES (
        '${reviewSessionId}', '${tenantId}', '${locationId}', '${snapshotId}', 'OPEN', 4,
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
      ) VALUES
        (
          '${factOptionId}', '${tenantId}', '${categoryId}', 'attentive', 1,
          'TENANT', '{"en-GB":"The team was attentive"}'::jsonb,
          'The team was attentive.', 'POSITIVE', 1, true
        ),
        (
          '${secondFactOptionId}', '${tenantId}', '${categoryId}', 'well-seasoned', 1,
          'TENANT', '{"en-GB":"The food was well seasoned"}'::jsonb,
          'The food was well seasoned.', 'POSITIVE', 2, true
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
        '${promptContentHash}', 'Use only supplied Assertions.'
      );
      BEGIN;
      UPDATE provider_models SET routing_priority = NULL
      WHERE routing_priority = 1;
      INSERT INTO providers (id, key, display_name, credential_reference)
      VALUES ('${providerId}', 'fake', 'Fake Provider', 'fake://local')
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO provider_models (
        id, provider_id, model_key, routing_priority
      ) VALUES ('${providerModelId}', '${providerId}', 'fake-v1', 1)
      ON CONFLICT (provider_id, model_key) DO UPDATE SET
        routing_priority = EXCLUDED.routing_priority;
      COMMIT;
      INSERT INTO price_rates (
        id, provider_model_id, currency, input_per_million_micros,
        output_per_million_micros, effective_from, effective_to
      ) VALUES (
        '${priceRateId}', '${providerModelId}', 'EUR', 0, 0,
        '2000-01-01T00:00:00.000Z', '2000-02-01T00:00:00.000Z'
      ) ON CONFLICT (id) DO NOTHING;
      UPDATE review_format_enablements
      SET enabled = false
      WHERE id = '${reviewFormatEnablementId}';
      UPDATE fact_option_versions
      SET proposition = 'Unpublished replacement proposition.'
      WHERE id = '${factOptionId}';
      INSERT INTO fact_option_versions (
        id, tenant_id, category_id, fact_option_key, version, owner_scope,
        label, proposition, polarity, sort_order, is_active
      ) VALUES (
        '${unpublishedFactOptionId}', '${tenantId}', '${categoryId}',
        'unpublished-${unpublishedFactOptionId}', 1, 'TENANT',
        '{"en-GB":"Unpublished Fact Option"}'::jsonb,
        'This proposition was never published.', 'POSITIVE', 3, true
      );
    `);

    const store = createPostgresReviewerGenerationAdmissionStore({
      databaseUrl: contextServiceDatabaseUrl(),
      providerMode: "fake-only",
    });
    try {
      await expect(
        store.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "below-minimum-facts",
          command: {
            kind: "generate",
            factOptionIds: [factOptionId],
            reviewFormatVersionId,
          },
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "GROUNDING_REJECTED",
        retryable: false,
      });
      await expect(
        store.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "unpublished-fact-option",
          command: {
            kind: "generate",
            factOptionIds: [factOptionId, unpublishedFactOptionId],
            reviewFormatVersionId,
          },
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "GROUNDING_REJECTED",
        retryable: false,
      });
      const input = {
        routeHandleHash,
        browserCapabilityHash,
        idempotencyKey: "request-a",
        command: {
          kind: "generate" as const,
          factOptionIds: [secondFactOptionId, factOptionId],
          customerAssertion: "The reception was calm.",
          reviewFormatVersionId,
        },
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
            snapshotHash: contentHashOf(snapshot),
            providerModelId,
            priceRateId,
            idempotencyKey: "request-a",
          },
          snapshot,
          command: { kind: "generate", rating: 4 },
          assertions: [
            {
              reviewSessionId,
              semanticId: secondFactOptionId,
              proposition: "The food was well seasoned.",
              source: { kind: "fact-option", factOptionId: secondFactOptionId },
            },
            {
              reviewSessionId,
              semanticId: factOptionId,
              proposition: "The team was attentive.",
              source: { kind: "fact-option", factOptionId },
            },
            {
              reviewSessionId,
              proposition: "The reception was calm.",
              source: {
                kind: "reviewer-text",
                start: 0,
                end: 23,
                quotedText: "The reception was calm.",
              },
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
      ).toBe("3");
      expect(
        await runSql(
          `SELECT count(*) FROM source_text_revisions WHERE tenant_id = '${tenantId}' AND review_session_id = '${reviewSessionId}' AND body = 'The reception was calm.';`,
        ),
      ).toBe("1");
      expect(
        await runSql(
          `SELECT status::text || '|' || actual_cost_micros::text FROM budget_reservations WHERE permit_jti = '${first.permitJti}';`,
        ),
      ).toBe("SETTLED|0");

      const freeTextOnly = await store.prepare({
        routeHandleHash,
        browserCapabilityHash,
        idempotencyKey: "free-text-only",
        command: {
          kind: "generate",
          factOptionIds: [],
          customerAssertion: "The waiting area was quiet.",
          reviewFormatVersionId,
        },
      });
      expect(freeTextOnly).toMatchObject({
        status: "prepared",
        workload: {
          command: { kind: "generate", rating: 4 },
          assertions: [
            {
              proposition: "The waiting area was quiet.",
              source: {
                kind: "reviewer-text",
                start: 0,
                end: 27,
                quotedText: "The waiting area was quiet.",
              },
            },
          ],
        },
      });
      expect(
        await runSql(
          `SELECT count(*) FROM generation_batches WHERE tenant_id = '${tenantId}' AND review_session_id = '${reviewSessionId}';`,
        ),
      ).toBe("2");
      expect(
        await runSql(
          `SELECT count(*) FROM assertions WHERE tenant_id = '${tenantId}' AND review_session_id = '${reviewSessionId}';`,
        ),
      ).toBe("4");

      await expect(
        store.prepare({
          ...input,
          idempotencyKey: "blocked-by-active-reservation",
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "RATE_LIMITED",
        retryable: true,
      });
      await expect(store.prepare({
        routeHandleHash,
        browserCapabilityHash,
        idempotencyKey: "free-text-only",
        command: {
          kind: "generate",
          factOptionIds: [],
          customerAssertion: "The waiting area was quiet.",
          reviewFormatVersionId,
        },
      })).resolves.toEqual(freeTextOnly);
      expect(
        await runSql(
          `SELECT count(*) FROM generation_batches WHERE tenant_id = '${tenantId}' AND review_session_id = '${reviewSessionId}';`,
        ),
      ).toBe("2");

      if (freeTextOnly.status !== "prepared") {
        throw new Error("Expected the free-text Generation to be prepared");
      }
      const freeTextBindings = freeTextOnly.workload["bindings"] as Readonly<
        Record<string, string>
      >;
      const freeTextLeaseId = randomUUID();
      await expect(
        store.activate({
          tenantId,
          locationId,
          reviewSessionId,
          generationBatchId: freeTextBindings["generationBatchId"]!,
          generationId: freeTextBindings["generationId"]!,
          requestHash: freeTextBindings["requestHash"]!,
          permitJti: freeTextOnly.permitJti,
          leaseId: freeTextLeaseId,
          leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
        }),
      ).resolves.toMatchObject({ status: "activated" });
      await expect(
        store.settle({
          tenantId,
          locationId,
          reviewSessionId,
          generationBatchId: freeTextBindings["generationBatchId"]!,
          generationId: freeTextBindings["generationId"]!,
          requestHash: freeTextBindings["requestHash"]!,
          permitJti: freeTextOnly.permitJti,
          leaseId: freeTextLeaseId,
          actualCostMicros: 0,
        }),
      ).resolves.toEqual({ status: "settled" });

      await expect(
        store.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "free-text-only",
          command: {
            kind: "generate",
            factOptionIds: [],
            customerAssertion: "The waiting area was quiet.",
            reviewFormatVersionId,
          },
        }),
      ).resolves.toEqual(freeTextOnly);

      const sourceText =
        "The staff listened carefully and explained every step.";
      const paraphrase = await store.prepare({
        routeHandleHash,
        browserCapabilityHash,
        idempotencyKey: "paraphrase-a",
        command: {
          kind: "paraphrase",
          sourceText,
          reviewFormatVersionId,
        },
      });
      expect(paraphrase).toEqual({
        status: "rejected",
        code: "GENERATION_FAILED",
        retryable: false,
      });
      expect(
        await runSql(
          `SELECT count(*) FROM budget_reservations WHERE tenant_id = '${tenantId}' AND review_session_id = '${reviewSessionId}';`,
        ),
      ).toBe("2");
      expect(
        await runSql(
          `SELECT count(*) FROM source_text_revisions WHERE tenant_id = '${tenantId}' AND review_session_id = '${reviewSessionId}' AND body = '${sourceText}';`,
        ),
      ).toBe("0");

      const sourceGenerationId = randomUUID();
      const unsupportedCommands = [
        { kind: "resample" as const, sourceGenerationId },
        {
          kind: "reformat" as const,
          sourceGenerationId,
          reviewFormatVersionId,
        },
        { kind: "condense" as const, sourceGenerationId, targetMaxChars: 120 },
        { kind: "expand" as const, sourceGenerationId, targetMinChars: 240 },
        {
          kind: "revise-wording" as const,
          sourceGenerationId,
          presentationInstruction: "Use simpler wording.",
        },
      ];
      for (const [index, command] of unsupportedCommands.entries()) {
        await expect(
          store.prepare({
            routeHandleHash,
            browserCapabilityHash,
            idempotencyKey: `unsupported-${index}`,
            command,
          }),
        ).resolves.toEqual({
          status: "rejected",
          code: "GENERATION_FAILED",
          retryable: false,
        });
      }
      expect(
        await runSql(
          `SELECT count(*) FROM generation_batches WHERE tenant_id = '${tenantId}' AND review_session_id = '${reviewSessionId}';`,
        ),
      ).toBe("2");

      const legacyReservationId = randomUUID();
      const legacyBatchId = randomUUID();
      const legacySourceGenerationId = randomUUID();
      const legacyCommand = {
        kind: "resample" as const,
        sourceGenerationId: legacySourceGenerationId,
      };
      const legacyIdempotencyKey = "legacy-unsupported-retry";
      const legacyRequestHash = admissionRequestHashOf({
        command: legacyCommand,
        rating: 5,
      });
      await runSql(`
        INSERT INTO budget_reservations (
          id, tenant_id, location_id, review_session_id, snapshot_id,
          permit_jti, request_hash, action, reserved_micros, expires_at
        ) VALUES (
          '${legacyReservationId}', '${tenantId}', '${locationId}',
          '${reviewSessionId}', '${snapshotId}', 'legacy-${legacyReservationId}',
          '${legacyRequestHash}', 'REGENERATE', 0,
          clock_timestamp() + interval '1 hour'
        );
        INSERT INTO generation_batches (
          id, tenant_id, location_id, review_session_id, snapshot_id,
          budget_reservation_id, idempotency_key, request_hash, action,
          normalized_input
        ) VALUES (
          '${legacyBatchId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
          '${snapshotId}', '${legacyReservationId}', '${legacyIdempotencyKey}',
          '${legacyRequestHash}', 'REGENERATE',
          '{"workload":{"snapshot":{"providerRouting":{"primaryProvider":"fake"}}}}'::jsonb
        );
      `);
      await expect(
        store.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: legacyIdempotencyKey,
          command: legacyCommand,
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "GENERATION_FAILED",
        retryable: false,
      });
      await runSql(`
        DELETE FROM generation_batches WHERE id = '${legacyBatchId}';
        DELETE FROM budget_reservations WHERE id = '${legacyReservationId}';
      `);

      const prepareAnotherSession = async (label: string) => {
        const sessionId = randomUUID();
        const sessionBindingId = randomUUID();
        const sessionRouteHash = `sha256:route-${randomUUID()}`;
        const sessionBrowserHash = `sha256:browser-${randomUUID()}`;
        await runSql(`
          INSERT INTO review_sessions (
            id, tenant_id, location_id, configuration_snapshot_id, status, rating,
            selected_action, expires_at
          ) VALUES (
            '${sessionId}', '${tenantId}', '${locationId}', '${snapshotId}', 'OPEN', 5,
            'GENERATE', clock_timestamp() + interval '1 hour'
          );
          INSERT INTO review_session_browser_bindings (
            id, tenant_id, location_id, review_session_id, route_handle_hash,
            browser_capability_hash, expires_at
          ) VALUES (
            '${sessionBindingId}', '${tenantId}', '${locationId}', '${sessionId}',
            '${sessionRouteHash}', '${sessionBrowserHash}',
            clock_timestamp() + interval '1 hour'
          );
        `);
        const result = await store.prepare({
          routeHandleHash: sessionRouteHash,
          browserCapabilityHash: sessionBrowserHash,
          idempotencyKey: label,
          command: {
            kind: "generate",
            factOptionIds: [],
            customerAssertion: `A grounded reviewer statement for ${label}.`,
            reviewFormatVersionId,
          },
        });
        return { result, sessionId };
      };

      const settleAnotherSession = async (
        admission: Awaited<ReturnType<typeof prepareAnotherSession>>,
      ) => {
        if (admission.result.status !== "prepared") {
          throw new Error("Expected a prepared cross-session Generation");
        }
        const bindings = admission.result.workload["bindings"] as Readonly<
          Record<string, string>
        >;
        const nextLeaseId = randomUUID();
        await store.activate({
          tenantId,
          locationId,
          reviewSessionId: admission.sessionId,
          generationBatchId: bindings["generationBatchId"]!,
          generationId: bindings["generationId"]!,
          requestHash: bindings["requestHash"]!,
          permitJti: admission.result.permitJti,
          leaseId: nextLeaseId,
          leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
        });
        await store.settle({
          tenantId,
          locationId,
          reviewSessionId: admission.sessionId,
          generationBatchId: bindings["generationBatchId"]!,
          generationId: bindings["generationId"]!,
          requestHash: bindings["requestHash"]!,
          permitJti: admission.result.permitJti,
          leaseId: nextLeaseId,
          actualCostMicros: 0,
        });
      };

      for (const label of [
        "platform-third",
        "platform-fourth",
        "platform-fifth",
      ]) {
        await settleAnotherSession(await prepareAnotherSession(label));
      }
      await expect(
        prepareAnotherSession("platform-sixth").then(({ result }) => result),
      ).resolves.toEqual({
        status: "rejected",
        code: "RATE_LIMITED",
        retryable: true,
      });
      expect(
        await runSql("SELECT count(*) FROM platform_generation_admissions;"),
      ).toBe("5");

      await runSql(`
        UPDATE platform_generation_admissions
        SET admitted_at = clock_timestamp() - interval '2 minutes';
      `);
      for (let index = 6; index <= 10; index += 1) {
        await settleAnotherSession(
          await prepareAnotherSession(`tenant-${index}`),
        );
      }
      await runSql(`
        UPDATE platform_generation_admissions
        SET admitted_at = clock_timestamp() - interval '2 minutes';
      `);
      await expect(
        prepareAnotherSession("tenant-eleventh").then(({ result }) => result),
      ).resolves.toEqual({
        status: "rejected",
        code: "RATE_LIMITED",
        retryable: true,
      });
      expect(
        await runSql(
          `SELECT count(*) FROM generation_batches WHERE tenant_id = '${tenantId}' AND created_at > clock_timestamp() - interval '1 hour';`,
        ),
      ).toBe("10");
    } finally {
      await store.disconnect();
    }
  });

  it("fails paid routing closed and reserves the exact worst-case cost within hard budgets", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const reviewSessionId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    const reviewFormatEnablementId = randomUUID();
    const promptVersionId = randomUUID();
    const promptContentHash = `sha256:${createHash("sha256")
      .update(promptVersionId)
      .digest("hex")}`;
    const snapshotId = randomUUID();
    const bindingId = randomUUID();
    const routeHandleHash = `sha256:route-${randomUUID()}`;
    const browserCapabilityHash = `sha256:browser-${randomUUID()}`;
    const existingProviderId = await runSql(
      "SELECT id FROM providers WHERE key = 'openai' LIMIT 1;",
    );
    const providerId = existingProviderId || randomUUID();
    const originalCredentialReference = existingProviderId
      ? await runSql(
          `SELECT credential_reference FROM providers WHERE id = '${providerId}';`,
        )
      : "";
    const providerModelId = randomUUID();
    const priceRateId = randomUUID();
    const providerModel = `gpt-admission-${randomUUID()}`;
    const worstCaseMicros = 4_400;
    const sourceText =
      "The staff listened carefully and explained every step.";
    const snapshot = {
      snapshotId,
      schemaVersion: 2,
      tenantId,
      locationId,
      tenantName: "Paid Route Tenant",
      locationName: "Paid Route Location",
      provenance: {},
      settings: {
        locale: "en-GB",
        toneGuidelines: "Clear and grounded.",
        entryMode: "open-qr",
        requireDisclosure: false,
        requireVerifiedExperience: false,
        maxReviewFormatsPerRequest: 1,
        minimumFactSelections: 1,
        maximumCustomerAssertionChars: 5_000,
        bannedTerms: [],
        enabledReviewFormatVersionIds: [reviewFormatVersionId],
        enabledCommands: ["generate"],
        monthlyBudgetMicros: worstCaseMicros,
        alertThresholdPct: 80,
      },
      factOptions: [],
      reviewFormats: [
        {
          id: reviewFormatVersionId,
          key: "paid-concise",
          version: "1.0.0",
          displayName: "Paid concise review",
          targetPlatform: "google",
          locale: "en-GB",
          description: { "en-GB": "One short paragraph." },
          sample: { "en-GB": "The staff listened carefully." },
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
          hash: promptContentHash,
          key: "review.generate",
          commandKind: "generate",
          body: "Use only the supplied reviewer assertion.",
          variables: ["locale", "tone"],
        },
      ],
      priceRates: [
        {
          id: priceRateId,
          providerModelId,
          provider: "openai",
          model: providerModel,
          inputPerMillionMicros: 2_000_000,
          outputPerMillionMicros: 4_000_000,
          currency: "EUR",
          unit: "token",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
          effectiveTo: null,
        },
      ],
      providerRouting: {
        version: "routing-paid-v1",
        providerModelId,
        primaryProvider: "openai",
        primaryModel: providerModel,
      },
    };

    await runSql(`
      INSERT INTO tenants (
        id, slug, name, locale, monthly_budget_micros, policy
      ) VALUES (
        '${tenantId}', 'tenant-${tenantId}', 'Paid Route Tenant', 'en-GB',
        0,
        '{"maxActiveGenerations":1,"minimumFactSelections":1,"maximumCustomerAssertionChars":5000}'::jsonb
      );
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES (
        '${locationId}', '${tenantId}', 'location-${locationId}',
        'Paid Route Location'
      );
      INSERT INTO effective_configuration_snapshots (
        id, tenant_id, location_id, schema_version, content_hash, payload, provenance
      ) VALUES (
        '${snapshotId}', '${tenantId}', '${locationId}', 2,
        '${contentHashOf(snapshot)}', '${JSON.stringify(snapshot)}'::jsonb,
        '{}'::jsonb
      );
      INSERT INTO review_sessions (
        id, tenant_id, location_id, configuration_snapshot_id, status, rating,
        selected_action, expires_at
      ) VALUES (
        '${reviewSessionId}', '${tenantId}', '${locationId}', '${snapshotId}', 'OPEN', 5,
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
      INSERT INTO review_format_versions (
        id, format_key, version, locale, target_platform, constraints,
        localized_text, supported_actions, content_hash, status
      ) VALUES (
        '${reviewFormatVersionId}', 'paid-${reviewFormatVersionId}', 1,
        'en-GB', 'google',
        '{"minChars":1,"maxChars":350,"paragraphs":1,"emojiPolicy":"none","secondPerson":false}'::jsonb,
        '{"displayName":{"en-GB":"Paid concise review"},"description":{"en-GB":"One short paragraph."},"sample":{"en-GB":"The staff listened carefully."}}'::jsonb,
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
        '${promptVersionId}', '${tenantId}', 'paid-generate-v1',
        'GENERATE', '${promptContentHash}',
        'Use only the supplied reviewer assertion.'
      );
      BEGIN;
      UPDATE provider_models SET routing_priority = NULL
      WHERE routing_priority = 1;
      INSERT INTO providers (id, key, display_name, credential_reference, status)
      VALUES ('${providerId}', 'openai', 'OpenAI', '', 'ACTIVE')
      ON CONFLICT (key) DO UPDATE SET
        credential_reference = '',
        status = 'ACTIVE';
      INSERT INTO provider_models (
        id, provider_id, model_key, status, routing_priority
      ) VALUES (
        '${providerModelId}', '${providerId}', '${providerModel}', 'ACTIVE', 1
      );
      COMMIT;
      INSERT INTO price_rates (
        id, provider_model_id, currency, input_per_million_micros,
        output_per_million_micros, effective_from
      ) VALUES (
        '${priceRateId}', '${providerModelId}', 'EUR', 2000000, 4000000,
        clock_timestamp() - interval '1 day'
      );
    `);

    const store = createPostgresReviewerGenerationAdmissionStore({
      databaseUrl: contextServiceDatabaseUrl(),
      providerMode: "paid-enabled",
    });
    const lowQuotaStore = createPostgresReviewerGenerationAdmissionStore({
      databaseUrl: contextServiceDatabaseUrl(),
      providerMode: "fake-only",
    });
    const command = {
      kind: "generate" as const,
      factOptionIds: [],
      customerAssertion: sourceText,
      reviewFormatVersionId,
    };
    const createSessionBoundToSnapshot = async (boundSnapshotId: string) => {
      const boundReviewSessionId = randomUUID();
      const boundRouteHandleHash = `sha256:route-${randomUUID()}`;
      const boundBrowserCapabilityHash = `sha256:browser-${randomUUID()}`;
      await runSql(`
        INSERT INTO review_sessions (
          id, tenant_id, location_id, configuration_snapshot_id, status, rating,
          selected_action, expires_at
        ) VALUES (
          '${boundReviewSessionId}', '${tenantId}', '${locationId}',
          '${boundSnapshotId}', 'OPEN', 5, 'GENERATE',
          clock_timestamp() + interval '1 hour'
        );
        INSERT INTO review_session_browser_bindings (
          id, tenant_id, location_id, review_session_id, route_handle_hash,
          browser_capability_hash, expires_at
        ) VALUES (
          '${randomUUID()}', '${tenantId}', '${locationId}',
          '${boundReviewSessionId}', '${boundRouteHandleHash}',
          '${boundBrowserCapabilityHash}', clock_timestamp() + interval '1 hour'
        );
      `);
      return {
        reviewSessionId: boundReviewSessionId,
        routeHandleHash: boundRouteHandleHash,
        browserCapabilityHash: boundBrowserCapabilityHash,
      };
    };
    try {
      await expect(
        store.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "missing-credential",
          command,
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "PROVIDER_UNAVAILABLE",
        retryable: false,
      });
      expect(
        await runSql(
          `SELECT count(*) FROM budget_reservations WHERE tenant_id = '${tenantId}';`,
        ),
      ).toBe("0");

      await runSql(`
        UPDATE providers
        SET credential_reference = 'env://OPENAI_API_KEY'
        WHERE id = '${providerId}';
      `);
      await expect(
        lowQuotaStore.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "paid-snapshot-in-low-quota",
          command,
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "PROVIDER_UNAVAILABLE",
        retryable: false,
      });
      expect(
        await runSql(
          `SELECT count(*) FROM budget_reservations WHERE tenant_id = '${tenantId}';`,
        ),
      ).toBe("0");

      await expect(
        store.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "oversized-input",
          command: {
            ...command,
            customerAssertion: "x".repeat(1_600),
          },
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "POLICY_REJECTED",
        retryable: false,
      });

      await runSql(`
        UPDATE locations SET status = 'INACTIVE' WHERE id = '${locationId}';
      `);
      await expect(
        store.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "inactive-location",
          command,
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "GENERATION_FAILED",
        retryable: false,
      });
      await runSql(`
        UPDATE locations SET status = 'ACTIVE' WHERE id = '${locationId}';
        UPDATE tenants SET status = 'SUSPENDED' WHERE id = '${tenantId}';
      `);
      await expect(
        store.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "inactive-tenant",
          command,
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "GENERATION_FAILED",
        retryable: false,
      });
      await runSql(`
        UPDATE tenants SET status = 'ACTIVE' WHERE id = '${tenantId}';
      `);

      const paid = await store.prepare({
        routeHandleHash,
        browserCapabilityHash,
        idempotencyKey: "paid-at-boundary",
        command,
      });
      expect(paid).toMatchObject({
        status: "prepared",
        workload: {
          bindings: { priceRateId, providerModelId },
          snapshot: {
            providerRouting: { primaryProvider: "openai" },
          },
        },
      });
      expect(JSON.stringify(paid)).not.toContain("env://OPENAI_API_KEY");
      if (paid.status !== "prepared") {
        throw new Error("Expected a paid admission at the exact budget boundary");
      }
      await expect(
        lowQuotaStore.prepare({
          routeHandleHash,
          browserCapabilityHash,
          idempotencyKey: "paid-at-boundary",
          command,
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "PROVIDER_UNAVAILABLE",
        retryable: false,
      });
      expect(
        await runSql(
          `SELECT reserved_micros::text FROM budget_reservations WHERE permit_jti = '${paid.permitJti}';`,
        ),
      ).toBe(String(worstCaseMicros));
      const paidBindings = paid.workload["bindings"] as Readonly<
        Record<string, string>
      >;
      const leaseId = randomUUID();
      await store.activate({
        tenantId,
        locationId,
        reviewSessionId,
        generationBatchId: paidBindings["generationBatchId"]!,
        generationId: paidBindings["generationId"]!,
        requestHash: paidBindings["requestHash"]!,
        permitJti: paid.permitJti,
        leaseId,
        leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
      });
      await store.settle({
        tenantId,
        locationId,
        reviewSessionId,
        generationBatchId: paidBindings["generationBatchId"]!,
        generationId: paidBindings["generationId"]!,
        requestHash: paidBindings["requestHash"]!,
        permitJti: paid.permitJti,
        leaseId,
        actualCostMicros: 0,
      });

      const belowBudgetSnapshotId = randomUUID();
      const belowBudgetSnapshot = {
        ...snapshot,
        snapshotId: belowBudgetSnapshotId,
        settings: {
          ...snapshot.settings,
          monthlyBudgetMicros: worstCaseMicros - 1,
        },
      };
      await runSql(`
        UPDATE tenants
        SET monthly_budget_micros = ${worstCaseMicros - 1}
        WHERE id = '${tenantId}';
        INSERT INTO effective_configuration_snapshots (
          id, tenant_id, location_id, schema_version, content_hash, payload, provenance
        ) VALUES (
          '${belowBudgetSnapshotId}', '${tenantId}', '${locationId}', 2,
          '${contentHashOf(belowBudgetSnapshot)}',
          '${JSON.stringify(belowBudgetSnapshot)}'::jsonb,
          '{}'::jsonb
        );
      `);
      const belowBudgetSession = await createSessionBoundToSnapshot(
        belowBudgetSnapshotId,
      );
      await expect(
        store.prepare({
          routeHandleHash: belowBudgetSession.routeHandleHash,
          browserCapabilityHash: belowBudgetSession.browserCapabilityHash,
          idempotencyKey: "one-micro-short",
          command,
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "BUDGET_EXCEEDED",
        retryable: false,
      });

      const mismatchedRateSnapshotId = randomUUID();
      const mismatchedRateSnapshot = {
        ...snapshot,
        snapshotId: mismatchedRateSnapshotId,
        priceRates: [
          {
            ...snapshot.priceRates[0],
            inputPerMillionMicros: 2_000_001,
          },
        ],
      };
      await runSql(`
        UPDATE tenants
        SET monthly_budget_micros = ${worstCaseMicros}
        WHERE id = '${tenantId}';
        INSERT INTO effective_configuration_snapshots (
          id, tenant_id, location_id, schema_version, content_hash, payload, provenance
        ) VALUES (
          '${mismatchedRateSnapshotId}', '${tenantId}', '${locationId}', 2,
          '${contentHashOf(mismatchedRateSnapshot)}',
          '${JSON.stringify(mismatchedRateSnapshot)}'::jsonb,
          '{}'::jsonb
        );
      `);
      const mismatchedRateSession = await createSessionBoundToSnapshot(
        mismatchedRateSnapshotId,
      );
      await expect(
        store.prepare({
          routeHandleHash: mismatchedRateSession.routeHandleHash,
          browserCapabilityHash: mismatchedRateSession.browserCapabilityHash,
          idempotencyKey: "mismatched-rate",
          command,
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "PROVIDER_UNAVAILABLE",
        retryable: false,
      });

      const expiredRateSnapshotId = randomUUID();
      const expiredRateSnapshot = {
        ...snapshot,
        snapshotId: expiredRateSnapshotId,
        provenance: { testRevision: "expired-rate" },
      };
      await runSql(`
        INSERT INTO effective_configuration_snapshots (
          id, tenant_id, location_id, schema_version, content_hash, payload, provenance
        ) VALUES (
          '${expiredRateSnapshotId}', '${tenantId}', '${locationId}', 2,
          '${contentHashOf(expiredRateSnapshot)}',
          '${JSON.stringify(expiredRateSnapshot)}'::jsonb,
          '{}'::jsonb
        );
        UPDATE price_rates
        SET effective_to = clock_timestamp() - interval '1 second'
        WHERE id = '${priceRateId}';
      `);
      const expiredRateSession = await createSessionBoundToSnapshot(
        expiredRateSnapshotId,
      );
      await expect(
        store.prepare({
          routeHandleHash: expiredRateSession.routeHandleHash,
          browserCapabilityHash: expiredRateSession.browserCapabilityHash,
          idempotencyKey: "expired-rate",
          command,
        }),
      ).resolves.toMatchObject({ status: "prepared" });
      // The snapshot froze the then-effective rate. A later catalog rollover
      // cannot reinterpret that already-published workload; remove this test
      // reservation so the daily-capacity assertions below retain their own
      // isolated baseline.
      await runSql(`
        WITH removed_batch AS (
          DELETE FROM generation_batches
          WHERE tenant_id = '${tenantId}'::uuid
            AND review_session_id = '${expiredRateSession.reviewSessionId}'::uuid
            AND idempotency_key = 'expired-rate'
          RETURNING budget_reservation_id
        )
        DELETE FROM budget_reservations AS reservation
        USING removed_batch
        WHERE reservation.id = removed_batch.budget_reservation_id;
      `);
      await runSql(`
        UPDATE price_rates SET effective_to = NULL WHERE id = '${priceRateId}';
      `);

      const restoredSnapshotId = randomUUID();
      const restoredSnapshot = {
        ...snapshot,
        snapshotId: restoredSnapshotId,
        provenance: { testRevision: "restored-rate" },
      };
      await runSql(`
        INSERT INTO effective_configuration_snapshots (
          id, tenant_id, location_id, schema_version, content_hash, payload, provenance
        ) VALUES (
          '${restoredSnapshotId}', '${tenantId}', '${locationId}', 2,
          '${contentHashOf(restoredSnapshot)}',
          '${JSON.stringify(restoredSnapshot)}'::jsonb,
          '{}'::jsonb
        );
      `);
      const restoredSession = await createSessionBoundToSnapshot(
        restoredSnapshotId,
      );
      await runSql(`
        UPDATE platform_generation_admissions
        SET admitted_at = clock_timestamp() - interval '2 minutes'
        WHERE funded;
        WITH seeded_reservations AS (
          INSERT INTO budget_reservations (
            id, tenant_id, location_id, review_session_id, snapshot_id,
            permit_jti, request_hash, action, reserved_micros,
            actual_cost_micros, status, reserved_at, expires_at, settled_at
          )
          SELECT
            gen_random_uuid(), '${tenantId}'::uuid, '${locationId}'::uuid,
            '${restoredSession.reviewSessionId}'::uuid, '${restoredSnapshotId}'::uuid,
            'daily-seed-' || gen_random_uuid()::text,
            'sha256:' || repeat('0', 64), 'GENERATE', 0, 0, 'SETTLED',
            clock_timestamp() - interval '3 minutes',
            clock_timestamp() + interval '1 hour',
            clock_timestamp() - interval '2 minutes'
          FROM generate_series(1, 29)
          RETURNING id
        )
        INSERT INTO platform_generation_admissions (
          reservation_id, admitted_at, funded, active
        )
        SELECT
          id, clock_timestamp() - interval '2 minutes', true, false
        FROM seeded_reservations;
      `);
      expect(
        await runSql(
          "SELECT count(*) FROM platform_generation_admissions WHERE funded AND admitted_at > clock_timestamp() - interval '1 day';",
        ),
      ).toBe("30");
      await expect(
        store.prepare({
          routeHandleHash: restoredSession.routeHandleHash,
          browserCapabilityHash: restoredSession.browserCapabilityHash,
          idempotencyKey: "funded-daily-31",
          command,
        }),
      ).resolves.toEqual({
        status: "rejected",
        code: "RATE_LIMITED",
        retryable: true,
      });
      expect(
        await runSql(
          `SELECT count(*) FROM budget_reservations WHERE tenant_id = '${tenantId}';`,
        ),
      ).toBe("30");
    } finally {
      await lowQuotaStore.disconnect();
      await store.disconnect();
      const restoredReference = originalCredentialReference.replaceAll("'", "''");
      await runSql(`
        UPDATE providers
        SET credential_reference = '${restoredReference}'
        WHERE id = '${providerId}';
      `);
    }
  });
});
