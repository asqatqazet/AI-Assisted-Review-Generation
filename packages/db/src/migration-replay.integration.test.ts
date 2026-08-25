import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { derivePromptVersionHash } from "@review/domain/experiment";

import { qualifyLocalStaticPromptFixture } from "../../../infra/local/static-prompt-release-fixture.js";

import {
  createPostgresEntryAdmissionStore,
  createPostgresReviewerGenerationAdmissionStore,
} from "./admission/index.js";
import { createPostgresConsoleControlPlaneStore } from "./control-plane/index.js";
import {
  createPostgresGenerationTerminalStore,
  createPostgresReviewerDispositionStore,
} from "./execution-plane/index.js";
import { createPostgresReviewSessionProgressStore } from "./review-session/index.js";
import { databaseUrlForTestRole } from "./test-support/database-role-url.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl ? describe : describe.skip;
const workspaceRoot = path.resolve(__dirname, "../../..");
const prisma = path.join(
  workspaceRoot,
  "packages/db/node_modules/.bin/prisma",
);
const schema = path.join(workspaceRoot, "packages/db/prisma/schema.prisma");
const studentSeed = path.join(workspaceRoot, "infra/aws/seed-student.sql");
const migrations = path.join(workspaceRoot, "packages/db/prisma/migrations");
const completePlatformPolicy = JSON.stringify({
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
});

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

