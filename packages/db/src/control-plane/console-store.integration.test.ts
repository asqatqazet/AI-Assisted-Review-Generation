import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { derivePromptVersionHash } from "@review/domain/experiment";

import {
  createPostgresPromptEvaluationIngestionDatabase,
  ingestPromptEvaluation,
} from "../deployment/prompt-evaluation-ingestion.js";
import {
  ConsoleScopeDeniedError,
  createPostgresConsoleControlPlaneStore as createAuthorizedPostgresConsoleControlPlaneStore,
} from "./index.js";
import { STUDENT_STRICT_ZERO_PROMPT_APPROVAL } from "../deployment/prompt-release-content-policy.js";
import {
  createStrictPromptEvaluationFixture,
  sqlLiteral,
} from "../test-support/strict-prompt-evaluation-fixture.js";
import { resetIntegrationDatabase } from "../test-support/reset-integration-database.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl ? describe : describe.skip;
const consoleDatabaseAuthoritySecret = "ab".repeat(32);

const createPostgresConsoleControlPlaneStore = (input: {
  readonly databaseUrl: string;
}) =>
  createAuthorizedPostgresConsoleControlPlaneStore({
    ...input,
    consoleDatabaseAuthoritySecret,
  });

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

async function runScalar(sql: string): Promise<string> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const { stdout } = await execFileAsync(
    psql,
    [databaseUrl, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

async function resetIntegrationFixtures(): Promise<void> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  await resetIntegrationDatabase({ databaseUrl, psql });
}

function serviceDatabaseUrl(
  role: "console_control_svc" | "context_runtime_svc",
): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = "";
  return url.toString();
}

