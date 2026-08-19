import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { createContextRuntime } from "../apps/context-service/src/runtime.js";
import { createGenerationRuntime } from "../apps/generation-service/src/runtime.js";
import {
  createInvokedContextPort,
  createInvokedReviewerGenerationContextPort,
} from "../apps/web-bff/src/adapters/context-function.port.js";
import { createInvokedReviewerGenerationExecutionPort } from "../apps/web-bff/src/adapters/generation-function.port.js";
import { createWebBffApp } from "../apps/web-bff/src/app.js";
import { createHmacCsrfProtector } from "../apps/web-bff/src/security/csrf-protector.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl ? describe : describe.skip;
const publicOrigin = "https://reviews.example.test";

async function runSql(sql: string): Promise<string> {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required for database acceptance tests");
  }
  const { stdout } = await execFileAsync(
    psql,
    [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

const sqlJson = (value: unknown): string =>
  JSON.stringify(value).replaceAll("'", "''");

async function seedJourney(): Promise<{
  readonly tenantSlug: string;
  readonly locationSlug: string;
  readonly factOptionId: string;
  readonly reviewFormatVersionId: string;
  readonly tenantId: string;
}> {
  const tenantId = randomUUID();
  const locationId = randomUUID();
  const categoryId = randomUUID();
  const factOptionId = randomUUID();
  const reviewFormatVersionId = randomUUID();
  const reviewFormatEnablementId = randomUUID();
  const snapshotId = randomUUID();
  const promptVersionId = randomUUID();
  const tenantSlug = `tenant-${tenantId}`;
  const locationSlug = `location-${locationId}`;
  let providerId = await runSql(
    "SELECT id FROM providers WHERE key = 'fake' LIMIT 1;",
  );
  if (providerId.length === 0) {
    providerId = randomUUID();
    await runSql(`
      INSERT INTO providers (id, key, display_name, credential_reference)
      VALUES ('${providerId}', 'fake', 'Fake Provider', 'fake://local');
    `);
  }
  let providerModelId = await runSql(
    `SELECT id FROM provider_models WHERE provider_id = '${providerId}' AND model_key = 'fake-v1' LIMIT 1;`,
  );
  if (providerModelId.length === 0) {
    providerModelId = randomUUID();
    await runSql(`
      INSERT INTO provider_models (id, provider_id, model_key)
      VALUES ('${providerModelId}', '${providerId}', 'fake-v1');
    `);
  }
  let priceRateId = await runSql(
    `SELECT id FROM price_rates WHERE provider_model_id = '${providerModelId}' AND input_per_million_micros = 0 AND output_per_million_micros = 0 LIMIT 1;`,
  );
  if (priceRateId.length === 0) {
    priceRateId = randomUUID();
    await runSql(`
      INSERT INTO price_rates (
        id, provider_model_id, currency, input_per_million_micros,
        output_per_million_micros, effective_from
      ) VALUES (
        '${priceRateId}', '${providerModelId}', 'EUR', 0, 0,
        clock_timestamp() - interval '1 day'
      );
    `);
  }
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
    INSERT INTO entry_mode_definitions (key, semantics)
    VALUES ('open-qr', '{"verification":false}'::jsonb)
    ON CONFLICT (key) DO NOTHING;
    INSERT INTO tenants (
      id, slug, name, locale, default_entry_mode_key, monthly_budget_micros, policy
    ) VALUES (
      '${tenantId}', '${tenantSlug}', 'Apex Dental', 'en-GB', 'open-qr', 0,
      '{"maxActiveGenerations":1}'::jsonb
    );
    INSERT INTO locations (id, tenant_id, slug, name)
    VALUES ('${locationId}', '${tenantId}', '${locationSlug}', 'Central Clinic');
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
    INSERT INTO effective_configuration_snapshots (
      id, tenant_id, location_id, schema_version, content_hash, payload, provenance
    ) VALUES (
      '${snapshotId}', '${tenantId}', '${locationId}', 2,
      'sha256:snapshot-${snapshotId}', '${sqlJson(snapshot)}'::jsonb, '{}'::jsonb
    );
  `);

  return {
    tenantSlug,
    locationSlug,
    factOptionId,
    reviewFormatVersionId,
    tenantId,
  };
}

const dataEvents = (body: string): readonly unknown[] =>
  body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as unknown);

function createJourneyApp(
  activeDatabaseUrl: string,
  {
    fakeDelayMs = 0,
    fakeFailure = false,
  }: { readonly fakeDelayMs?: number; readonly fakeFailure?: boolean } = {},
) {
  const contextKeys = generateKeyPairSync("ed25519");
  const generationKeys = generateKeyPairSync("ed25519");
  const context = createContextRuntime({
    databaseUrl: activeDatabaseUrl,
    contextPrivateKeyPem: contextKeys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    generationPublicKeyPem: generationKeys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  });
  const generation = createGenerationRuntime({
    databaseUrl: activeDatabaseUrl,
    contextPublicKeyPem: contextKeys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    generationPrivateKeyPem: generationKeys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    fakeDelayMs,
    fakeFailure,
  });
  const contextInvoker = { invoke: context };
  return createWebBffApp({
    contextPort: createInvokedContextPort(contextInvoker),
    reviewerGenerationContextPort:
      createInvokedReviewerGenerationContextPort(contextInvoker),
    reviewerGenerationExecutionPort:
      createInvokedReviewerGenerationExecutionPort({ invoke: generation }),
    csrfProtector: createHmacCsrfProtector(
      "acceptance-secret-at-least-32-characters",
    ),
    newBrowserCapability: () => "browser-capability-acceptance-123456789",
    publicOrigin,
  });
}

async function enterReview(
  app: ReturnType<typeof createWebBffApp>,
  seeded: Awaited<ReturnType<typeof seedJourney>>,
): Promise<{ readonly cookie: string; readonly reviewSessionHandle: string }> {
  const entryResponse = await app.request(
    `/s/${seeded.tenantSlug}/${seeded.locationSlug}`,
  );
  expect(entryResponse.status).toBe(303);
  const cookie = entryResponse.headers.get("set-cookie")?.split(";")[0];
  const entryPath = entryResponse.headers.get("location");
  if (cookie === undefined || entryPath === null) {
    throw new Error("Entry did not issue its browser capability and route");
  }
  expect(entryPath).toMatch(/^\/start\//);
  const entryHandle = entryPath.slice("/start/".length);

  const challengeResponse = await app.request(
    `/api/v1/entry-challenges/${entryHandle}`,
    { headers: { Cookie: cookie } },
  );
  const challenge = (await challengeResponse.json()) as {
    readonly csrfToken: string;
  };
  expect(challengeResponse.status).toBe(200);

  const startResponse = await app.request(
    `/api/v1/entry-challenges/${entryHandle}/start`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: publicOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rating: 4,
        action: "generate",
        csrfToken: challenge.csrfToken,
      }),
    },
  );
  expect(startResponse.status).toBe(303);
  const reviewPath = startResponse.headers.get("location");
  if (reviewPath === null) {
    throw new Error("Entry did not create a Review Session route");
  }
  expect(reviewPath).toMatch(/^\/review\//);
  const reviewSessionHandle = reviewPath.slice("/review/".length);

  const reviewResponse = await app.request(
    `/api/v1/review-sessions/${reviewSessionHandle}`,
    { headers: { Cookie: cookie } },
  );
  expect(reviewResponse.status).toBe(200);
  await expect(reviewResponse.json()).resolves.toMatchObject({
    status: "ready",
    factOptions: [{ id: seeded.factOptionId }],
    reviewFormats: [{ id: seeded.reviewFormatVersionId }],
  });
  return { cookie, reviewSessionHandle };
}

describeDatabase("R1 browser-to-PostgreSQL walking skeleton", () => {
  it("persists a settled grounded Draft through all three deployables", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database acceptance tests");
    }
    const seeded = await seedJourney();
    const app = createJourneyApp(databaseUrl);
    const { cookie, reviewSessionHandle } = await enterReview(app, seeded);

    const requestBody = JSON.stringify({
      factOptionIds: [seeded.factOptionId],
      reviewFormatId: seeded.reviewFormatVersionId,
    });
    const generationResponse = await app.request(
      `/api/v1/review-sessions/${reviewSessionHandle}/generations`,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: publicOrigin,
          "Idempotency-Key": `request-${randomUUID()}`,
          "x-amz-content-sha256": createHash("sha256")
            .update(requestBody)
            .digest("hex"),
        },
        body: requestBody,
      },
    );
    expect(generationResponse.status).toBe(200);
    expect(dataEvents(await generationResponse.text())).toEqual([
      { type: "accepted" },
      { type: "progress", phase: "generating", elapsedSeconds: 0 },
      {
        type: "terminal",
        status: "completed",
        draft: expect.objectContaining({ text: "The team was attentive." }),
      },
    ]);
    expect(
      await runSql(`
        SELECT
          count(DISTINCT generation.id)::text || '|' ||
          count(DISTINCT claim.id)::text || '|' ||
          count(DISTINCT draft.id)::text || '|' ||
          max(reservation.status::text)
        FROM generations AS generation
        JOIN claims AS claim ON claim.generation_id = generation.id
        JOIN drafts AS draft ON draft.originating_generation_id = generation.id
        JOIN generation_batches AS generation_batch
          ON generation_batch.id = generation.generation_batch_id
        JOIN budget_reservations AS reservation
          ON reservation.id = generation_batch.budget_reservation_id
        WHERE generation.tenant_id = '${seeded.tenantId}';
      `),
    ).toBe("1|1|1|SETTLED");
  });

  it("settles provider failure without exposing or persisting a Draft", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database acceptance tests");
    }
    const seeded = await seedJourney();
    const app = createJourneyApp(databaseUrl, { fakeFailure: true });
    const { cookie, reviewSessionHandle } = await enterReview(app, seeded);
    const requestBody = JSON.stringify({
      factOptionIds: [seeded.factOptionId],
      reviewFormatId: seeded.reviewFormatVersionId,
    });
    const response = await app.request(
      `/api/v1/review-sessions/${reviewSessionHandle}/generations`,
      {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: publicOrigin,
          "Idempotency-Key": `request-${randomUUID()}`,
          "x-amz-content-sha256": createHash("sha256")
            .update(requestBody)
            .digest("hex"),
        },
        body: requestBody,
      },
    );

    expect(dataEvents(await response.text())).toEqual([
      { type: "accepted" },
      { type: "progress", phase: "generating", elapsedSeconds: 0 },
      {
        type: "terminal",
        status: "rejected",
        code: "PROVIDER_UNAVAILABLE",
        retryable: true,
      },
    ]);
    expect(
      await runSql(`
        SELECT
          generation.status::text || '|' ||
          reservation.status::text || '|' ||
          count(draft.id)::text
        FROM generations AS generation
        JOIN generation_batches AS generation_batch
          ON generation_batch.id = generation.generation_batch_id
        JOIN budget_reservations AS reservation
          ON reservation.id = generation_batch.budget_reservation_id
        LEFT JOIN drafts AS draft
          ON draft.originating_generation_id = generation.id
        WHERE generation.tenant_id = '${seeded.tenantId}'
        GROUP BY generation.status, reservation.status;
      `),
    ).toBe("PROVIDER_ERROR|SETTLED|0");
  });

  it(
    "keeps a 60-second Generation alive using progress-only heartbeats",
    async () => {
      if (databaseUrl === undefined) {
        throw new Error("DATABASE_URL is required for database acceptance tests");
      }
      const seeded = await seedJourney();
      const app = createJourneyApp(databaseUrl, { fakeDelayMs: 60_000 });
      const { cookie, reviewSessionHandle } = await enterReview(app, seeded);
      const requestBody = JSON.stringify({
        factOptionIds: [seeded.factOptionId],
        reviewFormatId: seeded.reviewFormatVersionId,
      });
      const response = await app.request(
        `/api/v1/review-sessions/${reviewSessionHandle}/generations`,
        {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            Cookie: cookie,
            Origin: publicOrigin,
            "Idempotency-Key": `request-${randomUUID()}`,
            "x-amz-content-sha256": createHash("sha256")
              .update(requestBody)
              .digest("hex"),
          },
          body: requestBody,
        },
      );
      const events = dataEvents(await response.text()) as readonly Readonly<
        Record<string, unknown>
      >[];
      const terminalIndex = events.findIndex((event) => event["type"] === "terminal");
      const heartbeats = events.filter((event) => event["type"] === "heartbeat");

      expect(events.slice(0, 2)).toEqual([
        { type: "accepted" },
        { type: "progress", phase: "generating", elapsedSeconds: 0 },
      ]);
      expect(heartbeats.length).toBeGreaterThanOrEqual(5);
      expect(
        events
          .slice(0, terminalIndex)
          .some((event) => event["draft"] !== undefined),
      ).toBe(false);
      expect(events.at(-1)).toMatchObject({
        type: "terminal",
        status: "completed",
        draft: { text: "The team was attentive." },
      });
    },
    75_000,
  );
});
