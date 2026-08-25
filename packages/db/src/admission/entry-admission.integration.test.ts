import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { deriveConfigSnapshotId } from "@review/domain/configuration";

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

function contextServiceDatabaseUrl(): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const url = new URL(databaseUrl);
  url.username = "context_runtime_svc";
  url.password = "";
  return url.toString();
}

async function publishAdmissionSnapshot(input: {
  readonly tenantId: string;
  readonly locationId: string;
  readonly tenantName: string;
  readonly locationName: string;
  readonly locale: "en-GB" | "de-DE";
  readonly entryMode: "invite" | "open-qr" | "both";
  readonly requireVerifiedExperience: boolean;
  readonly reviewFormatVersionId?: string | undefined;
  readonly factOption?:
    | {
        readonly id: string;
        readonly categoryId: string;
        readonly label: string;
        readonly categoryLabel: string;
        readonly proposition: string;
      }
    | undefined;
}): Promise<string> {
  const snapshotId = randomUUID();
  const releaseId = randomUUID();
  const reviewFormats =
    input.reviewFormatVersionId === undefined
      ? []
      : [
          {
            id: input.reviewFormatVersionId,
            key: "concise",
            version: "1.0.0",
            displayName: input.locale === "de-DE" ? "Kurz" : "Concise review",
            targetPlatform: "google",
            locale: input.locale,
            description: {
              [input.locale]:
                input.locale === "de-DE" ? "Ein kurzer Absatz." : "One short paragraph.",
            },
            sample: {
              [input.locale]:
                input.locale === "de-DE" ? "Ein kurzer Text." : "A concise review.",
            },
            constraints: {
              minChars: 1,
              maxChars: 350,
              paragraphs: 1,
              emojiPolicy: "none",
              secondPerson: false,
            },
            supportedCommands: ["generate"],
          },
        ];
  const factOptions =
    input.factOption === undefined
      ? []
      : [
          {
            id: input.factOption.id,
            version: `${input.factOption.id}@1`,
            label: input.factOption.label,
            categoryLabel: input.factOption.categoryLabel,
            owner: { scope: "tenant", tenantId: input.tenantId },
            categoryId: input.factOption.categoryId,
            proposition: input.factOption.proposition,
            polarity: "positive",
            locale: input.locale,
            active: true,
            sortOrder: 1,
          },
        ];
  const snapshot = {
    snapshotId,
    schemaVersion: 2,
    tenantId: input.tenantId,
    locationId: input.locationId,
    tenantName: input.tenantName,
    locationName: input.locationName,
    settings: {
      locale: input.locale,
      toneGuidelines: "Warm and specific.",
      entryMode: input.entryMode,
      requireDisclosure: false,
      requireVerifiedExperience: input.requireVerifiedExperience,
      maxReviewFormatsPerRequest: 1,
      minimumFactSelections: 1,
      maximumCustomerAssertionChars: 500,
      bannedTerms: [],
      enabledReviewFormatVersionIds:
        input.reviewFormatVersionId === undefined
          ? []
          : [input.reviewFormatVersionId],
      enabledCommands:
        input.reviewFormatVersionId === undefined ? [] : ["generate"],
      monthlyBudgetMicros: 0,
      alertThresholdPct: 80,
    },
    factOptions,
    reviewFormats,
  };
  const snapshotContentHash = deriveConfigSnapshotId(snapshot as never);
  await runSql(`
    INSERT INTO effective_configuration_snapshots (
      id, tenant_id, location_id, schema_version, content_hash, payload, provenance
    ) VALUES (
      '${snapshotId}', '${input.tenantId}', '${input.locationId}', 2,
      '${snapshotContentHash}', '${JSON.stringify(snapshot)}'::jsonb,
      '{}'::jsonb
    );
    SELECT public.register_configuration_release(
      '${releaseId}'::uuid,
      ARRAY['${snapshotId}'::uuid],
      NULL::uuid,
      true
    );
  `);
  return snapshotId;
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
      VALUES
        ('open-qr', '{"verification":false}'::jsonb),
        ('invite', '{"verification":true}'::jsonb)
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
    await publishAdmissionSnapshot({
      tenantId,
      locationId,
      tenantName: "Apex Dental",
      locationName: "Central Clinic",
      locale: "en-GB",
      entryMode: "open-qr",
      requireVerifiedExperience: false,
      reviewFormatVersionId,
      factOption: {
        id: factOptionId,
        categoryId,
        label: "The team was attentive",
        categoryLabel: "Service",
        proposition: "The team was attentive.",
      },
    });
    await runSql(`
      UPDATE tenants
      SET name = 'Unpublished Tenant', locale = 'de-DE',
          default_entry_mode_key = 'invite',
          policy = '{"minimumFactSelections":20,"maximumCustomerAssertionChars":1}'::jsonb
      WHERE id = '${tenantId}';
      UPDATE locations SET name = 'Unpublished Location'
      WHERE id = '${locationId}';
      UPDATE fact_option_versions
      SET proposition = 'Unpublished Fact Option',
          label = '{"en-GB":"Unpublished Fact Option"}'::jsonb
      WHERE id = '${factOptionId}';
      UPDATE review_format_versions
      SET supported_actions = ARRAY['GENERATE','PARAPHRASE']::generation_action[],
          localized_text = '{"displayName":{"en-GB":"Unpublished Format"},"description":{"en-GB":"Unpublished."},"sample":{"en-GB":"Unpublished."}}'::jsonb
      WHERE id = '${reviewFormatVersionId}';
      UPDATE review_format_enablements
      SET allowed_actions = ARRAY['GENERATE','PARAPHRASE']::generation_action[]
      WHERE id = '${enablementId}';
    `);
    const entryStore = createPostgresEntryAdmissionStore({ databaseUrl });
    const reader = createPostgresReviewSessionReader({
      databaseUrl: contextServiceDatabaseUrl(),
    });

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

  it("admits a valid Invitation Token into one browser-bound Review Session", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const invitationTokenId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    const enablementId = randomUUID();
    const invitationTokenHash = `sha256:invite-${randomUUID()}`;
    const entryRouteHash = `sha256:entry-${randomUUID()}`;
    const browserHash = `sha256:browser-${randomUUID()}`;
    const reviewRouteHash = `sha256:review-${randomUUID()}`;
    const competingEntryRouteHash = `sha256:entry-${randomUUID()}`;
    const competingBrowserHash = `sha256:browser-${randomUUID()}`;
    const competingReviewRouteHash = `sha256:review-${randomUUID()}`;
    await runSql(`
      INSERT INTO entry_mode_definitions (key, semantics)
      VALUES ('invite', '{"verification":false}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO tenants (
        id, slug, name, locale, default_entry_mode_key, policy
      ) VALUES (
        '${tenantId}', 'tenant-${tenantId}', 'Private Clinic', 'en-GB',
        'invite', '{"requireVerifiedExperience":false}'::jsonb
      );
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES (
        '${locationId}', '${tenantId}', 'location-${locationId}', 'Private Clinic West'
      );
      INSERT INTO invitation_tokens (
        id, tenant_id, location_id, token_hash, expires_at
      ) VALUES (
        '${invitationTokenId}', '${tenantId}', '${locationId}',
        '${invitationTokenHash}', clock_timestamp() + interval '1 hour'
      );
      INSERT INTO review_format_versions (
        id, format_key, version, locale, target_platform, constraints,
        localized_text, supported_actions, content_hash, status
      ) VALUES (
        '${reviewFormatVersionId}', 'invite-${reviewFormatVersionId}', 1,
        'en-GB', 'google',
        '{"minChars":1,"maxChars":350,"paragraphs":1}'::jsonb,
        '{"displayName":{"en-GB":"Concise review"},"description":{"en-GB":"One short paragraph."},"sample":{"en-GB":"A concise review."}}'::jsonb,
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
    await publishAdmissionSnapshot({
      tenantId,
      locationId,
      tenantName: "Private Clinic",
      locationName: "Private Clinic West",
      locale: "en-GB",
      entryMode: "invite",
      requireVerifiedExperience: false,
      reviewFormatVersionId,
    });
    const entryStore = createPostgresEntryAdmissionStore({ databaseUrl });
    const reader = createPostgresReviewSessionReader({
      databaseUrl: contextServiceDatabaseUrl(),
    });

    try {
      await expect(
        entryStore.prepare({
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash,
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
        context: { entryMode: "invite" },
      });
      await expect(
        entryStore.prepare({
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash,
          routeHandleHash: competingEntryRouteHash,
          browserCapabilityHash: competingBrowserHash,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }),
      ).resolves.toEqual({ status: "prepared" });

      const admissionInput = {
        rating: 5 as const,
        action: "GENERATE" as const,
        reviewSessionExpiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60_000,
        ).toISOString(),
        browserBindingExpiresAt: new Date(
          Date.now() + 2_000,
        ).toISOString(),
      };
      const admissions = await Promise.all([
        entryStore.advance({
          ...admissionInput,
          routeHandleHash: entryRouteHash,
          browserCapabilityHash: browserHash,
          reviewSessionRouteHandleHash: reviewRouteHash,
        }),
        entryStore.advance({
          ...admissionInput,
          routeHandleHash: competingEntryRouteHash,
          browserCapabilityHash: competingBrowserHash,
          reviewSessionRouteHandleHash: competingReviewRouteHash,
        }),
      ]);
      expect(admissions.map(({ status }) => status).sort()).toEqual([
        "admitted",
        "unavailable",
      ]);
      const admittedIndex = admissions.findIndex(
        ({ status }) => status === "admitted",
      );
      expect(admissions[admittedIndex]).toMatchObject({
        status: "admitted",
        tenantId,
        locationId,
      });
      const admittedBinding = {
        routeHandleHash:
          admittedIndex === 0 ? reviewRouteHash : competingReviewRouteHash,
        browserCapabilityHash:
          admittedIndex === 0 ? browserHash : competingBrowserHash,
      };
      await expect(reader.read(admittedBinding)).resolves.toMatchObject({
        tenantId,
        locationId,
        rating: 5,
        action: "generate",
      });
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await expect(reader.read(admittedBinding)).resolves.toMatchObject({
        tenantId,
        locationId,
        rating: 5,
        action: "generate",
      });
    } finally {
      await entryStore.disconnect();
      await reader.disconnect();
    }
  });

  it("persists the pending rating and Action without consuming a token that needs verification", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const visitId = randomUUID();
    const invitationTokenId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    const enablementId = randomUUID();
    const invitationTokenHash = `sha256:invite-${randomUUID()}`;
    const entryRouteHash = `sha256:entry-${randomUUID()}`;
    const browserHash = `sha256:browser-${randomUUID()}`;
    await runSql(`
      INSERT INTO entry_mode_definitions (key, semantics)
      VALUES ('invite', '{"verification":true}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO platform_settings (id, default_policy)
      VALUES (
        'platform', '{"requireVerifiedExperience":true}'::jsonb
      )
      ON CONFLICT (id) DO UPDATE
      SET default_policy = EXCLUDED.default_policy;
      INSERT INTO tenants (
        id, slug, name, locale, default_entry_mode_key, policy
      ) VALUES (
        '${tenantId}', 'tenant-${tenantId}', 'Verified Hotel', 'de-DE',
        'invite', '{}'::jsonb
      );
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES (
        '${locationId}', '${tenantId}', 'location-${locationId}', 'Verified Hotel Mitte'
      );
      INSERT INTO visits (
        id, tenant_id, location_id, occurred_at,
        verification_method, verification_evidence_hash
      ) VALUES (
        '${visitId}', '${tenantId}', '${locationId}', clock_timestamp(),
        'booking-reference', 'sha256:evidence-correct'
      );
      INSERT INTO invitation_tokens (
        id, tenant_id, location_id, visit_id, token_hash, expires_at
      ) VALUES (
        '${invitationTokenId}', '${tenantId}', '${locationId}', '${visitId}',
        '${invitationTokenHash}', clock_timestamp() + interval '1 hour'
      );
      INSERT INTO review_format_versions (
        id, format_key, version, locale, target_platform, constraints,
        localized_text, supported_actions, content_hash, status
      ) VALUES (
        '${reviewFormatVersionId}', 'verified-${reviewFormatVersionId}', 1,
        'de-DE', 'google',
        '{"minChars":1,"maxChars":350,"paragraphs":1}'::jsonb,
        '{"displayName":{"de-DE":"Kurz"},"description":{"de-DE":"Ein kurzer Absatz."},"sample":{"de-DE":"Ein kurzer Text."}}'::jsonb,
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
    await publishAdmissionSnapshot({
      tenantId,
      locationId,
      tenantName: "Verified Hotel",
      locationName: "Verified Hotel Mitte",
      locale: "de-DE",
      entryMode: "invite",
      requireVerifiedExperience: true,
      reviewFormatVersionId,
    });
    const entryStore = createPostgresEntryAdmissionStore({ databaseUrl });

    try {
      await expect(
        entryStore.prepare({
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash,
          routeHandleHash: entryRouteHash,
          browserCapabilityHash: browserHash,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }),
      ).resolves.toEqual({ status: "prepared" });

      await expect(
        entryStore.advance({
          routeHandleHash: entryRouteHash,
          browserCapabilityHash: browserHash,
          reviewSessionRouteHandleHash: `sha256:unused-${randomUUID()}`,
          rating: 3,
          action: "GENERATE",
          reviewSessionExpiresAt: new Date(
            Date.now() + 30 * 24 * 60 * 60_000,
          ).toISOString(),
          browserBindingExpiresAt: new Date(
            Date.now() + 24 * 60 * 60_000,
          ).toISOString(),
        }),
      ).resolves.toEqual({ status: "verification-required" });
      await expect(
        entryStore.read({
          routeHandleHash: entryRouteHash,
          browserCapabilityHash: browserHash,
        }),
      ).resolves.toMatchObject({
        status: "ready",
        stage: "verification-required",
        provisionalSelection: { rating: 3, action: "generate" },
      });
      const failedVerificationResults = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          entryStore.verify({
            routeHandleHash: entryRouteHash,
            browserCapabilityHash: browserHash,
            reviewSessionRouteHandleHash: `sha256:review-${randomUUID()}`,
            verificationEvidenceHash: `sha256:evidence-wrong-${index}`,
            reviewSessionExpiresAt: new Date(
              Date.now() + 30 * 24 * 60 * 60_000,
            ).toISOString(),
            browserBindingExpiresAt: new Date(
              Date.now() + 24 * 60 * 60_000,
            ).toISOString(),
          }),
        ),
      );
      expect(failedVerificationResults).toEqual(
        Array.from({ length: 4 }, () => ({
          status: "verification-unavailable",
        })),
      );
      await expect(
        entryStore.read({
          routeHandleHash: entryRouteHash,
          browserCapabilityHash: browserHash,
        }),
      ).resolves.toMatchObject({
        status: "ready",
        stage: "verification-unavailable",
        provisionalSelection: { rating: 3, action: "generate" },
      });
      const reviewRouteHashes = [
        `sha256:review-${randomUUID()}`,
        `sha256:review-${randomUUID()}`,
      ] as const;
      const verificationInput = {
        routeHandleHash: entryRouteHash,
        browserCapabilityHash: browserHash,
        verificationEvidenceHash: "sha256:evidence-correct",
        reviewSessionExpiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60_000,
        ).toISOString(),
        browserBindingExpiresAt: new Date(
          Date.now() + 24 * 60 * 60_000,
        ).toISOString(),
      } as const;
      const verified = await Promise.all(
        reviewRouteHashes.map(async (reviewSessionRouteHandleHash) => ({
          reviewSessionRouteHandleHash,
          result: await entryStore.verify({
            ...verificationInput,
            reviewSessionRouteHandleHash,
          }),
        })),
      );
      expect(verified.map(({ result }) => result.status).sort()).toEqual([
        "admitted",
        "unavailable",
      ]);
      const admittedVerification = verified.find(
        ({ result }) => result.status === "admitted",
      );
      expect(admittedVerification?.result).toMatchObject({
        status: "admitted",
        tenantId,
        locationId,
      });
      const reader = createPostgresReviewSessionReader({
        databaseUrl: contextServiceDatabaseUrl(),
      });
      try {
        await expect(
          reader.read({
            routeHandleHash:
              admittedVerification?.reviewSessionRouteHandleHash ?? "missing",
            browserCapabilityHash: browserHash,
          }),
        ).resolves.toMatchObject({
          tenantId,
          locationId,
          rating: 3,
          action: "generate",
        });
      } finally {
        await reader.disconnect();
      }
    } finally {
      await entryStore.disconnect();
      await runSql(`
        UPDATE platform_settings
        SET default_policy = '{"requireVerifiedExperience":false}'::jsonb
        WHERE id = 'platform';
      `);
    }
  });

  it("locks an Entry Challenge after five failed evidence attempts without consuming its Invitation Token", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const visitId = randomUUID();
    const invitationTokenId = randomUUID();
    const reviewFormatVersionId = randomUUID();
    const enablementId = randomUUID();
    const invitationTokenHash = `sha256:invite-${randomUUID()}`;
    const lockedEntryRouteHash = `sha256:entry-${randomUUID()}`;
    const lockedBrowserHash = `sha256:browser-${randomUUID()}`;
    const freshEntryRouteHash = `sha256:entry-${randomUUID()}`;
    const freshBrowserHash = `sha256:browser-${randomUUID()}`;
    await runSql(`
      INSERT INTO entry_mode_definitions (key, semantics)
      VALUES ('invite', '{"verification":true}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO tenants (
        id, slug, name, locale, default_entry_mode_key, policy
      ) VALUES (
        '${tenantId}', 'tenant-${tenantId}', 'Bounded Evidence Hotel', 'en-GB',
        'invite', '{"requireVerifiedExperience":true}'::jsonb
      );
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES (
        '${locationId}', '${tenantId}', 'location-${locationId}',
        'Bounded Evidence Hotel West'
      );
      INSERT INTO visits (
        id, tenant_id, location_id, occurred_at,
        verification_method, verification_evidence_hash
      ) VALUES (
        '${visitId}', '${tenantId}', '${locationId}', clock_timestamp(),
        'booking-reference', 'sha256:evidence-correct'
      );
      INSERT INTO invitation_tokens (
        id, tenant_id, location_id, visit_id, token_hash, expires_at
      ) VALUES (
        '${invitationTokenId}', '${tenantId}', '${locationId}', '${visitId}',
        '${invitationTokenHash}', clock_timestamp() + interval '1 hour'
      );
      INSERT INTO review_format_versions (
        id, format_key, version, locale, target_platform, constraints,
        localized_text, supported_actions, content_hash, status
      ) VALUES (
        '${reviewFormatVersionId}', 'bounded-${reviewFormatVersionId}', 1,
        'en-GB', 'google',
        '{"minChars":1,"maxChars":350,"paragraphs":1}'::jsonb,
        '{"displayName":{"en-GB":"Concise"},"description":{"en-GB":"One short paragraph."},"sample":{"en-GB":"A concise review."}}'::jsonb,
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
    await publishAdmissionSnapshot({
      tenantId,
      locationId,
      tenantName: "Bounded Evidence Hotel",
      locationName: "Bounded Evidence Hotel West",
      locale: "en-GB",
      entryMode: "invite",
      requireVerifiedExperience: true,
      reviewFormatVersionId,
    });
    const entryStore = createPostgresEntryAdmissionStore({
      databaseUrl: contextServiceDatabaseUrl(),
    });
    const reviewSessionExpiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60_000,
    ).toISOString();
    const browserBindingExpiresAt = new Date(
      Date.now() + 24 * 60 * 60_000,
    ).toISOString();

    try {
      await expect(
        entryStore.prepare({
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash,
          routeHandleHash: lockedEntryRouteHash,
          browserCapabilityHash: lockedBrowserHash,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }),
      ).resolves.toEqual({ status: "prepared" });
      await expect(
        entryStore.advance({
          routeHandleHash: lockedEntryRouteHash,
          browserCapabilityHash: lockedBrowserHash,
          reviewSessionRouteHandleHash: `sha256:unused-${randomUUID()}`,
          rating: 5,
          action: "GENERATE",
          reviewSessionExpiresAt,
          browserBindingExpiresAt,
        }),
      ).resolves.toEqual({ status: "verification-required" });

      const failedAttemptResults = await Promise.all(
        Array.from({ length: 5 }, async (_, index) =>
          entryStore.verify({
            routeHandleHash: lockedEntryRouteHash,
            browserCapabilityHash: lockedBrowserHash,
            reviewSessionRouteHandleHash: `sha256:failed-${index}-${randomUUID()}`,
            verificationEvidenceHash: `sha256:evidence-wrong-${index}`,
            reviewSessionExpiresAt,
            browserBindingExpiresAt,
          }),
        ),
      );
      expect(failedAttemptResults).toEqual(
        Array.from({ length: 5 }, () => ({
          status: "verification-unavailable",
        })),
      );
      await expect(
        entryStore.verify({
          routeHandleHash: lockedEntryRouteHash,
          browserCapabilityHash: lockedBrowserHash,
          reviewSessionRouteHandleHash: `sha256:failed-${randomUUID()}`,
          verificationEvidenceHash: "sha256:evidence-still-wrong",
          reviewSessionExpiresAt,
          browserBindingExpiresAt,
        }),
      ).resolves.toEqual({ status: "verification-unavailable" });
      await expect(
        entryStore.verify({
          routeHandleHash: lockedEntryRouteHash,
          browserCapabilityHash: lockedBrowserHash,
          reviewSessionRouteHandleHash: `sha256:locked-${randomUUID()}`,
          verificationEvidenceHash: "sha256:evidence-correct",
          reviewSessionExpiresAt,
          browserBindingExpiresAt,
        }),
      ).resolves.toEqual({ status: "verification-unavailable" });

      await expect(
        entryStore.prepare({
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash,
          routeHandleHash: freshEntryRouteHash,
          browserCapabilityHash: freshBrowserHash,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        }),
      ).resolves.toEqual({ status: "prepared" });
      await expect(
        entryStore.advance({
          routeHandleHash: freshEntryRouteHash,
          browserCapabilityHash: freshBrowserHash,
          reviewSessionRouteHandleHash: `sha256:unused-${randomUUID()}`,
          rating: 5,
          action: "GENERATE",
          reviewSessionExpiresAt,
          browserBindingExpiresAt,
        }),
      ).resolves.toEqual({ status: "verification-required" });
      await expect(
        entryStore.verify({
          routeHandleHash: freshEntryRouteHash,
          browserCapabilityHash: freshBrowserHash,
          reviewSessionRouteHandleHash: `sha256:admitted-${randomUUID()}`,
          verificationEvidenceHash: "sha256:evidence-correct",
          reviewSessionExpiresAt,
          browserBindingExpiresAt,
        }),
      ).resolves.toMatchObject({
        status: "admitted",
        tenantId,
        locationId,
      });
    } finally {
      await entryStore.disconnect();
    }
  });

  it("returns one unavailable result for unknown, mismatched, expired and used invitation evidence", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const tenantId = randomUUID();
    const locationId = randomUUID();
    const otherTenantId = randomUUID();
    const otherLocationId = randomUUID();
    const expiredTokenHash = `sha256:expired-${randomUUID()}`;
    const usedTokenHash = `sha256:used-${randomUUID()}`;
    const mismatchedTokenHash = `sha256:mismatch-${randomUUID()}`;
    await runSql(`
      INSERT INTO entry_mode_definitions (key, semantics)
      VALUES ('invite', '{"verification":false}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO tenants (id, slug, name, locale, default_entry_mode_key)
      VALUES
        ('${tenantId}', 'tenant-${tenantId}', 'Hidden Tenant', 'en-GB', 'invite'),
        ('${otherTenantId}', 'tenant-${otherTenantId}', 'Other Tenant', 'en-GB', 'invite');
      INSERT INTO locations (id, tenant_id, slug, name)
      VALUES
        ('${locationId}', '${tenantId}', 'location-${locationId}', 'Hidden Location'),
        ('${otherLocationId}', '${otherTenantId}', 'location-${otherLocationId}', 'Other Location');
      INSERT INTO invitation_tokens (
        tenant_id, location_id, token_hash, issued_at, expires_at, consumed_at
      ) VALUES
        (
          '${tenantId}', '${locationId}', '${expiredTokenHash}',
          clock_timestamp() - interval '2 hours',
          clock_timestamp() - interval '1 hour', NULL
        ),
        (
          '${tenantId}', '${locationId}', '${usedTokenHash}',
          clock_timestamp() - interval '2 hours',
          clock_timestamp() + interval '1 hour',
          clock_timestamp() - interval '1 hour'
        ),
        (
          '${otherTenantId}', '${otherLocationId}', '${mismatchedTokenHash}',
          clock_timestamp(), clock_timestamp() + interval '1 hour', NULL
        );
    `);
    await publishAdmissionSnapshot({
      tenantId,
      locationId,
      tenantName: "Hidden Tenant",
      locationName: "Hidden Location",
      locale: "en-GB",
      entryMode: "invite",
      requireVerifiedExperience: false,
    });
    const entryStore = createPostgresEntryAdmissionStore({ databaseUrl });
    const baseInput = {
      routeHandleHash: `sha256:entry-${randomUUID()}`,
      browserCapabilityHash: `sha256:browser-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };

    try {
      const unavailable = await Promise.all([
        entryStore.prepare({
          ...baseInput,
          tenantSlug: `unknown-${randomUUID()}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash: "sha256:not-a-token",
        }),
        entryStore.prepare({
          ...baseInput,
          routeHandleHash: `sha256:entry-${randomUUID()}`,
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `unknown-${randomUUID()}`,
          invitationTokenHash: "sha256:not-a-token",
        }),
        entryStore.prepare({
          ...baseInput,
          routeHandleHash: `sha256:entry-${randomUUID()}`,
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash: "sha256:not-a-token",
        }),
        entryStore.prepare({
          ...baseInput,
          routeHandleHash: `sha256:entry-${randomUUID()}`,
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash: expiredTokenHash,
        }),
        entryStore.prepare({
          ...baseInput,
          routeHandleHash: `sha256:entry-${randomUUID()}`,
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash: usedTokenHash,
        }),
        entryStore.prepare({
          ...baseInput,
          routeHandleHash: `sha256:entry-${randomUUID()}`,
          tenantSlug: `tenant-${tenantId}`,
          locationSlug: `location-${locationId}`,
          invitationTokenHash: mismatchedTokenHash,
        }),
      ]);
      expect(unavailable).toEqual(
        Array.from({ length: 6 }, () => ({ status: "unavailable" })),
      );
    } finally {
      await entryStore.disconnect();
    }
  });
});
