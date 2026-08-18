import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  createPostgresGenerationLeaseJournal,
  createPostgresGenerationTerminalStore,
  createPostgresReviewerDispositionStore,
} from "./execution-plane/index.js";

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

interface SeededScope {
  readonly tenantId: string;
  readonly locationId: string;
  readonly reviewSessionId: string;
  readonly generationBatchId: string;
  readonly generationId: string;
  readonly permitJti: string;
  readonly snapshotId: string;
}

interface SeededPrice {
  readonly providerModelId: string;
  readonly priceRateId: string;
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
    snapshotId,
  };
}

async function seedPrice(): Promise<SeededPrice> {
  const providerId = randomUUID();
  const providerModelId = randomUUID();
  const priceRateId = randomUUID();

  await runSql(`
    INSERT INTO providers (
      id, key, display_name, credential_reference
    ) VALUES (
      '${providerId}', 'provider-${providerId}', 'TDD Provider', 'fake://local'
    );
    INSERT INTO provider_models (
      id, provider_id, model_key
    ) VALUES (
      '${providerModelId}', '${providerId}', 'model-${providerModelId}'
    );
    INSERT INTO price_rates (
      id, provider_model_id, currency, input_per_million_micros,
      output_per_million_micros, effective_from
    ) VALUES (
      '${priceRateId}', '${providerModelId}', 'EUR', 0, 0,
      clock_timestamp() - interval '1 day'
    );
  `);

  return { providerModelId, priceRateId };
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

async function prepareLease(
  scope: SeededScope,
  permitLifetime: string = "1 minute",
): Promise<string> {
  const result = await runSql(
    tenantTransaction(
      scope.tenantId,
      `SELECT outcome, lease_id FROM prepare_generation_lease(
        '${scope.tenantId}',
        '${scope.locationId}',
        '${scope.reviewSessionId}',
        '${scope.generationBatchId}',
        '${scope.generationId}',
        '${scope.permitJti}',
        clock_timestamp() + interval '${permitLifetime}'
      );`,
    ),
  );
  const leaseId = result.split("|")[1];
  if (!leaseId) {
    throw new Error(`Lease preparation returned no lease id: ${result}`);
  }
  return leaseId;
}

describeDatabase("US-03.2 PostgreSQL execution fence", () => {
  it("exposes a sealed tenant-scoped execution journal", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const scope = await seedScope();
    const journal = createPostgresGenerationLeaseJournal({ databaseUrl });

    try {
      const prepared = await journal.prepare({
        ...scope,
        permitExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      expect(prepared.status).toBe("leased");
      await expect(journal.status(scope)).resolves.toEqual({ state: "leased" });
    } finally {
      await journal.disconnect();
    }
  });

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

  it("allows two concurrent executions to claim only one paid Attempt", async () => {
    const scope = await seedScope();
    const price = await seedPrice();
    const leaseId = await prepareLease(scope);
    const claim = tenantTransaction(
      scope.tenantId,
      `SELECT outcome, attempt_id FROM claim_generation_attempt(
        '${leaseId}',
        '${scope.tenantId}',
        '${scope.locationId}',
        '${scope.reviewSessionId}',
        '${scope.generationBatchId}',
        '${scope.generationId}',
        '${scope.permitJti}',
        clock_timestamp() + interval '30 seconds',
        1,
        '${price.providerModelId}',
        '${price.priceRateId}',
        '{}'::jsonb
      );`,
    );

    const outcomes = await Promise.all([runSql(claim), runSql(claim)]);
    const attemptIds = outcomes.map((outcome) => outcome.split("|")[1]);

    expect(outcomes.map((outcome) => outcome.split("|")[0]).sort()).toEqual([
      "claimed",
      "existing",
    ]);
    expect(new Set(attemptIds).size).toBe(1);
    expect(
      await runSql(
        `SELECT count(*) FROM provider_attempts WHERE execution_lease_id = '${leaseId}';`,
      ),
    ).toBe("1");
  });

  it("cancels an expired no-provider lease and fences delayed execution", async () => {
    const scope = await seedScope();
    const price = await seedPrice();
    const leaseId = await prepareLease(scope, "400 milliseconds");
    await new Promise((resolve) => setTimeout(resolve, 600));

    const cancellation = runSql(
      tenantTransaction(
        scope.tenantId,
        `SELECT cancel_expired_generation_lease(
          '${leaseId}',
          '${scope.tenantId}',
          '${scope.locationId}',
          '${scope.reviewSessionId}',
          '${scope.generationBatchId}',
          '${scope.generationId}',
          '${scope.permitJti}'
        );`,
      ),
    );
    const delayedClaim = runSql(
      tenantTransaction(
        scope.tenantId,
        `SELECT outcome, attempt_id FROM claim_generation_attempt(
          '${leaseId}',
          '${scope.tenantId}',
          '${scope.locationId}',
          '${scope.reviewSessionId}',
          '${scope.generationBatchId}',
          '${scope.generationId}',
          '${scope.permitJti}',
          clock_timestamp() + interval '30 seconds',
          1,
          '${price.providerModelId}',
          '${price.priceRateId}',
          '{}'::jsonb
        );`,
      ),
    );

    const [cancelResult, claimResult] = await Promise.allSettled([
      cancellation,
      delayedClaim,
    ]);

    expect(cancelResult).toEqual({ status: "fulfilled", value: "cancelled" });
    expect(claimResult.status).toBe("rejected");
    expect(
      await runSql(
        `SELECT state FROM execution_leases WHERE id = '${leaseId}';`,
      ),
    ).toBe("CANCELLED");
    expect(
      await runSql(
        `SELECT count(*) FROM provider_attempts WHERE execution_lease_id = '${leaseId}';`,
      ),
    ).toBe("0");
  });

  it("atomically persists a grounded terminal Generation, Claim and Draft", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const scope = await seedScope();
    const price = await seedPrice();
    const promptVersionId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    const assertionId = randomUUID();
    const categoryId = randomUUID();
    const factOptionVersionId = randomUUID();
    await runSql(`
      INSERT INTO review_format_versions (
        id, format_key, version, locale, target_platform, constraints,
        localized_text, supported_actions, content_hash
      ) VALUES (
        '${reviewFormatVersionId}', 'format-${reviewFormatVersionId}', 1,
        'en-GB', 'generic', '{"minChars":1,"maxChars":500}'::jsonb,
        '{"displayName":{"en-GB":"Concise"},"description":{"en-GB":"Short"},"sample":{"en-GB":"Sample"}}'::jsonb,
        ARRAY['GENERATE']::generation_action[],
        'format-hash-${reviewFormatVersionId}'
      );
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body
      ) VALUES (
        '${promptVersionId}', '${scope.tenantId}', 'prompt-${promptVersionId}',
        'GENERATE', 'prompt-hash-${promptVersionId}', 'Generate grounded JSON.'
      );
      INSERT INTO fact_option_categories (id, tenant_id, key, label)
      VALUES (
        '${categoryId}', '${scope.tenantId}', 'category-${categoryId}',
        '{"en-GB":"Service"}'::jsonb
      );
      INSERT INTO fact_option_versions (
        id, tenant_id, location_id, category_id, fact_option_key, version,
        owner_scope, label, proposition, polarity
      ) VALUES (
        '${factOptionVersionId}', '${scope.tenantId}', '${scope.locationId}',
        '${categoryId}', 'fact-${factOptionVersionId}', 1, 'LOCATION',
        '{"en-GB":"Attentive"}'::jsonb, 'The team was attentive.', 'POSITIVE'
      );
      INSERT INTO assertions (
        id, tenant_id, location_id, review_session_id, source,
        proposition, fact_option_version_id
      ) VALUES (
        '${assertionId}', '${scope.tenantId}', '${scope.locationId}',
        '${scope.reviewSessionId}', 'FACT_OPTION',
        'The team was attentive.', '${factOptionVersionId}'
      );
    `);
    const leaseId = await prepareLease(scope);
    const journal = createPostgresGenerationLeaseJournal({ databaseUrl });
    const claimed = await journal.claimExecution({
      ...scope,
      leaseId,
      activationExpiresAt: new Date(Date.now() + 20_000).toISOString(),
      attemptOrdinal: 1,
      providerModelId: price.providerModelId,
      priceRateId: price.priceRateId,
      requestPayload: { model: "fake-v1" },
    });
    const terminalStore = createPostgresGenerationTerminalStore({ databaseUrl });
    const dispositionStore = createPostgresReviewerDispositionStore({ databaseUrl });

    try {
      const terminal = await terminalStore.complete({
          ...scope,
          leaseId,
          attemptId: claimed.attemptId,
          promptVersionId,
          reviewFormatVersionId,
          action: "GENERATE",
          result: {
            draft: "The team was attentive.",
            claims: [
              {
                proposition: "The team was attentive.",
                assertionIds: [assertionId],
              },
            ],
            inputTokens: 12,
            outputTokens: 7,
            providerReceipt: { requestId: "fake-request-a" },
          },
        });
      expect(terminal).toMatchObject({
        draft: {
          generationId: scope.generationId,
          revision: 1,
          text: "The team was attentive.",
        },
        actualCostMicros: 0,
      });
      await expect(terminalStore.read(scope)).resolves.toMatchObject({
        draft: {
          generationId: scope.generationId,
          revision: 1,
          text: "The team was attentive.",
        },
        actualCostMicros: 0,
      });

      expect(
        await runSql(
          `SELECT status::text || '|' || grounding_verdict::text FROM generations WHERE id = '${scope.generationId}';`,
        ),
      ).toBe("SUCCEEDED|PASSED");
      expect(
        await runSql(
          `SELECT count(*) FROM claim_groundings WHERE generation_id = '${scope.generationId}';`,
        ),
      ).toBe("1");
      expect(
        await runSql(`SELECT state::text FROM execution_leases WHERE id = '${leaseId}';`),
      ).toBe("TERMINAL");

      const finalText = "The team was exceptionally attentive.";
      const dispositionInput = {
        tenantId: scope.tenantId,
        locationId: scope.locationId,
        reviewSessionId: scope.reviewSessionId,
        draftId: terminal.draft.id,
        generationId: scope.generationId,
        finalTextHash: `sha256:${createHash("sha256").update(finalText).digest("hex")}`,
        idempotencyKey: "disposition-a",
        permitJti: "disposition-permit-a",
        finalText,
        normalizedEditDistance: 0.21,
      };
      await expect(
        dispositionStore.readOriginal(dispositionInput),
      ).resolves.toEqual({ text: "The team was attentive." });
      const recorded = await dispositionStore.record(dispositionInput);
      await expect(dispositionStore.record(dispositionInput)).resolves.toEqual(
        recorded,
      );
      expect(recorded).toMatchObject({ kind: "edited", revision: 2 });
      expect(recorded.normalizedEditDistance).toBeGreaterThan(0);
      expect(
        await runSql(
          `SELECT count(*) FROM draft_revisions WHERE draft_id = '${terminal.draft.id}';`,
        ),
      ).toBe("2");
      expect(
        await runSql(
          `SELECT kind::text || '|' || (normalized_edit_distance > 0)::text FROM dispositions WHERE draft_id = '${terminal.draft.id}';`,
        ),
      ).toBe("EDITED|true");
    } finally {
      await dispositionStore.disconnect();
      await terminalStore.disconnect();
      await journal.disconnect();
    }
  });

  it("atomically persists a rejected terminal and never creates a Draft", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const scope = await seedScope();
    const price = await seedPrice();
    const promptVersionId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    await runSql(`
      INSERT INTO review_format_versions (
        id, format_key, version, locale, target_platform, constraints,
        localized_text, supported_actions, content_hash
      ) VALUES (
        '${reviewFormatVersionId}', 'format-${reviewFormatVersionId}', 1,
        'en-GB', 'generic', '{"minChars":1,"maxChars":500}'::jsonb,
        '{"displayName":{"en-GB":"Concise"},"description":{"en-GB":"Short"},"sample":{"en-GB":"Sample"}}'::jsonb,
        ARRAY['GENERATE']::generation_action[],
        'format-hash-${reviewFormatVersionId}'
      );
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body
      ) VALUES (
        '${promptVersionId}', '${scope.tenantId}', 'prompt-${promptVersionId}',
        'GENERATE', 'prompt-hash-${promptVersionId}', 'Generate grounded JSON.'
      );
    `);
    const leaseId = await prepareLease(scope);
    const journal = createPostgresGenerationLeaseJournal({ databaseUrl });
    const claimed = await journal.claimExecution({
      ...scope,
      leaseId,
      activationExpiresAt: new Date(Date.now() + 20_000).toISOString(),
      attemptOrdinal: 1,
      providerModelId: price.providerModelId,
      priceRateId: price.priceRateId,
      requestPayload: { model: "fake-v1" },
    });
    const terminalStore = createPostgresGenerationTerminalStore({ databaseUrl });

    try {
      await expect(
        terminalStore.reject({
          ...scope,
          leaseId,
          attemptId: claimed.attemptId,
          promptVersionId,
          reviewFormatVersionId,
          action: "GENERATE",
          code: "PROVIDER_UNAVAILABLE",
          retryable: true,
        }),
      ).resolves.toEqual({ actualCostMicros: 0 });
      await expect(terminalStore.read(scope)).resolves.toEqual({
        rejection: { code: "PROVIDER_UNAVAILABLE", retryable: true },
        actualCostMicros: 0,
      });
      expect(
        await runSql(
          `SELECT status::text || '|' || grounding_verdict::text FROM generations WHERE id = '${scope.generationId}';`,
        ),
      ).toBe("PROVIDER_ERROR|REJECTED");
      expect(
        await runSql(
          `SELECT status::text || '|' || error_code FROM provider_attempts WHERE id = '${claimed.attemptId}';`,
        ),
      ).toBe("FAILED|PROVIDER_UNAVAILABLE");
      expect(
        await runSql(
          `SELECT state::text || '|' || (terminal_at IS NOT NULL)::text FROM execution_leases WHERE id = '${leaseId}';`,
        ),
      ).toBe("TERMINAL|true");
      expect(
        await runSql(
          `SELECT count(*) FROM drafts WHERE originating_generation_id = '${scope.generationId}';`,
        ),
      ).toBe("0");
    } finally {
      await terminalStore.disconnect();
      await journal.disconnect();
    }
  });
});