describeDatabase("PostgreSQL migration replay", () => {
  it("applies every committed migration to an empty database", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }

    const databaseName = `migration_replay_${randomUUID().replaceAll("-", "")}`;
    const scratchUrl = new URL(databaseUrl);
    scratchUrl.pathname = `/${databaseName}`;
    scratchUrl.searchParams.delete("schema");

    await runSql(databaseUrl, `CREATE DATABASE "${databaseName}"`);
    try {
      await execFileAsync(
        prisma,
        ["migrate", "deploy", "--schema", schema],
        {
          cwd: workspaceRoot,
          env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      for (const replay of [1, 2]) {
        await execFileAsync(
          prisma,
          ["db", "execute", "--file", studentSeed, "--schema", schema],
          {
            cwd: workspaceRoot,
            env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
            maxBuffer: 4 * 1024 * 1024,
          },
        ).catch((error: unknown) => {
          throw new Error(`student seed replay ${replay} failed`, {
            cause: error,
          });
        });
      }

      await expect(
        runSql(
          scratchUrl.toString(),
          `
            SELECT
              to_regclass('public.prompt_deployments') IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'entry_challenges'
                  AND column_name = 'verification_failure_count'
              )
              AND (
                SELECT count(*)
                FROM provider_models
                WHERE routing_priority = 1
              ) = 1
              AND (
                SELECT count(*)
                FROM prompt_evaluation_results
                WHERE prompt_version_id = '00000000-0000-4000-8000-000000000136'::uuid
              ) = 0
              AND (
                SELECT count(*)
                FROM prompt_deployments
                WHERE prompt_version_id = '00000000-0000-4000-8000-000000000136'::uuid
              ) = 0
              AND (SELECT count(*) FROM effective_configuration_snapshots) = 0;
          `,
        ),
      ).resolves.toBe("t");
      await expect(
        runSql(
          scratchUrl.toString(),
          `UPDATE prompt_versions
           SET body = 'mutated'
           WHERE id = '00000000-0000-4000-8000-000000000136'::uuid;`,
        ),
      ).rejects.toThrow(/PUBLISHED_CONFIGURATION_IS_APPEND_ONLY/iu);

      const platformOperatorId = randomUUID();
      const platformRole = `migration_replay_platform_${platformOperatorId}`;
      const consoleAuthoritySecret = "ef".repeat(32);
      await runSql(
        scratchUrl.toString(),
        `
          INSERT INTO console_database_authority_keys (singleton, secret)
          VALUES (true, decode('${consoleAuthoritySecret}', 'hex'))
          ON CONFLICT (singleton) DO UPDATE SET secret = EXCLUDED.secret;
          INSERT INTO operator_role_definitions (key, capabilities, status)
          VALUES (
            '${platformRole}',
            ARRAY['console:read', 'platform:admin', 'tenant:configure', 'ai:operate'],
            'ACTIVE'
          );
          INSERT INTO operators (id, email, external_issuer, external_subject)
          VALUES (
            '${platformOperatorId}',
            'migration-replay-${platformOperatorId}@example.test',
            'https://issuer.test',
            'migration-replay-${platformOperatorId}'
          );
          INSERT INTO platform_access_grants (operator_id, role_key)
          VALUES ('${platformOperatorId}', '${platformRole}');
        `,
      );

      const consoleUrl = databaseUrlForTestRole({
        databaseUrl: scratchUrl.toString(),
        role: "console_control_svc",
      });
      await expect(
        qualifyLocalStaticPromptFixture({
          migrationDatabaseUrl: scratchUrl.toString(),
          consoleDatabaseUrl: consoleUrl,
          consoleDatabaseAuthoritySecret: consoleAuthoritySecret,
          operatorId: platformOperatorId,
        }),
      ).resolves.toEqual({
        evaluationStatus: "inserted",
        publicationStatus: "published",
      });
      await expect(
        qualifyLocalStaticPromptFixture({
          migrationDatabaseUrl: scratchUrl.toString(),
          consoleDatabaseUrl: consoleUrl,
          consoleDatabaseAuthoritySecret: consoleAuthoritySecret,
          operatorId: platformOperatorId,
        }),
      ).resolves.toEqual({
        evaluationStatus: "existing",
        publicationStatus: "existing",
      });
      await expect(
        runSql(
          scratchUrl.toString(),
          `DELETE FROM effective_configuration_snapshots
           WHERE id = (
             SELECT id
             FROM effective_configuration_snapshots
             WHERE tenant_id = '00000000-0000-4000-8000-000000000101'::uuid
             ORDER BY created_at DESC, id DESC
             LIMIT 1
           );`,
        ),
      ).rejects.toThrow(/PUBLISHED_CONFIGURATION_IS_APPEND_ONLY/iu);
      const consoleStore = createPostgresConsoleControlPlaneStore({
        databaseUrl: consoleUrl.toString(),
        consoleDatabaseAuthoritySecret: consoleAuthoritySecret,
      });
      let republishedSnapshotId: string;
      try {
        const operations = consoleStore.forOperator(platformOperatorId);
        const initial = await operations.readPlatformConfigurationState();
        await expect(
          operations.savePlatformConfigurationDraft({
            expectedRevision: initial.revision,
            expectedDraft: null,
            changes: [
              {
                operation: "save-platform-settings",
                defaultPolicyTemplate: completePlatformPolicy,
                globalRateLimits: {
                  perReviewSessionPerHour: 10,
                  perTenantPerMinute: 30,
                  maxConcurrentGenerations: 1,
                },
                logRetentionDays: 14,
                featureFlags: [],
              },
            ],
            actorId: platformOperatorId,
          }),
        ).resolves.toEqual({ status: "saved" });
        const pending = await operations.readPlatformConfigurationState();
        if (pending.draft === null) {
          throw new Error("Expected the seed Platform Draft");
        }
        const publication = await operations.publishPlatformConfiguration({
          expectedRevision: pending.revision,
          expectedDraft: {
            id: pending.draft.id,
            revision: pending.draft.revision,
          },
          actorId: platformOperatorId,
        });
        if (publication.status !== "published") {
          throw new Error(
            `Expected the seeded Platform publication to succeed: ${JSON.stringify(publication)}`,
          );
        }
        expect(publication.snapshotIds).toHaveLength(1);
        republishedSnapshotId = publication.snapshotIds[0]!;
      } finally {
        await consoleStore.disconnect();
      }

      const legacyUrl = databaseUrlForTestRole({
        databaseUrl: scratchUrl.toString(),
        role: "context_svc",
      });
      const legacyEntryStore = createPostgresEntryAdmissionStore({
        databaseUrl: legacyUrl,
      });
      try {
        const legacyRouteHandleHash = `sha256:legacy-entry-${randomUUID()}`;
        await expect(
          legacyEntryStore.prepare({
            tenantSlug: "speicher-neun",
            locationSlug: "hafencity",
            routeHandleHash: legacyRouteHandleHash,
            browserCapabilityHash: `sha256:legacy-browser-${randomUUID()}`,
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          }),
        ).resolves.toEqual({ status: "prepared" });
      } finally {
        await legacyEntryStore.disconnect();
      }

      const runtimeUrl = databaseUrlForTestRole({
        databaseUrl: scratchUrl.toString(),
        role: "context_runtime_svc",
      });
      const entryStore = createPostgresEntryAdmissionStore({
        databaseUrl: runtimeUrl,
      });
      const generationAdmission =
        createPostgresReviewerGenerationAdmissionStore({
          databaseUrl: runtimeUrl,
          providerMode: "fake-only",
        });
      const entryRouteHandleHash = `sha256:entry-${randomUUID()}`;
      const reviewRouteHandleHash = `sha256:review-${randomUUID()}`;
      const browserCapabilityHash = `sha256:browser-${randomUUID()}`;
      try {
        await expect(
          entryStore.prepare({
            tenantSlug: "speicher-neun",
            locationSlug: "hafencity",
            routeHandleHash: entryRouteHandleHash,
            browserCapabilityHash,
            expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          }),
        ).resolves.toEqual({ status: "prepared" });
        await expect(
          entryStore.read({
            routeHandleHash: entryRouteHandleHash,
            browserCapabilityHash,
          }),
        ).resolves.toMatchObject({
          status: "ready",
          context: {
            tenantDisplayName: "Speicher Neun",
            locationDisplayName: "Speicher Neun · HafenCity",
            reviewFormats: expect.arrayContaining([
              expect.objectContaining({
                id: "00000000-0000-4000-8000-000000000122",
              }),
            ]),
          },
        });
        await expect(
          entryStore.advance({
            routeHandleHash: entryRouteHandleHash,
            browserCapabilityHash,
            reviewSessionRouteHandleHash: reviewRouteHandleHash,
            rating: 5,
            action: "GENERATE",
            reviewSessionExpiresAt: new Date(
              Date.now() + 60 * 60_000,
            ).toISOString(),
          }),
        ).resolves.toMatchObject({ status: "admitted" });
        await expect(
          generationAdmission.prepare({
            routeHandleHash: reviewRouteHandleHash,
            browserCapabilityHash,
            idempotencyKey: "clean-seed-generate",
            command: {
              kind: "generate",
              factOptionIds: ["00000000-0000-4000-8000-000000000130"],
              reviewFormatVersionId:
                "00000000-0000-4000-8000-000000000122",
            },
          }),
        ).resolves.toMatchObject({
          status: "prepared",
          workload: {
            bindings: {
              action: "generate",
              snapshotId: republishedSnapshotId,
              providerModelId: "00000000-0000-4000-8000-000000000202",
              priceRateId: "00000000-0000-4000-8000-000000000203",
            },
          },
        });
      } finally {
        await entryStore.disconnect();
        await generationAdmission.disconnect();
      }
    } finally {
      await runSql(
        databaseUrl,
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
    }
  });

  it("migrates legacy empty Draft annotations and keeps exact empty envelopes readable during expand", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }

    const databaseName = `migration_legacy_${randomUUID().replaceAll("-", "")}`;
    const scratchUrl = new URL(databaseUrl);
    scratchUrl.pathname = `/${databaseName}`;
    scratchUrl.searchParams.delete("schema");
    const stagedRoot = await mkdtemp(path.join(os.tmpdir(), "review-migrations-"));
    const stagedSchema = path.join(stagedRoot, "schema.prisma");
    const stagedMigrations = path.join(stagedRoot, "migrations");
    const checkpointMigration = "20260824000030_provider_result_checkpoint";
    const migrationNames = (await readdir(migrations)).filter(
      (name) => name !== "migration_lock.toml",
    );
    const contractMigrations = migrationNames.filter(
      (name) => name >= checkpointMigration,
    );

    await cp(schema, stagedSchema);
    await cp(migrations, stagedMigrations, { recursive: true });
    for (const migrationName of contractMigrations) {
      await rm(path.join(stagedMigrations, migrationName), {
        recursive: true,
        force: true,
      });
    }

    await runSql(databaseUrl, `CREATE DATABASE "${databaseName}"`);
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const reviewSessionId = randomUUID();
    const snapshotId = randomUUID();
    const reservationId = randomUUID();
    const batchId = randomUUID();
    const generationId = randomUUID();
    const leaseId = randomUUID();
    const promptVersionId = randomUUID();
    const promptKey = `legacy-${promptVersionId}`;
    const promptBody = "Generate JSON.";
    const promptContentHash = derivePromptVersionHash({
      key: promptKey,
      commandKind: "generate",
      body: promptBody,
      variables: [],
    });
    const reviewFormatVersionId = randomUUID();
    const draftId = randomUUID();
    const routeHandleHash = `sha256:legacy-route-${randomUUID()}`;
    const browserCapabilityHash = `sha256:legacy-browser-${randomUUID()}`;
    const permitJti = `legacy-${randomUUID()}`;
    const originalText = "The team was attentive.";
    const editedText = "The team was exceptionally attentive.";

    try {
      await execFileAsync(prisma, ["migrate", "deploy", "--schema", stagedSchema], {
        cwd: workspaceRoot,
        env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
        maxBuffer: 4 * 1024 * 1024,
      });
      await runSql(
        scratchUrl.toString(),
        `
          INSERT INTO tenants (id, slug, name, locale)
          VALUES ('${tenantId}', 'legacy-${tenantId}', 'Legacy Tenant', 'en-GB');
          INSERT INTO locations (id, tenant_id, slug, name)
          VALUES ('${locationId}', '${tenantId}', 'legacy-${locationId}', 'Legacy Location');
          INSERT INTO review_sessions (
            id, tenant_id, location_id, status, rating, selected_action,
            journey_phase, expires_at
          ) VALUES (
            '${reviewSessionId}', '${tenantId}', '${locationId}', 'OPEN', 5,
            'GENERATE', 'RESULTS', clock_timestamp() + interval '1 hour'
          );
          INSERT INTO review_session_browser_bindings (
            tenant_id, location_id, review_session_id, route_handle_hash,
            browser_capability_hash, expires_at
          ) VALUES (
            '${tenantId}', '${locationId}', '${reviewSessionId}',
            '${routeHandleHash}', '${browserCapabilityHash}',
            clock_timestamp() + interval '1 hour'
          );
          INSERT INTO effective_configuration_snapshots (
            id, tenant_id, location_id, schema_version, content_hash, payload, provenance
          ) VALUES (
            '${snapshotId}', '${tenantId}', '${locationId}', 1,
            'legacy-snapshot-${snapshotId}', '{}'::jsonb, '{}'::jsonb
          );
          INSERT INTO review_format_versions (
            id, format_key, version, locale, target_platform, constraints,
            localized_text, supported_actions, content_hash
          ) VALUES (
            '${reviewFormatVersionId}', 'legacy-${reviewFormatVersionId}', 1,
            'en-GB', 'generic', '{"minChars":1,"maxChars":500}'::jsonb,
            '{"displayName":{"en-GB":"Legacy"},"description":{"en-GB":"Legacy"},"sample":{"en-GB":"Sample"}}'::jsonb,
            ARRAY['GENERATE']::generation_action[],
            'legacy-format-${reviewFormatVersionId}'
          );
          INSERT INTO prompt_versions (
            id, tenant_id, prompt_key, action, content_hash, body
          ) VALUES (
            '${promptVersionId}', '${tenantId}', '${promptKey}',
            'GENERATE', '${promptContentHash}', '${promptBody}'
          );
          INSERT INTO budget_reservations (
            id, tenant_id, location_id, review_session_id, snapshot_id,
            permit_jti, request_hash, action, reserved_micros, expires_at
          ) VALUES (
            '${reservationId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
            '${snapshotId}', 'reservation-${reservationId}',
            'legacy-request-${reservationId}', 'GENERATE', 0,
            clock_timestamp() + interval '1 hour'
          );
          INSERT INTO generation_batches (
            id, tenant_id, location_id, review_session_id, snapshot_id,
            budget_reservation_id, idempotency_key, request_hash, action,
            normalized_input
          ) VALUES (
            '${batchId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
            '${snapshotId}', '${reservationId}', 'legacy-${batchId}',
            'legacy-request-${batchId}', 'GENERATE', '{}'::jsonb
          );
          INSERT INTO execution_leases (
            id, tenant_id, location_id, review_session_id, generation_batch_id,
            generation_id, permit_jti, permit_expires_at, lease_expires_at,
            activation_expires_at, state, running_at, terminal_at
          ) VALUES (
            '${leaseId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
            '${batchId}', '${generationId}', '${permitJti}',
            clock_timestamp() + interval '2 hours',
            clock_timestamp() + interval '1 hour',
            clock_timestamp() + interval '30 seconds', 'TERMINAL',
            clock_timestamp(), clock_timestamp()
          );
          INSERT INTO generations (
            id, tenant_id, location_id, review_session_id, generation_batch_id,
            execution_lease_id, snapshot_id, prompt_version_id,
            review_format_version_id, action, status, provider_output,
            grounded_output, grounding_verdict, policy_result
          ) VALUES (
            '${generationId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
            '${batchId}', '${leaseId}', '${snapshotId}', '${promptVersionId}',
            '${reviewFormatVersionId}', 'GENERATE', 'SUCCEEDED', NULL,
            '${originalText}', 'PASSED', '{"violations":[]}'::jsonb
          );
          INSERT INTO drafts (
            id, tenant_id, location_id, review_session_id,
            originating_generation_id, status
          ) VALUES (
            '${draftId}', '${tenantId}', '${locationId}', '${reviewSessionId}',
            '${generationId}', 'ACTIVE'
          );
          INSERT INTO draft_revisions (
            tenant_id, location_id, review_session_id, draft_id,
            source_generation_id, revision, author, text, content_hash,
            annotations
          ) VALUES (
            '${tenantId}', '${locationId}', '${reviewSessionId}', '${draftId}',
            '${generationId}', 1, 'GENERATION', '${originalText}',
            '${createHash("sha256").update(originalText).digest("hex")}', '{}'::jsonb
          );
        `,
      );

      for (const migrationName of contractMigrations) {
        await cp(
          path.join(migrations, migrationName),
          path.join(stagedMigrations, migrationName),
          { recursive: true },
        );
      }
      await execFileAsync(prisma, ["migrate", "deploy", "--schema", stagedSchema], {
        cwd: workspaceRoot,
        env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
        maxBuffer: 4 * 1024 * 1024,
      });

      await expect(
        runSql(
          scratchUrl.toString(),
          `SELECT (annotations = '{"systemAnnotations":[]}'::jsonb)::text FROM draft_revisions WHERE draft_id = '${draftId}';`,
        ),
      ).resolves.toBe("true");

      // Simulate an old live writer committing its exact legacy envelope after
      // the expand migration but before the old version is drained.
      await runSql(
        scratchUrl.toString(),
        `UPDATE draft_revisions SET annotations = '{}'::jsonb WHERE draft_id = '${draftId}';`,
      );
      const runtimeUrl = databaseUrlForTestRole({
        databaseUrl: scratchUrl.toString(),
        role: "context_runtime_svc",
      });
      const generationUrl = databaseUrlForTestRole({
        databaseUrl: scratchUrl.toString(),
        role: "generation_svc",
      });
      const progressStore = createPostgresReviewSessionProgressStore({
        databaseUrl: runtimeUrl,
      });
      const terminalStore = createPostgresGenerationTerminalStore({
        databaseUrl: generationUrl,
      });
      const dispositionStore = createPostgresReviewerDispositionStore({
        databaseUrl: generationUrl,
      });
      try {
        await expect(
          progressStore.read({ routeHandleHash, browserCapabilityHash }),
        ).resolves.toMatchObject({
          status: "ready",
          drafts: [{ id: draftId, systemAnnotations: [] }],
        });
        await expect(
          terminalStore.read({
            tenantId,
            locationId,
            reviewSessionId,
            generationBatchId: batchId,
            generationId,
            permitJti,
          }),
        ).resolves.toMatchObject({
          draft: { id: draftId, systemAnnotations: [] },
        });
        await expect(
          dispositionStore.readOriginal({
            tenantId,
            locationId,
            reviewSessionId,
            draftId,
            generationId,
          }),
        ).resolves.toEqual({ text: originalText, systemAnnotations: [] });
        await expect(
          dispositionStore.saveRevision({
            tenantId,
            locationId,
            reviewSessionId,
            draftId,
            generationId,
            expectedRevision: 1,
            textHash: `sha256:${createHash("sha256").update(editedText).digest("hex")}`,
            idempotencyKey: "legacy-edit-a",
            permitJti: "legacy-edit-permit-a",
            text: editedText,
          }),
        ).resolves.toEqual({ status: "recorded", revision: 2 });
        await expect(
          dispositionStore.record({
            tenantId,
            locationId,
            reviewSessionId,
            draftId,
            generationId,
            finalTextHash: `sha256:${createHash("sha256").update(editedText).digest("hex")}`,
            idempotencyKey: "legacy-disposition-a",
            permitJti: "legacy-disposition-permit-a",
            finalText: editedText,
            normalizedEditDistance: 0.25,
          }),
        ).resolves.toMatchObject({ kind: "edited", revision: 2 });
        await expect(
          runSql(
            scratchUrl.toString(),
            `SELECT (annotations = '{"systemAnnotations":[]}'::jsonb)::text FROM draft_revisions WHERE draft_id = '${draftId}' AND revision = 2;`,
          ),
        ).resolves.toBe("true");

        await runSql(
          scratchUrl.toString(),
          `UPDATE draft_revisions SET annotations = '{"unexpected":[]}'::jsonb WHERE draft_id = '${draftId}';`,
        );
        await expect(
          progressStore.read({ routeHandleHash, browserCapabilityHash }),
        ).rejects.toThrow("Stored Draft annotations are invalid");
        await expect(
          terminalStore.read({
            tenantId,
            locationId,
            reviewSessionId,
            generationBatchId: batchId,
            generationId,
            permitJti,
          }),
        ).rejects.toThrow("Draft system annotations are invalid");
        await expect(
          dispositionStore.readOriginal({
            tenantId,
            locationId,
            reviewSessionId,
            draftId,
            generationId,
          }),
        ).rejects.toThrow("Draft system annotations are invalid");
      } finally {
        await dispositionStore.disconnect();
        await terminalStore.disconnect();
        await progressStore.disconnect();
      }
    } finally {
      await rm(stagedRoot, { recursive: true, force: true });
      await runSql(
        databaseUrl,
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      );
    }
  });
});