async function runSqlAs(
  role: "console_control_svc" | "context_runtime_svc",
  sql: string,
): Promise<void> {
  await execFileAsync(
    psql,
    [
      serviceDatabaseUrl(role),
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { maxBuffer: 1024 * 1024 },
  );
}

interface Fixture {
  readonly operatorId: string;
  readonly tenantId: string;
  readonly otherTenantId: string;
  readonly locationId: string;
}

async function seed(): Promise<Fixture> {
  const operatorId = randomUUID();
  const tenantId = STUDENT_STRICT_ZERO_PROMPT_APPROVAL.tenantId;
  const otherTenantId = randomUUID();
  const locationId = randomUUID();

  await runSql(`
    INSERT INTO console_database_authority_keys (singleton, secret)
    VALUES (true, decode('${consoleDatabaseAuthoritySecret}', 'hex'))
    ON CONFLICT (singleton) DO UPDATE SET secret = EXCLUDED.secret;
    INSERT INTO operator_role_definitions (key, capabilities)
    VALUES ('tenant_admin', ARRAY['console:read', 'tenant:configure', 'ai:operate'])
    ON CONFLICT (key) DO UPDATE SET capabilities = EXCLUDED.capabilities;
    INSERT INTO operators (id, email, external_issuer, external_subject)
    VALUES ('${operatorId}', 'console-${operatorId}@example.com',
            'https://issuer.test', 'subject-${operatorId}');
    INSERT INTO entry_mode_definitions (key, semantics)
    VALUES
      ('invite', '{}'::jsonb),
      ('open-qr', '{}'::jsonb)
    ON CONFLICT (key) DO NOTHING;

    BEGIN;
    SELECT set_config('app.tenant_id', '${tenantId}', true);
    INSERT INTO tenants (id, slug, name, locale, category, monthly_budget_micros, default_entry_mode_key)
    VALUES ('${tenantId}', 'tenant-${tenantId}', 'BrightSmile', 'en-GB', 'Dental', 1000000, 'invite');
    INSERT INTO locations (id, tenant_id, slug, name)
    VALUES ('${locationId}', '${tenantId}', 'downtown', 'Downtown');
    INSERT INTO fact_option_categories (tenant_id, key, label, sort_order)
    VALUES ('${tenantId}', 'service', '{"en-GB":"Service"}'::jsonb, 0);
    INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key)
    VALUES ('${tenantId}', '${operatorId}', 'tenant_admin');
    COMMIT;

    BEGIN;
    SELECT set_config('app.tenant_id', '${otherTenantId}', true);
    INSERT INTO tenants (id, slug, name, locale)
    VALUES ('${otherTenantId}', 'tenant-${otherTenantId}', 'Someone Else', 'de-DE');
    COMMIT;
  `);

  return { operatorId, tenantId, otherTenantId, locationId };
}

async function seedPublishableConfiguration(
  fixture: Fixture,
  locationOverrides = "{}",
): Promise<{
  readonly providerModelId: string;
  readonly priceRateId: string;
  readonly promptVersionId: string;
  readonly reviewFormatVersionId: string;
}> {
  const providerId = randomUUID();
  const providerModelId = randomUUID();
  const priceRateId = randomUUID();
  const reviewFormatVersionId = randomUUID();
  const promptVersionId = STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionId;
  const promptDeploymentId = randomUUID();
  const promptEvaluationResultId = randomUUID();
  const promptCandidacyDecisionId = randomUUID();
  const reviewFormatHash = reviewFormatVersionId.replaceAll("-", "").repeat(2);
  const promptBody = "Use only supplied Assertions.";
  const promptKey = "review.generate.release";
  const promptVariables = ["locale", "tone"] as const;
  const promptHash = derivePromptVersionHash({
    key: promptKey,
    commandKind: "generate",
    body: promptBody,
    variables: promptVariables,
  });
  const evaluatedAt = "2026-08-24T00:00:00.000Z";
  const evaluation = createStrictPromptEvaluationFixture({
    promptId: promptVersionId,
    tenantId: fixture.tenantId,
    promptKey,
    promptHash,
    promptBody,
    promptVariables,
    evaluatedAt,
  });
  await runSql(`
    INSERT INTO platform_settings (id, default_policy, rate_limits)
    VALUES ('platform', '{}'::jsonb, '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
    UPDATE provider_models SET routing_priority = NULL;
    INSERT INTO providers (
      id, key, display_name, credential_reference, status
    ) VALUES (
      '${providerId}', 'test-${providerId}', 'Test provider', 'configured', 'ACTIVE'
    );
    INSERT INTO provider_models (
      id, provider_id, model_key, status, routing_priority
    ) VALUES (
      '${providerModelId}', '${providerId}', 'model-v1', 'ACTIVE', 1
    );
    INSERT INTO price_rates (
      id, provider_model_id, currency,
      input_per_million_micros, output_per_million_micros, effective_from
    ) VALUES (
      '${priceRateId}', '${providerModelId}', 'EUR', 0, 0,
      clock_timestamp() - interval '1 day'
    );
    INSERT INTO action_definitions (action, input_contract, status)
    VALUES ('GENERATE', '{"requiredInputs":["assertions"]}'::jsonb, 'ACTIVE')
    ON CONFLICT (action) DO NOTHING;
    INSERT INTO review_format_versions (
      id, format_key, version, locale, target_platform,
      constraints, localized_text, supported_actions, content_hash, status
    ) VALUES (
      '${reviewFormatVersionId}', 'short-review-${reviewFormatVersionId}', 1,
      'any', 'google',
      '{"minChars":10,"maxChars":500,"paragraphs":1,"emojiPolicy":"none","secondPerson":false}'::jsonb,
      '{"displayName":{"en-GB":"Short review"},"description":{"en-GB":"A short review"},"sample":{"en-GB":"Helpful service."}}'::jsonb,
      ARRAY['GENERATE']::generation_action[],
      'sha256:${reviewFormatHash}', 'ACTIVE'
    );
    BEGIN;
    SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
    UPDATE locations
    SET overrides = '${locationOverrides}'::jsonb
    WHERE id = '${fixture.locationId}'::uuid
      AND tenant_id = '${fixture.tenantId}'::uuid;
    INSERT INTO tenant_action_enablements (tenant_id, action, enabled)
    VALUES ('${fixture.tenantId}', 'GENERATE', true);
    INSERT INTO review_format_enablements (
      tenant_id, review_format_version_id, enabled, allowed_actions
    ) VALUES (
      '${fixture.tenantId}', '${reviewFormatVersionId}', true,
      ARRAY['GENERATE']::generation_action[]
    );
    INSERT INTO prompt_versions (
      id, tenant_id, prompt_key, action, content_hash, body, variables,
      version, status
    ) VALUES (
      '${promptVersionId}', '${fixture.tenantId}', '${promptKey}', 'GENERATE',
      '${promptHash}', '${promptBody}', ARRAY['locale','tone']::text[],
      1, 'DRAFT'
    );
    INSERT INTO prompt_evaluation_results (
      id, tenant_id, prompt_version_id, prompt_version_hash, report_hash,
      evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
      suite_name, suite_manifest_hash, report_document, report_canonical
    ) VALUES (
      '${promptEvaluationResultId}', '${fixture.tenantId}', '${promptVersionId}', '${promptHash}',
      '${evaluation.reportHash}', 1, 1, '${evaluation.evaluatorReleaseSha}',
      '${evaluatedAt}'::timestamptz, ${sqlLiteral(evaluation.suiteName)},
      '${evaluation.suiteManifestHash}',
      ${sqlLiteral(evaluation.canonical)}::jsonb,
      ${sqlLiteral(evaluation.canonical)}
    );
    INSERT INTO prompt_candidacy_decisions (
      id, tenant_id, prompt_version_id, prompt_version_hash, decision,
      evaluation_result_id, decided_by
    ) VALUES (
      '${promptCandidacyDecisionId}', '${fixture.tenantId}',
      '${promptVersionId}', '${promptHash}', 'CANDIDATE',
      '${promptEvaluationResultId}', '${fixture.operatorId}'
    );
    INSERT INTO prompt_deployments (
      id, tenant_id, action, prompt_version_id, deployed_by
    ) VALUES (
      '${promptDeploymentId}', '${fixture.tenantId}', 'GENERATE',
      '${promptVersionId}', '${fixture.operatorId}'
    );
    COMMIT;
  `);
  return {
    providerModelId,
    priceRateId,
    promptVersionId,
    reviewFormatVersionId,
  };
}

describeDatabase.sequential("EP-04 Console control-plane store", () => {
  beforeEach(async () => {
    await resetIntegrationFixtures();
  });
  it("rolls back the revision, audit and every Location snapshot when publication cannot materialize", async () => {
    const fixture = await seed();
    await seedPublishableConfiguration(
      fixture,
      '{"providerRouting":{"primaryProvider":"forbidden"}}',
    );
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await expect(
        operations.saveConfigurationDraft({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: null,
          changes: [
            { key: "toneGuidelines", value: "Calm and precise." },
          ],
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "saved" });

      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending configuration Draft");
      }
      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: {
            id: pending.draft.id,
            revision: pending.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).rejects.toThrow(/Location override|Unknown Location override/iu);

      await expect(
        operations.readConfigurationState({
          tenantId: fixture.tenantId,
          locationId: null,
        }),
      ).resolves.toEqual({
        revision: "1",
        draft: {
          id: expect.any(String),
          revision: "1",
          baseRevision: "1",
          changes: [
            { key: "toneGuidelines", value: "Calm and precise." },
          ],
        },
      });
      await expect(operations.readTenant(fixture.tenantId)).resolves.toMatchObject({
        settings: { toneGuidelines: "Plain, factual, first person." },
      });
    } finally {
      await store.disconnect();
    }
  });

  it("materializes every affected Location once and returns the same publication to a retried CAS command", async () => {
    const fixture = await seed();
    const secondLocationId = randomUUID();
    await seedPublishableConfiguration(fixture);
    await runSql(`
      BEGIN;
      SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES (
        '${secondLocationId}', '${fixture.tenantId}',
        'harbour-${secondLocationId}', 'Harbour'
      );
      COMMIT;
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: null,
        changes: [{ key: "toneGuidelines", value: "Calm and precise." }],
        actorId: fixture.operatorId,
      });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending configuration Draft");
      }
      const command = {
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: {
          id: pending.draft.id,
          revision: pending.draft.revision,
        },
        actorId: fixture.operatorId,
      } as const;

      const first = await operations.publishConfiguration(command);
      expect(first).toMatchObject({ status: "published" });
      if (first.status !== "published") {
        throw new Error("Expected the first publication to succeed");
      }
      expect(new Set(first.snapshotIds).size).toBe(2);

      await expect(operations.publishConfiguration(command)).resolves.toEqual(first);
      await expect(
        operations.readConfigurationState({
          tenantId: fixture.tenantId,
          locationId: null,
        }),
      ).resolves.toEqual({ revision: "2", draft: null });
    } finally {
      await store.disconnect();
    }
  });

  it("publishes an active Tenant only to its active Locations and ignores invalid inactive Locations", async () => {
    const fixture = await seed();
    const inactiveLocationId = randomUUID();
    await seedPublishableConfiguration(fixture);
    await runSql(`
      BEGIN;
      SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
      INSERT INTO locations (
        id, tenant_id, slug, name, status, overrides
      ) VALUES (
        '${inactiveLocationId}', '${fixture.tenantId}',
        'inactive-${inactiveLocationId}', 'Inactive invalid fixture',
        'INACTIVE', '{"providerRouting":{"primaryProvider":"forbidden"}}'::jsonb
      );
      COMMIT;
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: null,
        changes: [{ key: "toneGuidelines", value: "Calm and precise." }],
        actorId: fixture.operatorId,
      });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending configuration Draft");
      }

      const published = await operations.publishConfiguration({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: {
          id: pending.draft.id,
          revision: pending.draft.revision,
        },
        actorId: fixture.operatorId,
      });

      expect(published).toMatchObject({ status: "published" });
      if (published.status !== "published") {
        throw new Error("Expected active-scope publication to succeed");
      }
      expect(published.snapshotIds).toHaveLength(1);
      await expect(
        runScalar(`
          SELECT count(*)
          FROM effective_configuration_snapshots
          WHERE tenant_id = '${fixture.tenantId}'::uuid
            AND location_id = '${inactiveLocationId}'::uuid;
        `),
      ).resolves.toBe("0");
    } finally {
      await store.disconnect();
    }
  });

  it("rejects an explicit inactive Location without consuming its Draft", async () => {
    const fixture = await seed();
    await seedPublishableConfiguration(fixture);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
        expectedRevision: "1",
        expectedDraft: null,
        changes: [
          {
            operation: "set-location-override",
            change: { key: "requireDisclosure", value: false },
          },
        ],
        actorId: fixture.operatorId,
      });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending Location Draft");
      }
      await runSql(`
        UPDATE locations
        SET status = 'INACTIVE'
        WHERE id = '${fixture.locationId}'::uuid;
      `);

      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: fixture.locationId,
          expectedRevision: "1",
          expectedDraft: {
            id: pending.draft.id,
            revision: pending.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "conflict" });
      await expect(
        runScalar(`
          SELECT config_revision || ':' || overrides::text
          FROM locations
          WHERE id = '${fixture.locationId}'::uuid;
        `),
      ).resolves.toBe("1:{}");
      await expect(
        runScalar(`
          SELECT count(*)
          FROM configuration_drafts
          WHERE id = '${pending.draft.id}'::uuid;
        `),
      ).resolves.toBe("1");
    } finally {
      await store.disconnect();
    }
  });

  it("publishes an active pre-onboarding Tenant with no active Locations and no snapshots", async () => {
    const fixture = await seed();
    await seedPublishableConfiguration(fixture);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: null,
        changes: [{ key: "toneGuidelines", value: "Ready before onboarding." }],
        actorId: fixture.operatorId,
      });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending Tenant Draft");
      }
      await runSql(`
        UPDATE locations
        SET status = 'INACTIVE'
        WHERE tenant_id = '${fixture.tenantId}'::uuid;
      `);

      const command = {
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: {
          id: pending.draft.id,
          revision: pending.draft.revision,
        },
        actorId: fixture.operatorId,
      } as const;
      const published = await operations.publishConfiguration(command);
      expect(published).toMatchObject({ status: "published", snapshotIds: [] });
      await expect(operations.publishConfiguration(command)).resolves.toEqual(
        published,
      );
      await expect(
        runScalar(`
          SELECT config_revision || ':' || tone_guidelines
          FROM tenants
          WHERE id = '${fixture.tenantId}'::uuid;
        `),
      ).resolves.toBe("2:Ready before onboarding.");
      await expect(
        runScalar(`
          SELECT count(*)
          FROM configuration_drafts
          WHERE id = '${pending.draft.id}'::uuid;
        `),
      ).resolves.toBe("0");
    } finally {
      await store.disconnect();
    }
  });

  it("rejects publication for an inactive Tenant before mutating its Draft", async () => {
    const fixture = await seed();
    await seedPublishableConfiguration(fixture);
    await runSql(`
      INSERT INTO operator_role_definitions (key, capabilities)
      VALUES ('platform_admin', ARRAY['console:read', 'platform:admin'])
      ON CONFLICT (key) DO UPDATE SET capabilities = EXCLUDED.capabilities;
      INSERT INTO platform_access_grants (operator_id, role_key)
      VALUES ('${fixture.operatorId}', 'platform_admin')
      ON CONFLICT (operator_id, role_key) DO NOTHING;
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: null,
        changes: [{ key: "toneGuidelines", value: "Never made live." }],
        actorId: fixture.operatorId,
      });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending Tenant Draft");
      }
      await expect(
        operations.setTenantStatus({
          tenantId: fixture.tenantId,
          status: "suspended",
        }),
      ).resolves.toEqual({ status: "saved" });

      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: {
            id: pending.draft.id,
            revision: pending.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "conflict" });
      await expect(
        operations.setTenantStatus({
          tenantId: fixture.tenantId,
          status: "active",
        }),
      ).resolves.toEqual({ status: "saved" });
      await expect(
        operations.readTenant(fixture.tenantId),
      ).resolves.toMatchObject({
        settings: { toneGuidelines: "Plain, factual, first person." },
      });
      await expect(
        operations.readConfigurationState({
          tenantId: fixture.tenantId,
          locationId: null,
        }),
      ).resolves.toMatchObject({
        revision: "1",
        draft: {
          id: pending.draft.id,
          revision: pending.draft.revision,
          baseRevision: "1",
        },
      });
    } finally {
      await store.disconnect();
    }
  });

  it("binds exactly one publication-effective Price Rate while allowing adjacent history", async () => {
    const fixture = await seed();
    const { providerModelId, priceRateId } =
      await seedPublishableConfiguration(fixture);
    const historicalRateId = randomUUID();
    await runSql(`
      UPDATE price_rates
      SET effective_from = clock_timestamp() - interval '1 hour'
      WHERE id = '${priceRateId}'::uuid;
      INSERT INTO price_rates (
        id, provider_model_id, currency, input_per_million_micros,
        output_per_million_micros, effective_from, effective_to
      )
      SELECT
        '${historicalRateId}'::uuid, '${providerModelId}'::uuid, 'EUR', 0, 0,
        effective_from - interval '1 hour', effective_from
      FROM price_rates
      WHERE id = '${priceRateId}'::uuid;
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: null,
        changes: [{ key: "toneGuidelines", value: "Calm and precise." }],
        actorId: fixture.operatorId,
      });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending configuration Draft");
      }
      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: {
            id: pending.draft.id,
            revision: pending.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).resolves.toMatchObject({ status: "published" });

      const published = await operations.readPublishedConfigurationSnapshot({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
      });
      expect(published).not.toBeNull();
      const payload = published?.payload as {
        readonly priceRates?: readonly { readonly id?: string }[];
      };
      expect(payload.priceRates?.map((rate) => rate.id)).toEqual([priceRateId]);
    } finally {
      await store.disconnect();
    }
  });

  it("materializes sparse Platform, Tenant and Location values with field-accurate provenance", async () => {
    const fixture = await seed();
    await seedPublishableConfiguration(
      fixture,
      '{"requireDisclosure":false}',
    );
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await expect(
        operations.saveConfigurationDraft({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: null,
          changes: [
            { key: "toneGuidelines", value: "Tenant-specific voice." },
          ],
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "saved" });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending configuration Draft");
      }
      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: {
            id: pending.draft.id,
            revision: pending.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).resolves.toMatchObject({ status: "published" });

      const published = await operations.readPublishedConfigurationSnapshot({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
      });
      const payload = published?.payload as {
        readonly settings?: {
          readonly locale?: string;
          readonly toneGuidelines?: string;
          readonly requireDisclosure?: boolean;
        };
        readonly provenance?: Readonly<
          Record<string, { readonly scope?: string; readonly sourceId?: string }>
        >;
      };
      expect(payload.settings).toMatchObject({
        locale: "en-GB",
        toneGuidelines: "Tenant-specific voice.",
        requireDisclosure: false,
      });
      expect(payload.provenance).toMatchObject({
        locale: { scope: "platform", sourceId: "platform" },
        toneGuidelines: { scope: "tenant", sourceId: fixture.tenantId },
        requireDisclosure: {
          scope: "location",
          sourceId: fixture.locationId,
        },
        enabledReviewFormatVersionIds: {
          scope: "tenant",
          sourceId: fixture.tenantId,
        },
        enabledCommands: { scope: "tenant", sourceId: fixture.tenantId },
        providerRouting: { scope: "platform", sourceId: "platform" },
      });
    } finally {
      await store.disconnect();
    }
  });

  it("keeps Facts, Formats, Actions, Prompt deployment and Location overrides invisible until their scoped Draft publishes", async () => {
    const fixture = await seed();
    const { promptVersionId, reviewFormatVersionId } =
      await seedPublishableConfiguration(fixture);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await expect(
        operations.saveConfigurationDraft({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: null,
          changes: [
            {
              operation: "create-fact-option",
              mutationId: "tenant-fact-draft",
              label: "Wheelchair access",
              categoryKey: "service",
              polarity: "positive",
              ownerScope: "tenant",
            },
            {
              operation: "set-review-format-enablement",
              styleId: reviewFormatVersionId,
              enabled: true,
              enabledActions: ["generate"],
            },
            {
              operation: "set-action-enablement",
              action: "generate",
              enabled: true,
            },
            {
              operation: "deploy-prompt-version",
              action: "generate",
              promptVersionId,
            },
          ],
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "saved" });
      await expect(
        operations.listKeywords(fixture.tenantId, null),
      ).resolves.not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "Wheelchair access" }),
        ]),
      );

      const tenantDraft = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (tenantDraft?.draft === null || tenantDraft === null) {
        throw new Error("Expected a Tenant Draft");
      }
      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: {
            id: tenantDraft.draft.id,
            revision: tenantDraft.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).resolves.toMatchObject({ status: "published" });
      await expect(
        operations.listKeywords(fixture.tenantId, null),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Wheelchair access",
            ownerScope: "tenant",
          }),
        ]),
      );

      await expect(
        operations.saveConfigurationDraft({
          tenantId: fixture.tenantId,
          locationId: fixture.locationId,
          expectedRevision: "1",
          expectedDraft: null,
          changes: [
            {
              operation: "set-location-override",
              change: { key: "requireDisclosure", value: false },
            },
            {
              operation: "create-fact-option",
              mutationId: "location-fact-draft",
              label: "Late opening",
              categoryKey: "service",
              polarity: "positive",
              ownerScope: "location",
            },
          ],
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "saved" });
      await expect(
        operations.readLocation(fixture.tenantId, fixture.locationId),
      ).resolves.toMatchObject({ overrides: {} });

      const locationDraft = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
      });
      if (locationDraft?.draft === null || locationDraft === null) {
        throw new Error("Expected a Location Draft");
      }
      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: fixture.locationId,
          expectedRevision: "1",
          expectedDraft: {
            id: locationDraft.draft.id,
            revision: locationDraft.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).resolves.toMatchObject({ status: "published" });
      await expect(
        operations.readLocation(fixture.tenantId, fixture.locationId),
      ).resolves.toMatchObject({
        overrides: { requireDisclosure: false },
      });
      await expect(
        operations.listKeywords(fixture.tenantId, fixture.locationId),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Late opening",
            ownerScope: "location",
          }),
        ]),
      );
    } finally {
      await store.disconnect();
    }
  });

  it("rejects publication when locale filtering leaves no executable Action x Prompt x Format", async () => {
    const fixture = await seed();
    await seedPublishableConfiguration(fixture);
    await runSql(`
      BEGIN;
      SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
      UPDATE review_format_versions
      SET locale = 'de-DE'
      WHERE id IN (
        SELECT review_format_version_id
        FROM review_format_enablements
        WHERE tenant_id = '${fixture.tenantId}'::uuid
      );
      COMMIT;
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
        expectedRevision: "1",
        expectedDraft: null,
        changes: [
          {
            operation: "set-location-override",
            change: { key: "requireDisclosure", value: false },
          },
        ],
        actorId: fixture.operatorId,
      });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending configuration Draft");
      }
      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: fixture.locationId,
          expectedRevision: "1",
          expectedDraft: {
            id: pending.draft.id,
            revision: pending.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({
        status: "incomplete",
        missing: expect.arrayContaining([
          "an executable Action with exactly one Prompt and a locale-compatible Review Format",
        ]),
      });
    } finally {
      await store.disconnect();
    }
  });

  it("atomically moves the single primary provider route and refuses to remove it", async () => {
    const fixture = await seed();
    const firstProviderId = randomUUID();
    const firstModelId = randomUUID();
    const secondProviderId = randomUUID();
    const secondModelId = randomUUID();
    await runSql(`
      INSERT INTO operator_role_definitions (key, capabilities)
      VALUES ('platform_admin', ARRAY['console:read', 'platform:admin', 'provider:manage'])
      ON CONFLICT (key) DO UPDATE SET capabilities = EXCLUDED.capabilities;
      INSERT INTO platform_access_grants (operator_id, role_key)
      VALUES ('${fixture.operatorId}', 'platform_admin')
      ON CONFLICT (operator_id, role_key) DO NOTHING;
      UPDATE provider_models
      SET routing_priority = NULL, fallback_priority = NULL;
      INSERT INTO providers (
        id, key, display_name, credential_reference, status
      ) VALUES
        ('${firstProviderId}', 'first-${firstProviderId}', 'First provider', 'first', 'ACTIVE'),
        ('${secondProviderId}', 'second-${secondProviderId}', 'Second provider', 'second', 'ACTIVE');
      INSERT INTO provider_models (
        id, provider_id, model_key, status, routing_priority, fallback_priority
      ) VALUES
        ('${firstModelId}', '${firstProviderId}', 'first-v1', 'ACTIVE', 1, NULL),
        ('${secondModelId}', '${secondProviderId}', 'second-v1', 'ACTIVE', NULL, 1);
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await expect(
        operations.setProviderRouting({
          providerKey: `second-${secondProviderId}`,
          modelKey: "second-v1",
          routingPriority: 1,
          fallbackPriority: null,
        }),
      ).resolves.toEqual({ status: "saved" });

      const routed = (await operations.readPlatformProviders()).models.filter(
        (model) => model.routingPriority === 1,
      );
      expect(routed).toEqual([
        expect.objectContaining({
          providerKey: `second-${secondProviderId}`,
          modelKey: "second-v1",
        }),
      ]);

      await expect(
        operations.setProviderRouting({
          providerKey: `second-${secondProviderId}`,
          modelKey: "second-v1",
          routingPriority: null,
          fallbackPriority: 1,
        }),
      ).resolves.toEqual({ status: "invalid-routing" });
      expect(
        (await operations.readPlatformProviders()).models.filter(
          (model) => model.routingPriority === 1,
        ),
      ).toHaveLength(1);

      await expect(
        runSql(`
          UPDATE provider_models
          SET routing_priority = 1
          WHERE id = '${firstModelId}'::uuid;
        `),
      ).rejects.toThrow(/provider_models_single_primary_route/iu);
      await expect(
        runSql(`
          UPDATE provider_models
          SET routing_priority = NULL
          WHERE routing_priority = 1;
        `),
      ).rejects.toThrow(/PROVIDER_ROUTING_REQUIRES_EXACTLY_ONE_PRIMARY/iu);
    } finally {
      await store.disconnect();
    }
  });

  it("stores one CAS-protected Tenant Draft without changing live settings", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await expect(
        operations.readConfigurationState({
          tenantId: fixture.tenantId,
          locationId: null,
        }),
      ).resolves.toEqual({ revision: "1", draft: null });

      await expect(
        operations.saveConfigurationDraft({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: null,
          changes: [
            { key: "toneGuidelines", value: "Calm and precise." },
          ],
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "saved" });

      await expect(operations.readTenant(fixture.tenantId)).resolves.toMatchObject({
        settings: { toneGuidelines: "Plain, factual, first person." },
      });
      const firstDraft = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      expect(firstDraft).toEqual({
        revision: "1",
        draft: {
          id: expect.any(String),
          revision: "1",
          baseRevision: "1",
          changes: [{ key: "toneGuidelines", value: "Calm and precise." }],
        },
      });
      if (firstDraft?.draft === null || firstDraft === null) {
        throw new Error("Expected the first Draft revision");
      }

      // A second browser tab holds the same published revision but did not
      // observe the newly-created Draft. It must not overwrite that Draft.
      await expect(
        operations.saveConfigurationDraft({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: null,
          changes: [{ key: "toneGuidelines", value: "Stale second tab." }],
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "conflict" });

      await expect(
        operations.saveConfigurationDraft({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: {
            id: firstDraft.draft.id,
            revision: firstDraft.draft.revision,
          },
          changes: [{ key: "requireDisclosure", value: false }],
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "saved" });

      const secondDraft = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      expect(secondDraft).toMatchObject({
        revision: "1",
        draft: {
          id: firstDraft.draft.id,
          revision: "2",
          baseRevision: "1",
        },
      });

      await expect(
        operations.cancelConfigurationDraft({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: {
            id: firstDraft.draft.id,
            revision: firstDraft.draft.revision,
          },
        }),
      ).resolves.toEqual({ status: "conflict" });
      await expect(
        operations.saveConfigurationDraft({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "0",
          expectedDraft: null,
          changes: [{ key: "toneGuidelines", value: "Stale." }],
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({ status: "conflict" });
    } finally {
      await store.disconnect();
    }
  });

  it("enforces Tenant configuration capability inside PostgreSQL RLS", async () => {
    const operatorId = randomUUID();
    const tenantId = randomUUID();
    const roleKey = `rls_viewer_${operatorId}`;
    await runSql(`
      INSERT INTO operator_role_definitions (key, capabilities, status)
      VALUES ('${roleKey}', ARRAY['console:read'], 'ACTIVE');
      INSERT INTO operators (id, email, external_issuer, external_subject)
      VALUES ('${operatorId}', 'rls-viewer-${operatorId}@example.com',
              'https://issuer.test', 'subject-${operatorId}');
      BEGIN;
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      INSERT INTO tenants (id, slug, name, locale)
      VALUES ('${tenantId}', 'rls-viewer-${tenantId}', 'RLS Viewer Tenant', 'en-GB');
      INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key)
      VALUES ('${tenantId}', '${operatorId}', '${roleKey}');
      COMMIT;
    `);

    await expect(
      runSqlAs("console_control_svc", `
        BEGIN;
        SELECT set_config('app.operator_id', '${operatorId}', true);
        SELECT set_config('app.tenant_id', '${tenantId}', true);
        INSERT INTO locations (tenant_id, slug, name)
        VALUES ('${tenantId}', 'rls-forbidden', 'RLS Forbidden');
        COMMIT;
      `),
    ).rejects.toThrow();
  });

  it("refuses a null-Operator Console connection even when it names a Tenant", async () => {
    const tenantId = randomUUID();
    await runSql(`
      BEGIN;
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      INSERT INTO tenants (id, slug, name, locale)
      VALUES ('${tenantId}', 'sealed-${tenantId}', 'Sealed Tenant', 'en-GB');
      COMMIT;
    `);

    await expect(
      runSqlAs("console_control_svc", `
        BEGIN;
        SELECT set_config('app.tenant_id', '${tenantId}', true);
        INSERT INTO locations (tenant_id, slug, name)
        VALUES ('${tenantId}', 'forged-scope', 'Forged Scope');
        COMMIT;
      `),
    ).rejects.toThrow(/row-level security/iu);
  });

  it("does not let the reviewer runtime mutate Operator Access Grants", async () => {
    const fixture = await seed();

    await expect(
      runSqlAs("context_runtime_svc", `
        BEGIN;
        SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
        UPDATE tenant_access_grants
        SET status = 'REVOKED', revoked_at = clock_timestamp()
        WHERE tenant_id = '${fixture.tenantId}'::uuid
          AND operator_id = '${fixture.operatorId}'::uuid;
        COMMIT;
      `),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("lets a Tenant viewer read its scope but refuses configuration writes", async () => {
    const operatorId = randomUUID();
    const tenantId = randomUUID();
    const roleKey = `tenant_viewer_${operatorId}`;
    await runSql(`
      INSERT INTO console_database_authority_keys (singleton, secret)
      VALUES (true, decode('${consoleDatabaseAuthoritySecret}', 'hex'))
      ON CONFLICT (singleton) DO UPDATE SET secret = EXCLUDED.secret;
      INSERT INTO operator_role_definitions (key, capabilities, status)
      VALUES ('${roleKey}', ARRAY['console:read'], 'ACTIVE');
      INSERT INTO operators (id, email, external_issuer, external_subject)
      VALUES ('${operatorId}', 'viewer-${operatorId}@example.com',
              'https://issuer.test', 'subject-${operatorId}');
      BEGIN;
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      INSERT INTO tenants (id, slug, name, locale)
      VALUES ('${tenantId}', 'viewer-${tenantId}', 'Viewer Tenant', 'en-GB');
      INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key)
      VALUES ('${tenantId}', '${operatorId}', '${roleKey}');
      COMMIT;
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(operatorId);
      await expect(operations.readTenant(tenantId)).resolves.toMatchObject({
        id: tenantId,
        name: "Viewer Tenant",
      });
      await expect(
        operations.createLocation({
          tenantId,
          name: "Forbidden Location",
          slug: "forbidden",
          address: {
            line1: "",
            line2: "",
            postalCode: "",
            city: "",
            country: "",
          },
          entryMode: null,
        }),
      ).rejects.toBeInstanceOf(ConsoleScopeDeniedError);
    } finally {
      await store.disconnect();
    }
  });

  it("reads a granted Tenant and refuses another Tenant through RLS", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);

      await expect(operations.readTenant(fixture.tenantId)).resolves.toMatchObject(
        { slug: `tenant-${fixture.tenantId}`, name: "BrightSmile", locale: "en-GB" },
      );

      // The operator holds no Grant here; RLS must hide it entirely.
      await expect(
        operations.readTenant(fixture.otherTenantId),
      ).resolves.toBeNull();
    } finally {
      await store.disconnect();
    }
  });

  it("publishes a business context version instead of rewriting one", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.publishContextVersion({
        tenantId: fixture.tenantId,
        version: 1,
        context: "Family dental practice.",
        bannedTerms: ["painless"],
        createdBy: fixture.operatorId,
      });
      await operations.publishContextVersion({
        tenantId: fixture.tenantId,
        version: 2,
        context: "Family dental practice. Two surgeries.",
        bannedTerms: ["painless", "guaranteed"],
        createdBy: fixture.operatorId,
      });

      const versions = await operations.listContextVersions(fixture.tenantId);

      expect(versions.map((version) => version.version)).toEqual([2, 1]);
      expect(versions[1]?.context).toBe("Family dental practice.");
    } finally {
      await store.disconnect();
    }
  });

  it("re-evaluates the reviewed strict-$0 Prompt and keeps its staged deployment idempotent", async () => {
    const fixture = await seed();
    const { promptVersionId: originallyDeployedPromptId } =
      await seedPublishableConfiguration(fixture);
    const candidatePrompt = {
      key: "review.generate.release",
      commandKind: "generate" as const,
      body: "Use only supplied Assertions.",
      variables: ["locale", "tone"] as const,
    };
    const candidateHash = derivePromptVersionHash(candidatePrompt);

    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const evaluationDatabase =
      createPostgresPromptEvaluationIngestionDatabase(databaseUrl);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.createPromptVersion({
        tenantId: fixture.tenantId,
        action: "generate",
        key: candidatePrompt.key,
        version: 1,
        hash: candidateHash,
        body: candidatePrompt.body,
        variables: candidatePrompt.variables,
        createdBy: fixture.operatorId,
      });
      const created = (
        await operations.listPrompts(fixture.tenantId, "generate")
      ).find((prompt) => prompt.hash === candidateHash);
      if (created === undefined) {
        throw new Error("Expected the reviewed immutable Prompt Version");
      }
      expect(created.id).toBe(originallyDeployedPromptId);
      const evidence = await ingestPromptEvaluation(evaluationDatabase, {
        promptVersionId: created.id,
        evaluatorReleaseSha: "abcdef0123456789abcdef0123456789abcdef01",
        suiteName: "grounding-release-v1",
        suiteManifestHash: `sha256:${"a".repeat(64)}`,
        scenarios: [
          {
            id: "grounding-positive",
            description: "A grounded output passes",
            tenantId: fixture.tenantId,
            action: "generate",
            reviewFormatKey: "concise-blurb",
            promptVersionKey: candidatePrompt.key,
            assertions: [
              {
                id: "a1",
                semanticId: "friendly-service",
                semanticKind: "experience-fact",
                polarity: "positive",
                text: "The service was friendly.",
              },
            ],
            mockedModelOutput: {
              draft: "The service was friendly.",
              claims: [
                {
                  id: "c1",
                  text: "The service was friendly.",
                  assertionIds: ["a1"],
                },
              ],
            },
            expectedVerdict: "pass",
            expectedMaxChars: 280,
          },
          {
            id: "grounding-adversarial",
            description: "An invented output is rejected",
            tenantId: fixture.tenantId,
            action: "generate",
            reviewFormatKey: "concise-blurb",
            promptVersionKey: candidatePrompt.key,
            assertions: [
              {
                id: "a1",
                semanticId: "friendly-service",
                semanticKind: "experience-fact",
                polarity: "positive",
                text: "The service was friendly.",
              },
            ],
            mockedModelOutput: {
              draft: "The service included a free upgrade.",
              claims: [
                {
                  id: "c1",
                  text: "The service included a free upgrade.",
                  assertionIds: ["invented"],
                },
              ],
            },
            expectedVerdict: "rejected",
            expectedRejectionCode: "unknown-assertion",
          },
        ],
        evaluatedAt: "2026-08-24T12:00:00.000Z",
      });
      expect(evidence.status).toBe("inserted");
      await expect(
        runScalar(`
          SELECT evaluator_release_sha || '|' || report_hash
          FROM prompt_evaluation_results
          WHERE tenant_id = '${fixture.tenantId}'::uuid
            AND prompt_version_id = '${created.id}'::uuid
          ORDER BY evaluated_at DESC, recorded_at DESC, id DESC
          LIMIT 1;
        `),
      ).resolves.toBe(
        `abcdef0123456789abcdef0123456789abcdef01|${evidence.reportHash}`,
      );

      await expect(
        operations.promotePromptVersion({
          tenantId: fixture.tenantId,
          promptVersionId: created.id,
        }),
      ).resolves.toEqual({ status: "candidate" });
      const reevaluation = await ingestPromptEvaluation(evaluationDatabase, {
        promptVersionId: created.id,
        evaluatorReleaseSha: "abcdef0123456789abcdef0123456789abcdef02",
        suiteName: "grounding-release-v1",
        suiteManifestHash: `sha256:${"b".repeat(64)}`,
        scenarios: [
          {
            id: "grounding-positive-rerun",
            description: "A later grounded output passes",
            tenantId: fixture.tenantId,
            action: "generate",
            reviewFormatKey: "concise-blurb",
            promptVersionKey: candidatePrompt.key,
            assertions: [
              {
                id: "a1",
                semanticId: "friendly-service",
                semanticKind: "experience-fact",
                polarity: "positive",
                text: "The service was friendly.",
              },
            ],
            mockedModelOutput: {
              draft: "The service was friendly.",
              claims: [
                {
                  id: "c1",
                  text: "The service was friendly.",
                  assertionIds: ["a1"],
                },
              ],
            },
            expectedVerdict: "pass",
            expectedMaxChars: 280,
          },
        ],
        evaluatedAt: "2026-08-24T12:01:00.000Z",
      });
      expect(reevaluation.status).toBe("inserted");
      await expect(
        operations.promotePromptVersion({
          tenantId: fixture.tenantId,
          promptVersionId: created.id,
        }),
      ).resolves.toEqual({ status: "candidate" });
      await expect(
        runScalar(`
          SELECT count(*)::text || '|' ||
                 bool_or(decision.evaluation_result_id = latest.id)::text
          FROM prompt_candidacy_decisions AS decision
          CROSS JOIN LATERAL (
            SELECT evaluation.id
            FROM prompt_evaluation_results AS evaluation
            WHERE evaluation.prompt_version_id = '${created.id}'::uuid
            ORDER BY evaluation.evaluated_at DESC,
                     evaluation.recorded_at DESC,
                     evaluation.id DESC
            LIMIT 1
          ) AS latest
          WHERE decision.prompt_version_id = '${created.id}'::uuid
            AND decision.decision = 'CANDIDATE';
        `),
      ).resolves.toBe("3|true");
      await expect(
        runScalar(`
          SELECT prompt_version_id
          FROM prompt_deployments
          WHERE tenant_id = '${fixture.tenantId}'::uuid
            AND action = 'GENERATE';
        `),
      ).resolves.toBe(originallyDeployedPromptId);
      await expect(
        operations.listPrompts(fixture.tenantId, "generate"),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: originallyDeployedPromptId,
            status: "published",
          }),
        ]),
      );

      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: null,
        changes: [
          {
            operation: "deploy-prompt-version",
            action: "generate",
            promptVersionId: originallyDeployedPromptId,
          },
        ],
        actorId: fixture.operatorId,
      });
      const stagedA = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (stagedA?.draft === null || stagedA === null) {
        throw new Error("Expected Prompt A in the Tenant Draft");
      }
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: stagedA.revision,
        expectedDraft: {
          id: stagedA.draft.id,
          revision: stagedA.draft.revision,
        },
        changes: [
          {
            operation: "deploy-prompt-version",
            action: "generate",
            promptVersionId: created.id,
          },
        ],
        actorId: fixture.operatorId,
      });
      const stagedB = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (stagedB?.draft === null || stagedB === null) {
        throw new Error("Expected Prompt B in the Tenant Draft");
      }
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: stagedB.revision,
        expectedDraft: {
          id: stagedB.draft.id,
          revision: stagedB.draft.revision,
        },
        changes: [
          {
            operation: "deploy-prompt-version",
            action: "generate",
            promptVersionId: originallyDeployedPromptId,
          },
        ],
        actorId: fixture.operatorId,
      });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending Tenant Draft");
      }
      expect(pending.draft.changes).toEqual([
        {
          operation: "deploy-prompt-version",
          action: "generate",
          promptVersionId: originallyDeployedPromptId,
        },
      ]);
      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: "1",
          expectedDraft: {
            id: pending.draft.id,
            revision: pending.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).resolves.toMatchObject({ status: "published" });
      await expect(
        runScalar(`
          SELECT prompt_version_id
          FROM prompt_deployments
          WHERE tenant_id = '${fixture.tenantId}'::uuid
            AND action = 'GENERATE';
        `),
      ).resolves.toBe(originallyDeployedPromptId);
      const prompts = await operations.listPrompts(fixture.tenantId, "generate");
      expect(prompts.filter((prompt) => prompt.status === "published")).toEqual([
        expect.objectContaining({ id: originallyDeployedPromptId }),
      ]);
      expect(
        prompts.find((prompt) => prompt.id === created.id)?.status,
      ).toBe("published");
    } finally {
      await evaluationDatabase.disconnect();
      await store.disconnect();
    }
  });

  it("aborts a Tenant publication when a deployed Prompt's latest evaluation no longer passes", async () => {
    const fixture = await seed();
    const { promptVersionId } = await seedPublishableConfiguration(fixture);
    const failedAt = "2026-08-24T01:00:00.000Z";
    const failedEvaluation = createStrictPromptEvaluationFixture({
      promptId: promptVersionId,
      tenantId: fixture.tenantId,
      promptKey: "review.generate.release",
      promptHash: STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionHash,
      promptBody: "Use only supplied Assertions.",
      promptVariables: ["locale", "tone"],
      evaluatedAt: failedAt,
      scenarioId: "failing-release-regression",
      passed: false,
    });
    await runSql(`
      BEGIN;
      SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
      INSERT INTO prompt_evaluation_results (
        tenant_id, prompt_version_id, prompt_version_hash, report_hash,
        evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
        suite_name, suite_manifest_hash, report_document, report_canonical
      )
      SELECT
        prompt.tenant_id, prompt.id, prompt.content_hash,
        '${failedEvaluation.reportHash}', ${failedEvaluation.evaluatedCases},
        ${failedEvaluation.passedCases}, '${failedEvaluation.evaluatorReleaseSha}',
        '${failedAt}'::timestamptz, ${sqlLiteral(failedEvaluation.suiteName)},
        '${failedEvaluation.suiteManifestHash}',
        ${sqlLiteral(failedEvaluation.canonical)}::jsonb,
        ${sqlLiteral(failedEvaluation.canonical)}
      FROM prompt_versions AS prompt
      WHERE prompt.id = '${promptVersionId}'::uuid;
      COMMIT;
    `);

    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await operations.saveConfigurationDraft({
        tenantId: fixture.tenantId,
        locationId: null,
        expectedRevision: "1",
        expectedDraft: null,
        changes: [{ key: "toneGuidelines", value: "Calm and exact." }],
        actorId: fixture.operatorId,
      });
      const pending = await operations.readConfigurationState({
        tenantId: fixture.tenantId,
        locationId: null,
      });
      if (pending?.draft === null || pending === null) {
        throw new Error("Expected a pending Tenant Draft");
      }
      const snapshotsBefore = await runScalar(
        `SELECT count(*) FROM effective_configuration_snapshots WHERE tenant_id = '${fixture.tenantId}'::uuid;`,
      );

      await expect(
        operations.publishConfiguration({
          tenantId: fixture.tenantId,
          locationId: null,
          expectedRevision: pending.revision,
          expectedDraft: {
            id: pending.draft.id,
            revision: pending.draft.revision,
          },
          actorId: fixture.operatorId,
        }),
      ).resolves.toEqual({
        status: "incomplete",
        missing: ["a currently eligible deployed Prompt Version for generate"],
      });
      await expect(
        operations.readConfigurationState({
          tenantId: fixture.tenantId,
          locationId: null,
        }),
      ).resolves.toEqual(pending);
      await expect(
        runScalar(
          `SELECT count(*) FROM effective_configuration_snapshots WHERE tenant_id = '${fixture.tenantId}'::uuid;`,
        ),
      ).resolves.toBe(snapshotsBefore);
    } finally {
      await store.disconnect();
    }
  });

  it("rejects Prompt candidacy without canonical passing evidence", async () => {
    const fixture = await seed();
    const noncanonicalId = randomUUID();
    const unevaluatedId = randomUUID();
    const unevaluated = {
      key: `review.generate.${unevaluatedId}`,
      commandKind: "generate" as const,
      body: "Canonical but unevaluated body",
      variables: [] as const,
    };
    const unevaluatedHash = derivePromptVersionHash(unevaluated);
    const noncanonicalHash = `sha256:${"3".repeat(64)}`;
    const noncanonicalEvaluatedAt = "2026-08-24T02:00:00.000Z";
    const noncanonicalEvidence = createStrictPromptEvaluationFixture({
      promptId: noncanonicalId,
      tenantId: fixture.tenantId,
      promptKey: "noncanonical",
      promptHash: noncanonicalHash,
      promptBody: "Body does not match hash",
      promptVariables: [],
      evaluatedAt: noncanonicalEvaluatedAt,
      scenarioId: "noncanonical-prompt",
    });
    const aiRoleKey = `ai_operator_${fixture.operatorId}`;
    await runSql(`
      INSERT INTO operator_role_definitions (key, capabilities, status)
      VALUES ('${aiRoleKey}', ARRAY['console:read', 'ai:operate'], 'ACTIVE');
      BEGIN;
      SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
      INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key)
      VALUES ('${fixture.tenantId}', '${fixture.operatorId}', '${aiRoleKey}');
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body, variables, version, status
      ) VALUES
        ('${noncanonicalId}', '${fixture.tenantId}', 'noncanonical', 'GENERATE',
         '${noncanonicalHash}', 'Body does not match hash', '{}', 1, 'DRAFT'),
        ('${unevaluatedId}', '${fixture.tenantId}', '${unevaluated.key}', 'GENERATE',
         '${unevaluatedHash}', '${unevaluated.body}', '{}', 2, 'DRAFT');
      INSERT INTO prompt_evaluation_results (
        tenant_id, prompt_version_id, prompt_version_hash, report_hash,
        evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
        suite_name, suite_manifest_hash, report_document, report_canonical
      ) VALUES (
        '${fixture.tenantId}', '${noncanonicalId}', '${noncanonicalHash}',
        '${noncanonicalEvidence.reportHash}',
        ${noncanonicalEvidence.evaluatedCases}, ${noncanonicalEvidence.passedCases},
        '${noncanonicalEvidence.evaluatorReleaseSha}',
        '${noncanonicalEvaluatedAt}'::timestamptz,
        ${sqlLiteral(noncanonicalEvidence.suiteName)},
        '${noncanonicalEvidence.suiteManifestHash}',
        ${sqlLiteral(noncanonicalEvidence.canonical)}::jsonb,
        ${sqlLiteral(noncanonicalEvidence.canonical)}
      );
      COMMIT;
    `);

    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await expect(
        operations.promotePromptVersion({
          tenantId: fixture.tenantId,
          promptVersionId: noncanonicalId,
        }),
      ).resolves.toEqual({ status: "quality-gate-rejected" });
      await expect(
        operations.promotePromptVersion({
          tenantId: fixture.tenantId,
          promptVersionId: unevaluatedId,
        }),
      ).resolves.toEqual({ status: "quality-gate-rejected" });
    } finally {
      await store.disconnect();
    }
  });

  it("idempotently inserts immutable Prompt Version content without updating it", async () => {
    const fixture = await seed();
    const aiRoleKey = `ai_operator_${fixture.operatorId}`;
    await runSql(`
      INSERT INTO operator_role_definitions (key, capabilities, status)
      VALUES ('${aiRoleKey}', ARRAY['console:read', 'ai:operate'], 'ACTIVE');
      BEGIN;
      SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
      INSERT INTO tenant_access_grants (tenant_id, operator_id, role_key)
      VALUES ('${fixture.tenantId}', '${fixture.operatorId}', '${aiRoleKey}');
      COMMIT;
    `);
    const prompt = {
      tenantId: fixture.tenantId,
      action: "generate" as const,
      key: `review.generate.${fixture.tenantId}`,
      version: 1,
      body: "Use only the supplied Assertions.",
      variables: ["locale", "tone"],
      createdBy: fixture.operatorId,
    };
    const input = {
      ...prompt,
      hash: derivePromptVersionHash({
        key: prompt.key,
        commandKind: prompt.action,
        body: prompt.body,
        variables: prompt.variables,
      }),
    };
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await expect(operations.createPromptVersion(input)).resolves.toBeUndefined();
      await expect(operations.createPromptVersion(input)).resolves.toBeUndefined();
      expect(
        (await operations.listPrompts(fixture.tenantId, "generate")).filter(
          (candidate) => candidate.hash === input.hash,
        ),
      ).toHaveLength(1);
    } finally {
      await store.disconnect();
    }
  });

  it("keeps Experiments unavailable until strict-$0 has two approved Prompt artifacts", async () => {
    const fixture = await seed();
    const { promptVersionId: approvedPromptId } =
      await seedPublishableConfiguration(fixture);
    const unapprovedPromptId = randomUUID();
    const unapprovedPrompt = {
      key: `review.generate.${unapprovedPromptId}`,
      commandKind: "generate" as const,
      body: "A second Prompt without reviewed provider-behaviour evidence.",
      variables: [] as const,
    };
    const unapprovedPromptHash = derivePromptVersionHash(unapprovedPrompt);
    const aiRoleKey = `ai_operator_${fixture.operatorId}`;
    await runSql(`
      INSERT INTO operator_role_definitions (key, capabilities, status)
      VALUES ('${aiRoleKey}', ARRAY['console:read', 'ai:operate'], 'ACTIVE')
      ON CONFLICT (key) DO UPDATE SET capabilities = EXCLUDED.capabilities;
      BEGIN;
      SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body,
        variables, version, status
      ) VALUES (
        '${unapprovedPromptId}', '${fixture.tenantId}', '${unapprovedPrompt.key}',
        'GENERATE', '${unapprovedPromptHash}', '${unapprovedPrompt.body}',
        ARRAY[]::text[], 2, 'DRAFT'
      );
      COMMIT;
    `);

    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await expect(
        operations.createExperiment({
          tenantId: fixture.tenantId,
          action: "generate",
          variants: [
            { promptVersionId: approvedPromptId, weightPct: 50 },
            { promptVersionId: approvedPromptId, weightPct: 50 },
          ],
        }),
      ).resolves.toEqual({ status: "invalid-variants" });
      await expect(
        operations.createExperiment({
          tenantId: fixture.tenantId,
          action: "generate",
          variants: [
            { promptVersionId: approvedPromptId, weightPct: 50 },
            { promptVersionId: unapprovedPromptId, weightPct: 50 },
          ],
        }),
      ).resolves.toEqual({ status: "invalid-variants" });
      await expect(
        operations.listExperiments(fixture.tenantId),
      ).resolves.toEqual([]);
    } finally {
      await store.disconnect();
    }
  });

  it("refuses a duplicate Location slug inside one Tenant", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      const address = {
        line1: "1 High Street",
        line2: "",
        postalCode: "BS1 1AA",
        city: "Bristol",
        country: "GB",
      };

      await expect(
        operations.createLocation({
          tenantId: fixture.tenantId,
          name: "Downtown Annexe",
          slug: "downtown",
          address,
          entryMode: null,
        }),
      ).resolves.toEqual({ status: "slug-taken" });

      await expect(
        operations.createLocation({
          tenantId: fixture.tenantId,
          name: "Harbour",
          slug: "harbour",
          address,
          entryMode: "open-qr",
        }),
      ).resolves.toEqual({ status: "created" });
    } finally {
      await store.disconnect();
    }
  });

  it("stores a Location override and removes it again on reset", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);

      await operations.writeLocationOverrides({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
        overrides: { requireDisclosure: false },
      });
      await expect(
        operations.readLocation(fixture.tenantId, fixture.locationId),
      ).resolves.toMatchObject({ overrides: { requireDisclosure: false } });

      await operations.writeLocationOverrides({
        tenantId: fixture.tenantId,
        locationId: fixture.locationId,
        overrides: {},
      });
      const location = await operations.readLocation(
        fixture.tenantId,
        fixture.locationId,
      );
      expect(Object.hasOwn(location!.overrides, "requireDisclosure")).toBe(false);
    } finally {
      await store.disconnect();
    }
  });

  it("builds the distribution link from the venue's own slugs", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const distribution = await store
        .forOperator(fixture.operatorId)
        .readDistribution(
          fixture.tenantId,
          fixture.locationId,
          "https://review.example.test",
        );

      expect(distribution?.surveyUrl).toBe(
        `https://review.example.test/s/tenant-${fixture.tenantId}/downtown`,
      );
      expect(distribution?.counters).toEqual({
        issued: 0,
        opened: 0,
        completed: 0,
      });
    } finally {
      await store.disconnect();
    }
  });

  it("omits inactive fixture Locations from normal lists and selectors", async () => {
    const fixture = await seed();
    const inactiveLocationId = randomUUID();
    await runSql(`
      BEGIN;
      SELECT set_config('app.tenant_id', '${fixture.tenantId}', true);
      INSERT INTO locations (id, tenant_id, slug, name, status)
      VALUES (
        '${inactiveLocationId}', '${fixture.tenantId}',
        'fsdfdsfsdfsd', 'fsdfdsfsdfsd', 'INACTIVE'
      );
      COMMIT;
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      await expect(operations.listLocations(fixture.tenantId)).resolves.not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: inactiveLocationId }),
        ]),
      );
      const selectors = await operations.listSelectableTenants();
      expect(
        selectors.flatMap((tenant) => tenant.locations.map((location) => location.id)),
      ).not.toContain(inactiveLocationId);
    } finally {
      await store.disconnect();
    }
  });

  it("publishes a Fact Option and edits it as a new version", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);

      await expect(
        operations.createKeyword({
          tenantId: fixture.tenantId,
          locationId: null,
          label: "Friendly staff",
          categoryKey: "service",
          polarity: "positive",
        }),
      ).resolves.toEqual({ status: "created" });

      await expect(
        operations.createKeyword({
          tenantId: fixture.tenantId,
          locationId: null,
          label: "Friendly staff",
          categoryKey: "not-a-category",
          polarity: "positive",
        }),
      ).resolves.toEqual({ status: "unknown-category" });

      const [created] = await operations.listKeywords(fixture.tenantId, null);
      expect(created).toMatchObject({
        label: "Friendly staff",
        ownerScope: "tenant",
        active: true,
      });

      await operations.updateKeyword({
        tenantId: fixture.tenantId,
        keywordId: created!.id,
        label: "Consistently friendly staff",
        polarity: "positive",
        active: true,
      });

      const live = await operations.listKeywords(fixture.tenantId, null);
      expect(live).toHaveLength(1);
      expect(live[0]?.label).toBe("Consistently friendly staff");
      expect(live[0]?.id).not.toBe(created!.id);
    } finally {
      await store.disconnect();
    }
  });

  it("refuses to write into a Tenant the operator holds no Grant for", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      // A read degrades to the empty projection; a write must not quietly
      // succeed against someone else's account.
      await expect(
        store.forOperator(fixture.operatorId).createLocation({
          tenantId: fixture.otherTenantId,
          name: "Not mine",
          slug: "not-mine",
          address: {
            line1: "",
            line2: "",
            postalCode: "",
            city: "",
            country: "",
          },
          entryMode: null,
        }),
      ).rejects.toBeInstanceOf(ConsoleScopeDeniedError);

      await expect(
        store.forOperator(fixture.operatorId).listLocations(fixture.otherTenantId),
      ).resolves.toEqual([]);
    } finally {
      await store.disconnect();
    }
  });

  it("keeps Platform-only projections empty for a Tenant operator", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      // The service refuses this scope first; the store refuses it again.
      await expect(
        store.forOperator(fixture.operatorId).listPlatformTenants(),
      ).resolves.toEqual([]);
    } finally {
      await store.disconnect();
    }
  });

  it("provisions and suspends an account from Platform scope", async () => {
    const fixture = await seed();
    await runSql(`
      INSERT INTO operator_role_definitions (key, capabilities)
      VALUES ('platform_admin', ARRAY['console:read', 'platform:admin'])
      ON CONFLICT (key) DO UPDATE SET capabilities = EXCLUDED.capabilities;
      INSERT INTO platform_access_grants (operator_id, role_key)
      VALUES ('${fixture.operatorId}', 'platform_admin')
      ON CONFLICT (operator_id, role_key) DO NOTHING;
    `);
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      const operations = store.forOperator(fixture.operatorId);
      const slug = `provisioned-${fixture.tenantId}`;

      // Platform scope sets no app.tenant_id, so this INSERT is exactly the
      // one Row-Level Security used to reject.
      await expect(
        operations.createTenant({
          name: "Provisioned Account",
          slug,
          locale: "en-GB",
          category: "Dental",
          plan: "growth",
        }),
      ).resolves.toEqual({ status: "created" });

      const created = (await operations.listPlatformTenants()).find(
        (tenant) => tenant.slug === slug,
      );
      expect(created).toMatchObject({ status: "active", suspendable: true });

      await expect(
        operations.setTenantStatus({
          tenantId: created!.id,
          status: "suspended",
        }),
      ).resolves.toEqual({ status: "saved" });

      expect(
        (await operations.listPlatformTenants()).find(
          (tenant) => tenant.slug === slug,
        ),
      ).toMatchObject({ status: "suspended" });
    } finally {
      await store.disconnect();
    }
  });

  it("refuses account provisioning to an operator without a Platform Grant", async () => {
    const fixture = await seed();
    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceDatabaseUrl("console_control_svc"),
    });
    try {
      await expect(
        store.forOperator(fixture.operatorId).createTenant({
          name: "Not Allowed",
          slug: `not-allowed-${fixture.tenantId}`,
          locale: "en-GB",
          category: "",
          plan: "lite",
        }),
      ).rejects.toBeInstanceOf(ConsoleScopeDeniedError);
    } finally {
      await store.disconnect();
    }
  });
});
