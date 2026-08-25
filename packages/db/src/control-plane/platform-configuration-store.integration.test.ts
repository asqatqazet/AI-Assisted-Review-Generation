import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { derivePromptVersionHash } from "@review/domain/experiment";

import { STUDENT_STRICT_ZERO_PROMPT_APPROVAL } from "../deployment/prompt-release-content-policy.js";
import {
  createStrictPromptEvaluationFixture,
  sqlLiteral,
} from "../test-support/strict-prompt-evaluation-fixture.js";
import { resetIntegrationDatabase } from "../test-support/reset-integration-database.js";
import {
  ConsoleScopeDeniedError,
  createPostgresConsoleControlPlaneStore,
  type PlatformConfigurationChange,
} from "./index.js";
import { createConsoleOperatorAuthorizationProof } from "./console-database-authority.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl ? describe : describe.skip;
const authoritySecret = "cd".repeat(32);

async function sql(statement: string): Promise<void> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  await execFileAsync(
    psql,
    [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { maxBuffer: 1024 * 1024 },
  );
}

async function scalar(statement: string): Promise<string> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const { stdout } = await execFileAsync(
    psql,
    [
      databaseUrl,
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

async function scalarAsOperator(
  operatorId: string,
  statement: string,
): Promise<string> {
  const proof = createConsoleOperatorAuthorizationProof({
    secretHex: authoritySecret,
    operatorId,
  });
  const { stdout } = await execFileAsync(
    psql,
    [
      serviceUrl(),
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `BEGIN;
       SELECT console_bind_operator_authorization(
         '${operatorId}'::uuid,
         ${proof.issuedAtMs}::bigint,
         '${proof.nonce}'::uuid,
         '${proof.mac}'
       );
       ${statement}
       ROLLBACK;`,
    ],
    { maxBuffer: 1024 * 1024 },
  );
  const values = stdout.trim().split("\n");
  return values.at(-1)?.trim() ?? "";
}

function serviceUrl(): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const url = new URL(databaseUrl);
  url.username = "console_control_svc";
  url.password = "";
  return url.toString();
}

describeDatabase.sequential("Platform Configuration Draft PostgreSQL adapter", () => {
  beforeEach(async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    await resetIntegrationDatabase({ databaseUrl, psql });
  });

  it("publishes routing, rates and settings atomically to every Location and rolls back a retroactive retry", async () => {
    const operatorId = randomUUID();
    const settingsOnlyOperatorId = randomUUID();
    const providerOnlyOperatorId = randomUUID();
    const tenantId = STUDENT_STRICT_ZERO_PROMPT_APPROVAL.tenantId;
    const locationIds = [randomUUID(), randomUUID()] as const;
    const inactiveTenantId = randomUUID();
    const inactiveLocationId = randomUUID();
    const providerId = randomUUID();
    const providerModelId = randomUUID();
    const currentRateId = randomUUID();
    const reviewFormatId = randomUUID();
    const promptIds: string[] = [];
    const fullRole = `platform_draft_full_${operatorId}`;
    const settingsRole = `platform_draft_settings_${settingsOnlyOperatorId}`;
    const providerRole = `platform_draft_provider_${providerOnlyOperatorId}`;
    const formatHash = `sha256:${reviewFormatId.replaceAll("-", "").repeat(2)}`;

    await sql(`
      INSERT INTO platform_settings (id, default_policy, rate_limits)
      VALUES ('platform', '{}'::jsonb, '{}'::jsonb);
      INSERT INTO platform_configuration_states (singleton, published_revision)
      VALUES (true, 1);
      INSERT INTO console_database_authority_keys (singleton, secret)
      VALUES (true, decode('${authoritySecret}', 'hex'))
      ON CONFLICT (singleton) DO UPDATE SET secret = EXCLUDED.secret;
      INSERT INTO operator_role_definitions (key, capabilities, status)
      VALUES
        ('${fullRole}', ARRAY['console:read', 'platform:admin', 'provider:manage'], 'ACTIVE'),
        ('${settingsRole}', ARRAY['console:read', 'platform:admin'], 'ACTIVE'),
        ('${providerRole}', ARRAY['console:read', 'provider:manage'], 'ACTIVE');
      INSERT INTO operators (id, email, external_issuer, external_subject)
      VALUES
        ('${operatorId}', 'platform-${operatorId}@example.test', 'https://issuer.test', 'platform-${operatorId}'),
        ('${settingsOnlyOperatorId}', 'settings-${settingsOnlyOperatorId}@example.test', 'https://issuer.test', 'settings-${settingsOnlyOperatorId}'),
        ('${providerOnlyOperatorId}', 'provider-${providerOnlyOperatorId}@example.test', 'https://issuer.test', 'provider-${providerOnlyOperatorId}');
      INSERT INTO platform_access_grants (operator_id, role_key)
      VALUES
        ('${operatorId}', '${fullRole}'),
        ('${settingsOnlyOperatorId}', '${settingsRole}'),
        ('${providerOnlyOperatorId}', '${providerRole}');
      INSERT INTO entry_mode_definitions (key, semantics)
      VALUES ('invite', '{}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO action_definitions (action, input_contract, status)
      VALUES ('GENERATE', '{"requiredInputs":["assertions"]}'::jsonb, 'ACTIVE')
      ON CONFLICT (action) DO NOTHING;
      INSERT INTO review_format_versions (
        id, format_key, version, locale, target_platform, constraints,
        localized_text, supported_actions, content_hash, status
      ) VALUES (
        '${reviewFormatId}', 'platform-draft-format-${reviewFormatId}', 1,
        'any', 'google',
        '{"minChars":10,"maxChars":500,"paragraphs":1,"emojiPolicy":"none","secondPerson":false}'::jsonb,
        '{"displayName":{"en-GB":"Platform Draft format"}}'::jsonb,
        ARRAY['GENERATE']::generation_action[], '${formatHash}', 'ACTIVE'
      );
      INSERT INTO tenants (
        id, slug, name, locale, default_entry_mode_key
      ) VALUES (
        '${inactiveTenantId}', 'inactive-platform-tenant-${inactiveTenantId}',
        'Inactive Platform Tenant', 'en-GB', 'invite'
      );
      INSERT INTO locations (id, tenant_id, slug, name, status)
      VALUES (
        '${inactiveLocationId}', '${inactiveTenantId}',
        'inactive-location-${inactiveLocationId}', 'Inactive Location',
        'INACTIVE'
      );
      BEGIN;
      SET CONSTRAINTS provider_models_exactly_one_primary_route DEFERRED;
      UPDATE provider_models
      SET routing_priority = NULL, fallback_priority = NULL;
      INSERT INTO providers (
        id, key, display_name, credential_reference, status
      ) VALUES (
        '${providerId}', 'platform-provider-${providerId}',
        'Platform provider', 'configured', 'ACTIVE'
      );
      INSERT INTO provider_models (
        id, provider_id, model_key, capabilities, status, routing_priority
      ) VALUES (
        '${providerModelId}', '${providerId}', 'model-v1',
        '{"streaming":true,"structuredOutput":true,"maxTokens":4096}'::jsonb,
        'ACTIVE', 1
      );
      INSERT INTO price_rates (
        id, provider_model_id, currency, input_per_million_micros,
        output_per_million_micros, effective_from
      ) VALUES (
        '${currentRateId}', '${providerModelId}', 'EUR', 1000, 2000,
        clock_timestamp() - interval '1 day'
      );
      COMMIT;
    `);

    const promptId = STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionId;
    promptIds.push(promptId);
    const evaluationId = randomUUID();
    const decisionId = randomUUID();
    const deploymentId = randomUUID();
    const prompt = {
      key: "review.generate.release",
      commandKind: "generate" as const,
      body: "Use only supplied Assertions.",
      variables: ["locale", "tone"] as const,
    };
    const promptHash = derivePromptVersionHash(prompt);
    const evaluatedAt = "2026-08-24T00:00:00.000Z";
    const evaluation = createStrictPromptEvaluationFixture({
      promptId,
      tenantId,
      promptKey: prompt.key,
      promptHash,
      promptBody: prompt.body,
      promptVariables: prompt.variables,
      evaluatedAt,
      suiteName: "platform-configuration-publish-fixture-v1",
    });
    await sql(`
      BEGIN;
      SELECT set_config('app.tenant_id', '${tenantId}', true);
      INSERT INTO tenants (
        id, slug, name, locale, default_entry_mode_key
      ) VALUES (
        '${tenantId}', 'platform-tenant-${tenantId}',
        'Platform Tenant', 'en-GB', 'invite'
      );
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES
        (
          '${locationIds[0]}', '${tenantId}', 'location-${locationIds[0]}',
          'Location 0'
        ),
        (
          '${locationIds[1]}', '${tenantId}', 'location-${locationIds[1]}',
          'Location 1'
        );
      INSERT INTO tenant_action_enablements (tenant_id, action, enabled)
      VALUES ('${tenantId}', 'GENERATE', true);
      INSERT INTO review_format_enablements (
        tenant_id, review_format_version_id, enabled, allowed_actions
      ) VALUES (
        '${tenantId}', '${reviewFormatId}', true,
        ARRAY['GENERATE']::generation_action[]
      );
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body, variables,
        version, status
      ) VALUES (
        '${promptId}', '${tenantId}', '${prompt.key}', 'GENERATE',
        '${promptHash}', '${prompt.body}', ARRAY['locale','tone']::text[], 1, 'DRAFT'
      );
      INSERT INTO prompt_evaluation_results (
        id, tenant_id, prompt_version_id, prompt_version_hash, report_hash,
        evaluated_cases, passed_cases, evaluator_release_sha, evaluated_at,
        suite_name, suite_manifest_hash, report_document, report_canonical
      ) VALUES (
        '${evaluationId}', '${tenantId}', '${promptId}', '${promptHash}',
        '${evaluation.reportHash}', ${evaluation.evaluatedCases},
        ${evaluation.passedCases}, '${evaluation.evaluatorReleaseSha}',
        '${evaluatedAt}'::timestamptz, ${sqlLiteral(evaluation.suiteName)},
        '${evaluation.suiteManifestHash}',
        ${sqlLiteral(evaluation.canonical)}::jsonb,
        ${sqlLiteral(evaluation.canonical)}
      );
      INSERT INTO prompt_candidacy_decisions (
        id, tenant_id, prompt_version_id, prompt_version_hash, decision,
        evaluation_result_id, decided_by
      ) VALUES (
        '${decisionId}', '${tenantId}', '${promptId}', '${promptHash}',
        'CANDIDATE', '${evaluationId}', '${operatorId}'
      );
      INSERT INTO prompt_deployments (
        id, tenant_id, action, prompt_version_id, deployed_by
      ) VALUES (
        '${deploymentId}', '${tenantId}', 'GENERATE', '${promptId}',
        '${operatorId}'
      );
      COMMIT;
    `);

    const undeployedPromptId = randomUUID();
    const undeployedPrompt = {
      key: `platform.undeployed.${tenantId}`,
      commandKind: "generate" as const,
      body: "This Draft must stay hidden from Platform publication.",
      variables: [] as const,
    };
    await sql(`
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body, variables,
        version, status
      ) VALUES (
        '${undeployedPromptId}', '${tenantId}', '${undeployedPrompt.key}',
        'GENERATE', '${derivePromptVersionHash(undeployedPrompt)}',
        '${undeployedPrompt.body}', ARRAY[]::text[], 2, 'DRAFT'
      );
    `);

    const activeLocationIds = JSON.parse(
      await scalar(`
        SELECT COALESCE(json_agg(location.id::text ORDER BY location.id), '[]'::json)::text
        FROM locations AS location
        JOIN tenants AS tenant ON tenant.id = location.tenant_id
        WHERE location.status = 'ACTIVE' AND tenant.status = 'ACTIVE';
      `),
    ) as string[];

    const store = createPostgresConsoleControlPlaneStore({
      databaseUrl: serviceUrl(),
      consoleDatabaseAuthoritySecret: authoritySecret,
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    });
    try {
      const operations = store.forOperator(operatorId);
      const deployedPromptId = await scalar(`
        SELECT prompt_version_id::text
        FROM prompt_deployments
        WHERE tenant_id = '${tenantId}'::uuid AND action = 'GENERATE';
      `);
      await expect(
        scalarAsOperator(
          operatorId,
          `SELECT count(*) FROM prompt_versions WHERE id = '${deployedPromptId}'::uuid;`,
        ),
      ).resolves.toBe("1");
      await expect(
        scalarAsOperator(
          operatorId,
          `SELECT count(*) FROM prompt_versions WHERE id = '${undeployedPromptId}'::uuid;`,
        ),
      ).resolves.toBe("0");
      await expect(
        scalarAsOperator(
          providerOnlyOperatorId,
          `SELECT count(*) FROM prompt_versions WHERE id = '${deployedPromptId}'::uuid;`,
        ),
      ).resolves.toBe("0");
      const initial = await operations.readPlatformConfigurationState();
      const prospectiveRateStart = "2099-09-01T00:00:00.000Z";
      const settingsChange: Extract<
        PlatformConfigurationChange,
        { readonly operation: "save-platform-settings" }
      > = {
          operation: "save-platform-settings",
          defaultPolicyTemplate: JSON.stringify({
            locale: "en-GB",
            toneGuidelines: "Plain, factual, first person.",
            entryMode: "invite",
            requireDisclosure: true,
            requireVerifiedExperience: true,
            maxReviewFormatsPerRequest: 1,
            minimumFactSelections: 1,
            maximumCustomerAssertionChars: 500,
            bannedTerms: [],
            enabledReviewFormatVersionIds: [],
            enabledCommands: [],
            monthlyBudgetMicros: 0,
            alertThresholdPct: 80,
          }),
          globalRateLimits: {
            perReviewSessionPerHour: 20,
            perTenantPerMinute: 60,
            maxConcurrentGenerations: 4,
          },
          logRetentionDays: 45,
          featureFlags: [],
        };
      const routingChange: Extract<
        PlatformConfigurationChange,
        { readonly operation: "set-provider-routing" }
      > = {
          operation: "set-provider-routing",
          providerKey: `platform-provider-${providerId}`,
          modelKey: "model-v1",
          routingPriority: 1,
          fallbackPriority: null,
        };
      const rateChange: Extract<
        PlatformConfigurationChange,
        { readonly operation: "publish-price-rate" }
      > = {
          operation: "publish-price-rate",
          providerKey: `platform-provider-${providerId}`,
          modelKey: "model-v1",
          inputMicrosPerMillion: 3000,
          outputMicrosPerMillion: 5000,
          currency: "EUR",
          validFrom: prospectiveRateStart,
        };
      const changes: PlatformConfigurationChange[] = [
        settingsChange,
        routingChange,
        rateChange,
      ];
      await expect(
        operations.savePlatformConfigurationDraft({
          expectedRevision: initial.revision,
          expectedDraft: null,
          changes,
          actorId: operatorId,
        }),
      ).resolves.toEqual({ status: "saved" });

      // A second browser tab saw the same published revision but no Draft.
      await expect(
        operations.savePlatformConfigurationDraft({
          expectedRevision: initial.revision,
          expectedDraft: null,
          changes: [{ ...settingsChange, logRetentionDays: 90 }],
          actorId: operatorId,
        }),
      ).resolves.toEqual({ status: "conflict" });

      const pending = await operations.readPlatformConfigurationState();
      if (pending.draft === null) {
        throw new Error("Expected a Platform Configuration Draft");
      }
      const publication = {
        expectedRevision: pending.revision,
        expectedDraft: {
          id: pending.draft.id,
          revision: pending.draft.revision,
        },
        actorId: operatorId,
      } as const;
      const first = await operations.publishPlatformConfiguration(publication);
      if (first.status !== "published") {
        throw new Error(
          `Expected Platform publication to succeed: ${JSON.stringify(first)}`,
        );
      }
      expect(first).toMatchObject({ status: "published" });
      expect(new Set(first.snapshotIds).size).toBe(activeLocationIds.length);
      const materializedLocationIds = JSON.parse(
        await scalar(`
          SELECT COALESCE(json_agg(location_id::text ORDER BY location_id), '[]'::json)::text
          FROM effective_configuration_snapshots
          WHERE id = ANY(ARRAY[${first.snapshotIds
            .map((id) => `'${id}'::uuid`)
            .join(",")}]);
        `),
      ) as string[];
      expect(materializedLocationIds).toEqual(activeLocationIds);
      await expect(
        scalar(`
          SELECT count(*)
          FROM effective_configuration_snapshots
          WHERE location_id = '${inactiveLocationId}'::uuid;
        `),
      ).resolves.toBe("0");
      await expect(
        operations.publishPlatformConfiguration(publication),
      ).resolves.toEqual(first);
      await expect(
        operations.readPlatformConfigurationState(),
      ).resolves.toEqual({
        revision: String(BigInt(initial.revision) + 1n),
        draft: null,
      });
      await expect(
        scalar(`
          SELECT count(*)
          FROM effective_configuration_snapshots
          WHERE id = ANY(ARRAY[${first.snapshotIds
            .map((id) => `'${id}'::uuid`)
            .join(",")}]);
        `),
      ).resolves.toBe(String(activeLocationIds.length));
      await expect(
        scalar(`
          SELECT actor_id::text || ':' || draft_id::text || ':' || draft_revision::text
          FROM platform_configuration_publications
          WHERE draft_id = '${pending.draft.id}'::uuid;
        `),
      ).resolves.toBe(
        `${operatorId}:${pending.draft.id}:${pending.draft.revision}`,
      );
      await expect(
        scalar(`SELECT count(*) FROM provider_models WHERE routing_priority = 1;`),
      ).resolves.toBe("1");
      await expect(
        scalar(`
          SELECT count(*)
          FROM price_rates
          WHERE provider_model_id = '${providerModelId}'::uuid;
        `),
      ).resolves.toBe("2");

      const current = await operations.readPlatformConfigurationState();
      await expect(
        store
          .forOperator(settingsOnlyOperatorId)
          .savePlatformConfigurationDraft({
            expectedRevision: current.revision,
            expectedDraft: null,
            changes: [routingChange],
            actorId: settingsOnlyOperatorId,
          }),
      ).rejects.toBeInstanceOf(ConsoleScopeDeniedError);
      await expect(
        store
          .forOperator(providerOnlyOperatorId)
          .savePlatformConfigurationDraft({
            expectedRevision: current.revision,
            expectedDraft: null,
            changes: [routingChange],
            actorId: providerOnlyOperatorId,
          }),
      ).rejects.toBeInstanceOf(ConsoleScopeDeniedError);

      await operations.savePlatformConfigurationDraft({
        expectedRevision: current.revision,
        expectedDraft: null,
        changes: [
          { ...settingsChange, logRetentionDays: 90 },
          {
            ...rateChange,
            validFrom: "2026-08-23T00:00:00.000Z",
          },
        ],
        actorId: operatorId,
      });
      const retroactive = await operations.readPlatformConfigurationState();
      if (retroactive.draft === null) {
        throw new Error("Expected the retroactive Draft");
      }
      await expect(
        store
          .forOperator(providerOnlyOperatorId)
          .publishPlatformConfiguration({
            expectedRevision: retroactive.revision,
            expectedDraft: {
              id: retroactive.draft.id,
              revision: retroactive.draft.revision,
            },
            actorId: providerOnlyOperatorId,
          }),
      ).resolves.toEqual({ status: "no-draft" });
      const beforeRates = await scalar(
        `SELECT count(*) FROM price_rates WHERE provider_model_id = '${providerModelId}'::uuid;`,
      );
      const beforePublications = await scalar(
        "SELECT count(*) FROM platform_configuration_publications;",
      );
      const beforeSnapshots = await scalar(
        "SELECT count(*) FROM effective_configuration_snapshots;",
      );
      await expect(
        operations.publishPlatformConfiguration({
          expectedRevision: retroactive.revision,
          expectedDraft: {
            id: retroactive.draft.id,
            revision: retroactive.draft.revision,
          },
          actorId: operatorId,
        }),
      ).resolves.toEqual({
        status: "incomplete",
        missing: [
          "a prospective Price Rate start at or after the publication transaction",
        ],
      });
      await expect(
        operations.readPlatformConfigurationState(),
      ).resolves.toEqual(retroactive);
      await expect(
        scalar(`SELECT log_retention_days FROM platform_settings WHERE id = 'platform';`),
      ).resolves.toBe("45");
      await expect(
        scalar(`SELECT count(*) FROM price_rates WHERE provider_model_id = '${providerModelId}'::uuid;`),
      ).resolves.toBe(beforeRates);
      await expect(
        scalar("SELECT count(*) FROM platform_configuration_publications;"),
      ).resolves.toBe(beforePublications);
      await expect(
        scalar("SELECT count(*) FROM effective_configuration_snapshots;"),
      ).resolves.toBe(beforeSnapshots);

      await expect(
        operations.cancelPlatformConfigurationDraft({
          expectedRevision: retroactive.revision,
          expectedDraft: {
            id: retroactive.draft.id,
            revision: retroactive.draft.revision,
          },
        }),
      ).resolves.toEqual({ status: "cancelled" });
      const retiredPromptId = promptIds[0];
      if (retiredPromptId === undefined) {
        throw new Error("Expected an active Tenant Prompt");
      }
      await sql(`
        INSERT INTO prompt_candidacy_decisions (
          tenant_id, prompt_version_id, prompt_version_hash, decision,
          decided_by, reason
        )
        SELECT
          prompt.tenant_id, prompt.id, prompt.content_hash, 'RETIRED',
          '${operatorId}', 'Retired before the next Platform publication.'
        FROM prompt_versions AS prompt
        WHERE prompt.id = '${retiredPromptId}'::uuid;
      `);
      const beforeRetiredPublication =
        await operations.readPlatformConfigurationState();
      await operations.savePlatformConfigurationDraft({
        expectedRevision: beforeRetiredPublication.revision,
        expectedDraft: null,
        changes: [{ ...settingsChange, logRetentionDays: 60 }],
        actorId: operatorId,
      });
      const retiredDraft = await operations.readPlatformConfigurationState();
      if (retiredDraft.draft === null) {
        throw new Error("Expected a Platform Draft after Prompt retirement");
      }
      const retiredSnapshotsBefore = await scalar(
        "SELECT count(*) FROM effective_configuration_snapshots;",
      );
      await expect(
        operations.publishPlatformConfiguration({
          expectedRevision: retiredDraft.revision,
          expectedDraft: {
            id: retiredDraft.draft.id,
            revision: retiredDraft.draft.revision,
          },
          actorId: operatorId,
        }),
      ).resolves.toEqual({
        status: "incomplete",
        missing: ["a currently eligible deployed Prompt Version for generate"],
      });
      await expect(operations.readPlatformConfigurationState()).resolves.toEqual(
        retiredDraft,
      );
      await expect(
        scalar("SELECT count(*) FROM effective_configuration_snapshots;"),
      ).resolves.toBe(retiredSnapshotsBefore);
    } finally {
      await store.disconnect();
    }
  }, 30_000);
});
