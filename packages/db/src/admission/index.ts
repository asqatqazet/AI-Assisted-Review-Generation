import { createHash, randomUUID } from "node:crypto";

import type {
  PersistedConfigSnapshotDocument,
  PromptVersion,
  ReviewFormatVersion,
} from "@review/domain/configuration";
import { deriveConfigSnapshotId } from "@review/domain/configuration";
import { isExecutableGenerationAction } from "@review/domain/generation";
import { composePrompt } from "@review/domain/prompt";
import type { ReviewFormatManifest } from "@review/domain/review-format";

import { Prisma, PrismaClient } from "../generated/admission/index.js";

export { createPostgresReviewSessionProgressStore } from "../review-session/index.js";
export { readAdmissionDatabaseCurrentUser } from "./database-identity.js";
export {
  createPostgresPublicSourceRateLimitStore,
  type DatabasePublicSourceRateLimitPolicy,
  type PostgresPublicSourceRateLimitStore,
} from "./public-source-rate-limit.js";
export type {
  PostgresReviewSessionProgressStore,
  ReviewSessionProgressInput,
  StoredReviewerDraftProjection,
  StoredReviewSessionProgress,
} from "../review-session/index.js";

export interface ReviewSessionCapabilityHashes {
  readonly routeHandleHash: string;
  readonly browserCapabilityHash: string;
}

export interface ReviewSessionFactProjection {
  readonly id: string;
  readonly label: string;
  readonly categoryLabel: string;
  readonly polarity: "positive" | "neutral" | "negative";
}

export interface ReviewSessionFormatProjection {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly sample: string;
  readonly targetPlatform: string;
  readonly constraints: {
    readonly minChars: number;
    readonly maxChars: number;
  };
  readonly availableCommands: readonly (
    | "generate"
    | "paraphrase"
    | "reformat"
    | "condense"
    | "expand"
    | "revise-wording"
  )[];
}

export interface ReviewSessionDestinationProjection {
  readonly targetPlatform: string;
  readonly displayName: string;
  readonly targetUrl: string;
}

export interface StoredReviewSessionProjection {
  readonly reviewSessionId: string;
  readonly tenantId: string;
  readonly locationId: string;
  readonly tenantDisplayName: string;
  readonly locationDisplayName: string;
  readonly locale: "en-GB" | "de-DE";
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly action: "generate" | "paraphrase";
  readonly requirements: {
    readonly minimumFactSelections: number;
    readonly maximumReviewFormatsPerGeneration: 1;
    readonly maximumCustomerAssertionChars: number;
  };
  readonly factOptions: readonly ReviewSessionFactProjection[];
  readonly reviewFormats: readonly ReviewSessionFormatProjection[];
  readonly destinations: readonly ReviewSessionDestinationProjection[];
}

export interface PostgresReviewSessionReader {
  read(
    hashes: ReviewSessionCapabilityHashes,
  ): Promise<StoredReviewSessionProjection | null>;
  disconnect(): Promise<void>;
}

export type ReviewerGenerationAdmissionCommand =
  | {
      readonly kind: "generate";
      readonly factOptionIds: readonly string[];
      readonly customerAssertion?: string | undefined;
      readonly reviewFormatVersionId: string;
    }
  | {
      readonly kind: "paraphrase";
      readonly sourceText: string;
      readonly reviewFormatVersionId: string;
    }
  | {
      readonly kind: "resample";
      readonly sourceGenerationId: string;
    }
  | {
      readonly kind: "reformat";
      readonly sourceGenerationId: string;
      readonly reviewFormatVersionId: string;
    }
  | {
      readonly kind: "condense";
      readonly sourceGenerationId: string;
      readonly targetMaxChars: number;
    }
  | {
      readonly kind: "expand";
      readonly sourceGenerationId: string;
      readonly targetMinChars: number;
    }
  | {
      readonly kind: "revise-wording";
      readonly sourceGenerationId: string;
      readonly presentationInstruction: string;
    };

export interface ReviewerGenerationAdmissionInput {
  readonly routeHandleHash: string;
  readonly browserCapabilityHash: string;
  readonly idempotencyKey: string;
  readonly command: ReviewerGenerationAdmissionCommand;
}

export type ReviewerGenerationRejectionCode =
  | "GROUNDING_REJECTED"
  | "POLICY_REJECTED"
  | "FORMAT_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "RATE_LIMITED"
  | "BUDGET_EXCEEDED"
  | "CANCELLED"
  | "GENERATION_FAILED";

export type ReviewerGenerationAdmissionResult =
  | {
      readonly status: "prepared";
      readonly permitJti: string;
      readonly permitExpiresAt: string;
      readonly workload: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: "rejected";
      readonly code: ReviewerGenerationRejectionCode;
      readonly retryable: boolean;
      readonly retryAfterSeconds?: number | undefined;
    };

export interface PostgresReviewerGenerationAdmissionStore {
  prepare(
    input: ReviewerGenerationAdmissionInput,
  ): Promise<ReviewerGenerationAdmissionResult>;
  activate(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly reviewSessionId: string;
    readonly generationBatchId: string;
    readonly generationId: string;
    readonly requestHash: string;
    readonly permitJti: string;
    readonly leaseId: string;
    readonly leaseExpiresAt: string;
  }): Promise<
    | {
        readonly status: "activated";
        readonly leaseId: string;
        readonly activationExpiresAt: string;
      }
    | { readonly status: "rejected" }
  >;
  settle(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly reviewSessionId: string;
    readonly generationBatchId: string;
    readonly generationId: string;
    readonly requestHash: string;
    readonly permitJti: string;
    readonly leaseId: string;
    readonly actualCostMicros: number;
  }): Promise<{ readonly status: "settled" } | { readonly status: "rejected" }>;
  listReconciliationCandidates(input: { readonly limit: number }): Promise<
    readonly (
      | {
          readonly kind: "never-leased";
          readonly permitJti: string;
          readonly workload: Readonly<Record<string, unknown>>;
        }
      | {
          readonly kind: "expired-lease";
          readonly permitJti: string;
          readonly leaseId: string;
          readonly workload: Readonly<Record<string, unknown>>;
        }
    )[]
  >;
  releaseReconciled(input:
    | {
        readonly outcome: "no-lease";
        readonly tenantId: string;
        readonly locationId: string;
        readonly reviewSessionId: string;
        readonly generationBatchId: string;
        readonly generationId: string;
        readonly requestHash: string;
        readonly permitJti: string;
      }
    | {
        readonly outcome: "cancelled";
        readonly tenantId: string;
        readonly locationId: string;
        readonly reviewSessionId: string;
        readonly generationBatchId: string;
        readonly generationId: string;
        readonly requestHash: string;
        readonly permitJti: string;
        readonly leaseId: string;
      }
  ): Promise<{ readonly status: "released" | "rejected" }>;
  disconnect(): Promise<void>;
}

export interface PostgresEntryAdmissionStore {
  prepare(input: {
    readonly tenantSlug: string;
    readonly locationSlug: string;
    readonly invitationTokenHash?: string | undefined;
    readonly routeHandleHash: string;
    readonly browserCapabilityHash: string;
    readonly tableRefHash?: string | undefined;
    readonly configurationReleaseId?: string | undefined;
    readonly expiresAt: string;
  }): Promise<{ readonly status: "prepared" } | { readonly status: "unavailable" }>;
  read(input: ReviewSessionCapabilityHashes): Promise<
    | {
        readonly status: "ready";
        readonly stage:
          | "entry"
          | "verification-required"
          | "verification-unavailable";
        readonly provisionalSelection: {
          readonly rating: 1 | 2 | 3 | 4 | 5;
          readonly action: "generate" | "paraphrase";
        } | null;
        readonly context: {
          readonly tenantDisplayName: string;
          readonly locationDisplayName: string;
          readonly locale: "en-GB" | "de-DE";
          readonly entryMode: "invite" | "open-qr" | "both";
          readonly ratingRequired: true;
          readonly requirements: {
            readonly minimumFactSelections: number;
            readonly maximumReviewFormatsPerGeneration: 1;
            readonly maximumCustomerAssertionChars: number;
          };
          readonly factOptions: readonly ReviewSessionFactProjection[];
          readonly reviewFormats: readonly ReviewSessionFormatProjection[];
          readonly destinations: readonly ReviewSessionDestinationProjection[];
        };
      }
    | { readonly status: "unavailable" }
  >;
  advance(input: {
    readonly routeHandleHash: string;
    readonly browserCapabilityHash: string;
    readonly reviewSessionRouteHandleHash: string;
    readonly rating: 1 | 2 | 3 | 4 | 5;
    readonly action: "GENERATE" | "PARAPHRASE";
    readonly reviewSessionExpiresAt: string;
    readonly browserBindingExpiresAt?: string | undefined;
  }): Promise<
    | {
        readonly status: "admitted";
        readonly reviewSessionId: string;
        readonly tenantId: string;
        readonly locationId: string;
      }
    | { readonly status: "verification-required" }
    | { readonly status: "unavailable" }
  >;
  verify(input: {
    readonly routeHandleHash: string;
    readonly browserCapabilityHash: string;
    readonly reviewSessionRouteHandleHash: string;
    readonly verificationEvidenceHash: string;
    readonly reviewSessionExpiresAt: string;
    readonly browserBindingExpiresAt: string;
  }): Promise<
    | {
        readonly status: "admitted";
        readonly reviewSessionId: string;
        readonly tenantId: string;
        readonly locationId: string;
      }
    | { readonly status: "verification-unavailable" }
    | { readonly status: "unavailable" }
  >;
  disconnect(): Promise<void>;
}

interface BindingRow {
  readonly tenant_id: string;
  readonly location_id: string;
  readonly review_session_id: string;
}

interface SessionRow {
  readonly review_session_id: string;
  readonly rating: number;
  readonly selected_action: string;
  readonly configuration_snapshot_id: string | null;
}

interface DestinationRow {
  readonly target_platform: string;
  readonly display_name: string;
  readonly target_url: string;
}

interface AdmissionSessionRow {
  readonly rating: number;
  readonly selected_action: string;
  readonly configuration_snapshot_id: string | null;
}

interface AdmissionFactRow {
  readonly id: string;
  readonly version: string;
  readonly proposition: string;
  readonly polarity: string;
}

interface AdmissionSnapshotRow {
  readonly id: string;
  readonly content_hash: string;
  readonly payload: unknown;
}

interface PublishedAdmissionSnapshot {
  readonly id: string;
  readonly contentHash: string;
  readonly document: Readonly<Record<string, unknown>>;
  readonly settings: Readonly<Record<string, unknown>>;
}

interface AdmissionPriceRateRow {
  readonly price_rate_id: string;
  readonly provider_model_id: string;
  readonly provider_key: string;
  readonly model_key: string;
  readonly credential_available: boolean;
  readonly input_per_million_micros: bigint;
  readonly output_per_million_micros: bigint;
  readonly currency: string;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
}

interface AdmissionSpendRow {
  readonly settled_micros: bigint;
  readonly live_micros: bigint;
}

interface AdmissionLimitRow {
  readonly session_recent: bigint;
  readonly tenant_recent: bigint;
  readonly session_active: bigint;
  readonly tenant_active: bigint;
}

interface ExistingAdmissionRow {
  readonly request_hash: string;
  readonly permit_jti: string;
  readonly expires_at: Date;
  readonly normalized_input: unknown;
}

interface ActivationRow {
  readonly reservation_id: string;
  readonly execution_lease_id: string;
  readonly activation_expires_at: Date;
}

interface ReconciliationQueueRow {
  readonly reservation_id: string;
  readonly tenant_id: string;
  readonly execution_lease_id: string | null;
}

interface ReconciliationCandidateRow {
  readonly permit_jti: string;
  readonly execution_lease_id: string | null;
  readonly normalized_input: unknown;
}

interface EntryScopeRow {
  readonly challenge_id: string;
  readonly tenant_id: string;
  readonly location_id: string;
  readonly invitation_token_id: string | null;
  readonly visit_id: string | null;
  readonly entry_mode_key: string;
  readonly verification_required: boolean;
  readonly provisional_rating: number | null;
  readonly provisional_action: string | null;
  readonly verification_failed_at: Date | null;
  readonly configuration_release_id: string | null;
  readonly configuration_snapshot_id: string | null;
}

interface VerificationEvidenceRow {
  readonly verification_evidence_hash: string;
}

interface VerificationAttemptRow {
  readonly verification_failure_count: number;
}

class EntryAdmissionUnavailableError extends Error {
  constructor() {
    super("Entry admission is unavailable");
    this.name = "EntryAdmissionUnavailableError";
  }
}

const isLocale = (value: string): value is "en-GB" | "de-DE" =>
  value === "en-GB" || value === "de-DE";

const isEntryMode = (
  value: string,
): value is "invite" | "open-qr" | "both" =>
  value === "invite" || value === "open-qr" || value === "both";

const isRating = (value: number): value is 1 | 2 | 3 | 4 | 5 =>
  Number.isInteger(value) && value >= 1 && value <= 5;

const minimumFactSelections = (policy: unknown): number => {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    return 1;
  }
  const value = (policy as Readonly<Record<string, unknown>>)[
    "minimumFactSelections"
  ];
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20
    ? value
    : 1;
};

const maximumCustomerAssertionChars = (policy: unknown): number => {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    return 500;
  }
  const value = (policy as Readonly<Record<string, unknown>>)[
    "maximumCustomerAssertionChars"
  ];
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5_000
    ? value
    : 500;
};

const formatConstraints = (
  value: unknown,
): { readonly minChars: number; readonly maxChars: number } | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const minChars = record["minChars"];
  const maxChars = record["maxChars"];
  return typeof minChars === "number" &&
    Number.isInteger(minChars) &&
    minChars >= 0 &&
    typeof maxChars === "number" &&
    Number.isInteger(maxChars) &&
    maxChars > 0 &&
    minChars <= maxChars
    ? { minChars, maxChars }
    : undefined;
};

const toAction = (value: string): "generate" | "paraphrase" | undefined =>
  value === "GENERATE"
    ? "generate"
    : value === "PARAPHRASE"
      ? "paraphrase"
      : undefined;

const toPolarity = (
  value: string,
): "positive" | "neutral" | "negative" | undefined =>
  value === "POSITIVE"
    ? "positive"
    : value === "NEUTRAL"
      ? "neutral"
      : value === "NEGATIVE"
        ? "negative"
        : undefined;

const toAvailableCommand = (
  value: string,
): ReviewSessionFormatProjection["availableCommands"][number] | undefined => {
  switch (value) {
    case "GENERATE":
    case "generate":
      return "generate";
    case "PARAPHRASE":
    case "paraphrase":
      return "paraphrase";
    case "REFORMAT":
    case "reformat":
      return "reformat";
    case "CONDENSE":
    case "condense":
      return "condense";
    case "EXPAND":
    case "expand":
      return "expand";
    case "REVISE_WORDING":
    case "revise-wording":
      return "revise-wording";
    default:
      return undefined;
  }
};

const snapshotRecord = (
  value: unknown,
): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const loadPublishedSnapshot = async (
  transaction: Prisma.TransactionClient,
  tenantId: string,
  locationId: string,
  snapshotId?: string | null,
): Promise<PublishedAdmissionSnapshot | undefined> => {
  const row = (
    await transaction.$queryRaw<AdmissionSnapshotRow[]>`
      SELECT id, content_hash, payload
      FROM effective_configuration_snapshots
      WHERE tenant_id = ${tenantId}::uuid
        AND location_id = ${locationId}::uuid
        AND id = COALESCE(
          ${snapshotId ?? null}::uuid,
          public.resolve_configuration_snapshot(
            ${tenantId}::uuid, ${locationId}::uuid, NULL::uuid
          )
        )
      LIMIT 1
    `
  )[0];
  const document = snapshotRecord(row?.payload);
  const settings = snapshotRecord(document?.["settings"]);
  let canonicalHashMatches = false;
  if (document !== undefined && row !== undefined) {
    try {
      canonicalHashMatches =
        deriveConfigSnapshotId(
          document as unknown as PersistedConfigSnapshotDocument,
        ) === row.content_hash;
    } catch {
      canonicalHashMatches = false;
    }
  }
  return row !== undefined &&
    document !== undefined &&
    settings !== undefined &&
    canonicalHashMatches &&
    document["snapshotId"] === row.id &&
    document["schemaVersion"] === 2 &&
    document["tenantId"] === tenantId &&
    document["locationId"] === locationId
    ? { id: row.id, contentHash: row.content_hash, document, settings }
    : undefined;
};

const snapshotInteger = (
  settings: Readonly<Record<string, unknown>>,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined => {
  const value = settings[key];
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
};

const snapshotEnabledCommands = (
  settings: Readonly<Record<string, unknown>>,
): readonly ReviewSessionFormatProjection["availableCommands"][number][] | undefined => {
  const values = settings["enabledCommands"];
  if (!Array.isArray(values)) {
    return undefined;
  }
  const commands = values.flatMap((value) => {
    const command = typeof value === "string" ? toAvailableCommand(value) : undefined;
    return command === undefined ? [] : [command];
  });
  return commands.length === values.length ? commands : undefined;
};

const snapshotFactProjections = (input: {
  readonly snapshot: PublishedAdmissionSnapshot;
  readonly tenantId: string;
  readonly locationId: string;
}): readonly ReviewSessionFactProjection[] | undefined => {
  const rawFacts = input.snapshot.document["factOptions"];
  if (!Array.isArray(rawFacts)) {
    return undefined;
  }
  const facts: Array<ReviewSessionFactProjection & { readonly sortOrder: number }> = [];
  const identities = new Set<string>();
  for (const rawFact of rawFacts) {
    const fact = snapshotRecord(rawFact);
    const owner = snapshotRecord(fact?.["owner"]);
    const id = fact?.["id"];
    const proposition = fact?.["proposition"];
    const rawPolarity = fact?.["polarity"];
    const sortOrder = fact?.["sortOrder"];
    const polarity =
      typeof rawPolarity === "string"
        ? rawPolarity === "positive" ||
          rawPolarity === "neutral" ||
          rawPolarity === "negative"
          ? rawPolarity
          : toPolarity(rawPolarity)
        : undefined;
    const ownerMatches =
      owner?.["tenantId"] === input.tenantId &&
      (owner["scope"] === "tenant" ||
        (owner["scope"] === "location" &&
          owner["locationId"] === input.locationId));
    if (
      typeof id !== "string" ||
      identities.has(id) ||
      typeof proposition !== "string" ||
      proposition.length === 0 ||
      polarity === undefined ||
      !Number.isInteger(sortOrder) ||
      fact?.["active"] !== true ||
      !ownerMatches
    ) {
      return undefined;
    }
    const label =
      typeof fact["label"] === "string" && fact["label"].length > 0
        ? fact["label"]
        : proposition;
    const categoryLabel =
      typeof fact["categoryLabel"] === "string" &&
      fact["categoryLabel"].length > 0
        ? fact["categoryLabel"]
        : typeof fact["categoryId"] === "string"
          ? fact["categoryId"]
          : undefined;
    if (categoryLabel === undefined) {
      return undefined;
    }
    identities.add(id);
    facts.push({ id, label, categoryLabel, polarity, sortOrder: sortOrder as number });
  }
  return facts
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .map((fact) => ({
      id: fact.id,
      label: fact.label,
      categoryLabel: fact.categoryLabel,
      polarity: fact.polarity,
    }));
};

const localizedSnapshotText = (
  value: unknown,
  locale: "en-GB" | "de-DE",
): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  const localized = snapshotRecord(value);
  const selected = localized?.[locale] ?? localized?.["en-GB"];
  return typeof selected === "string" && selected.length > 0
    ? selected
    : undefined;
};

const snapshotFormatProjections = (input: {
  readonly snapshot: PublishedAdmissionSnapshot;
  readonly locale: "en-GB" | "de-DE";
  readonly requiredAction?: "generate" | "paraphrase" | undefined;
}): readonly ReviewSessionFormatProjection[] | undefined => {
  const rawFormats = input.snapshot.document["reviewFormats"];
  const enabledFormatIds = input.snapshot.settings["enabledReviewFormatVersionIds"];
  const enabledCommands = snapshotEnabledCommands(input.snapshot.settings);
  if (
    !Array.isArray(rawFormats) ||
    !Array.isArray(enabledFormatIds) ||
    enabledFormatIds.some((id) => typeof id !== "string") ||
    enabledCommands === undefined
  ) {
    return undefined;
  }
  const enabledFormats = new Set(enabledFormatIds as readonly string[]);
  const enabledCommandSet = new Set(enabledCommands);
  const formats: ReviewSessionFormatProjection[] = [];
  const identities = new Set<string>();
  for (const rawFormat of rawFormats) {
    const format = snapshotRecord(rawFormat);
    const id = format?.["id"];
    const rawCommands = format?.["supportedCommands"];
    const constraints = formatConstraints(format?.["constraints"]);
    if (
      format === undefined ||
      typeof id !== "string" ||
      identities.has(id) ||
      !enabledFormats.has(id) ||
      !Array.isArray(rawCommands) ||
      constraints === undefined
    ) {
      return undefined;
    }
    const availableCommands = rawCommands.flatMap((rawCommand) => {
      const command =
        typeof rawCommand === "string" ? toAvailableCommand(rawCommand) : undefined;
      return command !== undefined &&
        enabledCommandSet.has(command) &&
        isExecutableGenerationAction(command)
        ? [command]
        : [];
    });
    if (
      input.requiredAction !== undefined &&
      (!isExecutableGenerationAction(input.requiredAction) ||
        !availableCommands.includes(input.requiredAction))
    ) {
      continue;
    }
    const displayName =
      typeof format["displayName"] === "string" && format["displayName"].length > 0
        ? format["displayName"]
        : undefined;
    const description = localizedSnapshotText(format["description"], input.locale);
    const sample = localizedSnapshotText(format["sample"], input.locale);
    const targetPlatform = format["targetPlatform"];
    if (
      displayName === undefined ||
      description === undefined ||
      sample === undefined ||
      typeof targetPlatform !== "string" ||
      targetPlatform.length === 0
    ) {
      return undefined;
    }
    identities.add(id);
    formats.push({
      id,
      displayName,
      description,
      sample,
      targetPlatform,
      constraints,
      availableCommands,
    });
  }
  return formats;
};

export function createPostgresReviewSessionReader({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): PostgresReviewSessionReader {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Admission database URL is required");
  }
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  const withTenant = async <Result>(
    tenantId: string,
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> =>
    await client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT set_config('app.tenant_id', ${tenantId}, true)
      `;
      return await operation(transaction);
    });

  return {
    async read({ routeHandleHash, browserCapabilityHash }) {
      const bindings = await client.$queryRaw<BindingRow[]>`
        SELECT tenant_id, location_id, review_session_id
        FROM touch_live_review_session_browser_binding(
          ${routeHandleHash}::varchar,
          ${browserCapabilityHash}::varchar
        )
      `;
      const binding = bindings[0];
      if (binding === undefined) {
        return null;
      }

      return await withTenant(binding.tenant_id, async (transaction) => {
        const sessions = await transaction.$queryRaw<SessionRow[]>`
          SELECT
            session.id AS review_session_id,
            session.rating,
            session.selected_action::text,
            session.configuration_snapshot_id
          FROM review_sessions AS session
          JOIN tenants AS tenant ON tenant.id = session.tenant_id
          JOIN locations AS location
            ON location.id = session.location_id
           AND location.tenant_id = session.tenant_id
          WHERE session.id = ${binding.review_session_id}::uuid
            AND session.tenant_id = ${binding.tenant_id}::uuid
            AND session.location_id = ${binding.location_id}::uuid
            AND session.status = 'OPEN'
            AND session.expires_at > clock_timestamp()
            AND session.rating IS NOT NULL
            AND session.selected_action IS NOT NULL
        `;
        const session = sessions[0];
        if (session === undefined || !isRating(session.rating)) {
          return null;
        }
        const action = toAction(session.selected_action);
        if (action === undefined) {
          return null;
        }
        const snapshot = await loadPublishedSnapshot(
          transaction,
          binding.tenant_id,
          binding.location_id,
          session.configuration_snapshot_id,
        );
        const rawLocale = snapshot?.settings["locale"];
        const locale =
          typeof rawLocale === "string" && isLocale(rawLocale)
            ? rawLocale
            : undefined;
        const enabledCommands =
          snapshot === undefined
            ? undefined
            : snapshotEnabledCommands(snapshot.settings);
        const minimumSelections =
          snapshot === undefined
            ? undefined
            : snapshotInteger(snapshot.settings, "minimumFactSelections", 1, 20);
        const maximumAssertionChars =
          snapshot === undefined
            ? undefined
            : snapshotInteger(
                snapshot.settings,
                "maximumCustomerAssertionChars",
                1,
                5_000,
              );
        if (
          snapshot === undefined ||
          locale === undefined ||
          enabledCommands === undefined ||
          !enabledCommands.includes(action) ||
          snapshot.settings["maxReviewFormatsPerRequest"] !== 1 ||
          typeof snapshot.document["tenantName"] !== "string" ||
          snapshot.document["tenantName"].length === 0 ||
          typeof snapshot.document["locationName"] !== "string" ||
          snapshot.document["locationName"].length === 0 ||
          minimumSelections === undefined ||
          maximumAssertionChars === undefined
        ) {
          return null;
        }
        const factOptions = snapshotFactProjections({
          snapshot,
          tenantId: binding.tenant_id,
          locationId: binding.location_id,
        });
        const reviewFormats = snapshotFormatProjections({
          snapshot,
          locale,
          requiredAction: action,
        });
        if (factOptions === undefined || reviewFormats === undefined) {
          return null;
        }

        const destinations = await transaction.$queryRaw<DestinationRow[]>`
          SELECT
            destination_type.key AS target_platform,
            COALESCE(
              destination_type.external_id_schema ->> 'displayName',
              destination_type.key
            ) AS display_name,
            destination_binding.target_url
          FROM posting_destination_bindings AS destination_binding
          JOIN posting_destination_types AS destination_type
            ON destination_type.id = destination_binding.destination_type_id
          WHERE destination_binding.tenant_id = ${binding.tenant_id}::uuid
            AND destination_binding.location_id = ${binding.location_id}::uuid
            AND destination_binding.enabled = true
            AND destination_type.status = 'ACTIVE'
          ORDER BY destination_type.key, destination_binding.id
        `;

        return {
          reviewSessionId: session.review_session_id,
          tenantId: binding.tenant_id,
          locationId: binding.location_id,
          tenantDisplayName: snapshot.document["tenantName"],
          locationDisplayName: snapshot.document["locationName"],
          locale,
          rating: session.rating,
          action,
          requirements: {
            minimumFactSelections: minimumSelections,
            maximumReviewFormatsPerGeneration: 1 as const,
            maximumCustomerAssertionChars: maximumAssertionChars,
          },
          factOptions,
          reviewFormats,
          destinations: destinations.map((destination) => ({
            targetPlatform: destination.target_platform,
            displayName: destination.display_name,
            targetUrl: destination.target_url,
          })),
        };
      });
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}

export function createPostgresEntryAdmissionStore({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): PostgresEntryAdmissionStore {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Admission database URL is required");
  }
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  const resolveScope = async (
    routeHandleHash: string,
    browserCapabilityHash: string,
  ): Promise<EntryScopeRow | undefined> =>
    (
      await client.$queryRaw<EntryScopeRow[]>`
        SELECT
          challenge_id,
          tenant_id,
          location_id,
          invitation_token_id,
          visit_id,
          entry_mode_key,
          verification_required,
          provisional_rating,
          provisional_action,
          verification_failed_at
          ,configuration_release_id
          ,configuration_snapshot_id
        FROM resolve_live_entry_challenge(
          ${routeHandleHash}::varchar,
          ${browserCapabilityHash}::varchar
        )
      `
    )[0];

  return {
    async prepare(input) {
      const expiresAt = new Date(input.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        return { status: "unavailable" };
      }
      const rows =
        input.configurationReleaseId === undefined
          ? await client.$queryRaw<{ readonly prepared: boolean }[]>`
              SELECT prepare_entry_challenge(
                ${input.tenantSlug}::varchar,
                ${input.locationSlug}::varchar,
                ${input.invitationTokenHash ?? null}::varchar,
                ${input.routeHandleHash}::varchar,
                ${input.browserCapabilityHash}::varchar,
                ${input.tableRefHash ?? null}::varchar,
                ${expiresAt}::timestamptz
              ) AS prepared
            `
          : await client.$queryRaw<{ readonly prepared: boolean }[]>`
              SELECT prepare_entry_challenge(
                ${input.tenantSlug}::varchar,
                ${input.locationSlug}::varchar,
                ${input.invitationTokenHash ?? null}::varchar,
                ${input.routeHandleHash}::varchar,
                ${input.browserCapabilityHash}::varchar,
                ${input.tableRefHash ?? null}::varchar,
                ${expiresAt}::timestamptz,
                ${input.configurationReleaseId}::uuid
              ) AS prepared
            `;
      return rows[0]?.prepared === true
        ? { status: "prepared" }
        : { status: "unavailable" };
    },

    async read(input) {
      const scope = await resolveScope(
        input.routeHandleHash,
        input.browserCapabilityHash,
      );
      if (scope === undefined) {
        return { status: "unavailable" };
      }
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${scope.tenant_id}, true)
        `;
        const activeScopes = await transaction.$queryRaw<{ readonly active: boolean }[]>`
          SELECT true AS active
          FROM tenants AS tenant
          JOIN locations AS location
            ON location.tenant_id = tenant.id
          WHERE tenant.id = ${scope.tenant_id}::uuid
            AND tenant.status = 'ACTIVE'
            AND location.id = ${scope.location_id}::uuid
            AND location.status = 'ACTIVE'
        `;
        const snapshot = await loadPublishedSnapshot(
          transaction,
          scope.tenant_id,
          scope.location_id,
          scope.configuration_snapshot_id,
        );
        const rawLocale = snapshot?.settings["locale"];
        const locale =
          typeof rawLocale === "string" && isLocale(rawLocale)
            ? rawLocale
            : undefined;
        const rawEntryMode = snapshot?.settings["entryMode"];
        const entryMode =
          typeof rawEntryMode === "string" && isEntryMode(rawEntryMode)
            ? rawEntryMode
            : undefined;
        const minimumSelections =
          snapshot === undefined
            ? undefined
            : snapshotInteger(snapshot.settings, "minimumFactSelections", 1, 20);
        const maximumAssertionChars =
          snapshot === undefined
            ? undefined
            : snapshotInteger(
                snapshot.settings,
                "maximumCustomerAssertionChars",
                1,
                5_000,
              );
        if (
          activeScopes[0] === undefined ||
          snapshot === undefined ||
          locale === undefined ||
          entryMode === undefined ||
          entryMode !== scope.entry_mode_key ||
          snapshot.settings["maxReviewFormatsPerRequest"] !== 1 ||
          minimumSelections === undefined ||
          maximumAssertionChars === undefined ||
          typeof snapshot.document["tenantName"] !== "string" ||
          snapshot.document["tenantName"].length === 0 ||
          typeof snapshot.document["locationName"] !== "string" ||
          snapshot.document["locationName"].length === 0
        ) {
          return { status: "unavailable" } as const;
        }
        const provisionalAction =
          scope.provisional_action === null
            ? undefined
            : toAction(scope.provisional_action);
        const provisionalRating = scope.provisional_rating;
        const provisionalSelection =
          provisionalRating === null && provisionalAction === undefined
            ? null
            : provisionalRating !== null &&
                isRating(provisionalRating) &&
                provisionalAction !== undefined
              ? {
                  rating: provisionalRating,
                  action: provisionalAction,
                }
              : undefined;
        if (provisionalSelection === undefined) {
          return { status: "unavailable" } as const;
        }
        const factOptions = snapshotFactProjections({
          snapshot,
          tenantId: scope.tenant_id,
          locationId: scope.location_id,
        });
        const reviewFormats = snapshotFormatProjections({ snapshot, locale });
        if (factOptions === undefined || reviewFormats === undefined) {
          return { status: "unavailable" } as const;
        }
        const destinations = await transaction.$queryRaw<DestinationRow[]>`
          SELECT
            destination_type.key AS target_platform,
            COALESCE(
              destination_type.external_id_schema ->> 'displayName',
              destination_type.key
            ) AS display_name,
            destination_binding.target_url
          FROM posting_destination_bindings AS destination_binding
          JOIN posting_destination_types AS destination_type
            ON destination_type.id = destination_binding.destination_type_id
          WHERE destination_binding.tenant_id = ${scope.tenant_id}::uuid
            AND destination_binding.location_id = ${scope.location_id}::uuid
            AND destination_binding.enabled = true
            AND destination_type.status = 'ACTIVE'
          ORDER BY destination_type.key, destination_binding.id
        `;
        return {
          status: "ready" as const,
          stage:
            scope.verification_required && provisionalSelection !== null
              ? scope.verification_failed_at === null
                ? ("verification-required" as const)
                : ("verification-unavailable" as const)
              : ("entry" as const),
          provisionalSelection,
          context: {
            tenantDisplayName: snapshot.document["tenantName"],
            locationDisplayName: snapshot.document["locationName"],
            locale,
            entryMode,
            ratingRequired: true as const,
            requirements: {
              minimumFactSelections: minimumSelections,
              maximumReviewFormatsPerGeneration: 1 as const,
              maximumCustomerAssertionChars: maximumAssertionChars,
            },
            factOptions,
            reviewFormats,
            destinations: destinations.map((destination) => ({
              targetPlatform: destination.target_platform,
              displayName: destination.display_name,
              targetUrl: destination.target_url,
            })),
          },
        };
      });
    },

    async advance(input) {
      const scope = await resolveScope(
        input.routeHandleHash,
        input.browserCapabilityHash,
      );
      const reviewSessionExpiresAt = new Date(input.reviewSessionExpiresAt);
      const browserBindingExpiresAt = new Date(
        input.browserBindingExpiresAt ?? input.reviewSessionExpiresAt,
      );
      if (
        scope === undefined ||
        Number.isNaN(reviewSessionExpiresAt.getTime()) ||
        Number.isNaN(browserBindingExpiresAt.getTime())
      ) {
        return { status: "unavailable" };
      }
      try {
        return await client.$transaction(async (transaction) => {
          await transaction.$executeRaw`
            SELECT set_config('app.tenant_id', ${scope.tenant_id}, true)
          `;
          const snapshot = await loadPublishedSnapshot(
            transaction,
            scope.tenant_id,
            scope.location_id,
            scope.configuration_snapshot_id,
          );
          const action = toAction(input.action);
          const rawLocale = snapshot?.settings["locale"];
          const locale =
            typeof rawLocale === "string" && isLocale(rawLocale)
              ? rawLocale
              : undefined;
          const rawEntryMode = snapshot?.settings["entryMode"];
          const entryMode =
            typeof rawEntryMode === "string" && isEntryMode(rawEntryMode)
              ? rawEntryMode
              : undefined;
          const compatibleFormats =
            snapshot !== undefined &&
            action !== undefined &&
            locale !== undefined
              ? snapshotFormatProjections({
                  snapshot,
                  locale,
                  requiredAction: action,
                })
              : undefined;
          if (
            snapshot === undefined ||
            entryMode === undefined ||
            entryMode !== scope.entry_mode_key ||
            compatibleFormats === undefined ||
            compatibleFormats.length === 0
          ) {
            return { status: "unavailable" } as const;
          }
          if (scope.verification_required) {
            const pending = await transaction.$queryRaw<
              { readonly id: string }[]
            >`
              UPDATE entry_challenges
              SET
                provisional_rating = ${input.rating},
                provisional_action = ${input.action}::generation_action,
                verification_failed_at = NULL
              WHERE id = ${scope.challenge_id}::uuid
                AND tenant_id = ${scope.tenant_id}::uuid
                AND location_id = ${scope.location_id}::uuid
                AND route_handle_hash = ${input.routeHandleHash}
                AND browser_capability_hash = ${input.browserCapabilityHash}
                AND verification_required = true
                AND verification_failure_count < 5
                AND consumed_at IS NULL
                AND expires_at > clock_timestamp()
              RETURNING id
            `;
            return pending[0] === undefined
              ? ({ status: "unavailable" } as const)
              : ({ status: "verification-required" } as const);
          }
          const consumed = await transaction.$queryRaw<{ readonly id: string }[]>`
            UPDATE entry_challenges
            SET consumed_at = clock_timestamp()
            WHERE id = ${scope.challenge_id}::uuid
              AND tenant_id = ${scope.tenant_id}::uuid
              AND location_id = ${scope.location_id}::uuid
              AND route_handle_hash = ${input.routeHandleHash}
              AND browser_capability_hash = ${input.browserCapabilityHash}
              AND consumed_at IS NULL
              AND expires_at > clock_timestamp()
            RETURNING id
          `;
          if (consumed[0] === undefined) {
            return { status: "unavailable" } as const;
          }
          if (scope.invitation_token_id !== null) {
            const consumedTokens = await transaction.$queryRaw<
              { readonly id: string }[]
            >`
              UPDATE invitation_tokens
              SET consumed_at = clock_timestamp()
              WHERE id = ${scope.invitation_token_id}::uuid
                AND tenant_id = ${scope.tenant_id}::uuid
                AND location_id = ${scope.location_id}::uuid
                AND consumed_at IS NULL
                AND expires_at > clock_timestamp()
              RETURNING id
            `;
            if (consumedTokens[0] === undefined) {
              throw new EntryAdmissionUnavailableError();
            }
          }
          const reviewSessionId = randomUUID();
          await transaction.$executeRaw`
            INSERT INTO review_sessions (
              id, tenant_id, location_id, visit_id, invitation_token_id,
              status, rating, selected_action, configuration_snapshot_id,
              expires_at
            ) VALUES (
              ${reviewSessionId}::uuid,
              ${scope.tenant_id}::uuid,
              ${scope.location_id}::uuid,
              ${scope.visit_id}::uuid,
              ${scope.invitation_token_id}::uuid,
              'OPEN',
              ${input.rating},
              ${input.action}::generation_action,
              ${snapshot.id}::uuid,
              ${reviewSessionExpiresAt}::timestamptz
            )
          `;
          await transaction.$executeRaw`
            INSERT INTO review_session_browser_bindings (
              tenant_id, location_id, review_session_id,
              route_handle_hash, browser_capability_hash, expires_at
            ) VALUES (
              ${scope.tenant_id}::uuid,
              ${scope.location_id}::uuid,
              ${reviewSessionId}::uuid,
              ${input.reviewSessionRouteHandleHash},
              ${input.browserCapabilityHash},
              ${browserBindingExpiresAt}::timestamptz
            )
          `;
          return {
            status: "admitted" as const,
            reviewSessionId,
            tenantId: scope.tenant_id,
            locationId: scope.location_id,
          };
        });
      } catch (error) {
        if (error instanceof EntryAdmissionUnavailableError) {
          return { status: "unavailable" };
        }
        throw error;
      }
    },

    async verify(input) {
      const scope = await resolveScope(
        input.routeHandleHash,
        input.browserCapabilityHash,
      );
      const reviewSessionExpiresAt = new Date(input.reviewSessionExpiresAt);
      const browserBindingExpiresAt = new Date(input.browserBindingExpiresAt);
      if (
        scope === undefined ||
        !scope.verification_required ||
        scope.invitation_token_id === null ||
        scope.visit_id === null ||
        !isRating(scope.provisional_rating ?? 0) ||
        scope.provisional_action === null ||
        Number.isNaN(reviewSessionExpiresAt.getTime()) ||
        Number.isNaN(browserBindingExpiresAt.getTime())
      ) {
        return { status: "unavailable" };
      }
      try {
        return await client.$transaction(async (transaction) => {
          await transaction.$executeRaw`
            SELECT set_config('app.tenant_id', ${scope.tenant_id}, true)
          `;
          const snapshot = await loadPublishedSnapshot(
            transaction,
            scope.tenant_id,
            scope.location_id,
            scope.configuration_snapshot_id,
          );
          const action = toAction(scope.provisional_action ?? "");
          const rawLocale = snapshot?.settings["locale"];
          const locale =
            typeof rawLocale === "string" && isLocale(rawLocale)
              ? rawLocale
              : undefined;
          const rawEntryMode = snapshot?.settings["entryMode"];
          const entryMode =
            typeof rawEntryMode === "string" && isEntryMode(rawEntryMode)
              ? rawEntryMode
              : undefined;
          const compatibleSnapshotFormats =
            snapshot !== undefined &&
            action !== undefined &&
            locale !== undefined
              ? snapshotFormatProjections({
                  snapshot,
                  locale,
                  requiredAction: action,
                })
              : undefined;
          if (
            snapshot === undefined ||
            entryMode === undefined ||
            entryMode !== scope.entry_mode_key ||
            compatibleSnapshotFormats === undefined ||
            compatibleSnapshotFormats.length === 0
          ) {
            return { status: "unavailable" } as const;
          }
          const attempts = await transaction.$queryRaw<
            VerificationAttemptRow[]
          >`
            SELECT verification_failure_count
            FROM entry_challenges
            WHERE id = ${scope.challenge_id}::uuid
              AND tenant_id = ${scope.tenant_id}::uuid
              AND location_id = ${scope.location_id}::uuid
              AND route_handle_hash = ${input.routeHandleHash}
              AND browser_capability_hash = ${input.browserCapabilityHash}
              AND verification_required = true
              AND provisional_rating IS NOT NULL
              AND provisional_action IS NOT NULL
              AND consumed_at IS NULL
              AND expires_at > clock_timestamp()
            FOR UPDATE
          `;
          const attempt = attempts[0];
          if (attempt === undefined) {
            return { status: "unavailable" } as const;
          }
          if (attempt.verification_failure_count >= 5) {
            return { status: "verification-unavailable" } as const;
          }
          const evidence = await transaction.$queryRaw<VerificationEvidenceRow[]>`
            SELECT verification_evidence_hash
            FROM visits
            WHERE id = ${scope.visit_id}::uuid
              AND tenant_id = ${scope.tenant_id}::uuid
              AND location_id = ${scope.location_id}::uuid
              AND verification_evidence_hash IS NOT NULL
            LIMIT 1
          `;
          if (
            evidence[0]?.verification_evidence_hash !==
            input.verificationEvidenceHash
          ) {
            const failed = await transaction.$queryRaw<{ readonly id: string }[]>`
              UPDATE entry_challenges
              SET
                verification_failed_at = clock_timestamp(),
                verification_failure_count = verification_failure_count + 1
              WHERE id = ${scope.challenge_id}::uuid
                AND tenant_id = ${scope.tenant_id}::uuid
                AND location_id = ${scope.location_id}::uuid
                AND route_handle_hash = ${input.routeHandleHash}
                AND browser_capability_hash = ${input.browserCapabilityHash}
                AND verification_required = true
                AND provisional_rating IS NOT NULL
                AND provisional_action IS NOT NULL
                AND verification_failure_count < 5
                AND consumed_at IS NULL
                AND expires_at > clock_timestamp()
              RETURNING id
            `;
            return failed[0] === undefined
              ? ({ status: "unavailable" } as const)
              : ({ status: "verification-unavailable" } as const);
          }

          const consumed = await transaction.$queryRaw<{ readonly id: string }[]>`
            UPDATE entry_challenges
            SET consumed_at = clock_timestamp()
            WHERE id = ${scope.challenge_id}::uuid
              AND tenant_id = ${scope.tenant_id}::uuid
              AND location_id = ${scope.location_id}::uuid
              AND route_handle_hash = ${input.routeHandleHash}
              AND browser_capability_hash = ${input.browserCapabilityHash}
              AND verification_required = true
              AND provisional_rating IS NOT NULL
              AND provisional_action IS NOT NULL
              AND verification_failure_count < 5
              AND consumed_at IS NULL
              AND expires_at > clock_timestamp()
            RETURNING id
          `;
          if (consumed[0] === undefined) {
            return { status: "unavailable" } as const;
          }
          const consumedTokens = await transaction.$queryRaw<
            { readonly id: string }[]
          >`
            UPDATE invitation_tokens
            SET consumed_at = clock_timestamp()
            WHERE id = ${scope.invitation_token_id}::uuid
              AND tenant_id = ${scope.tenant_id}::uuid
              AND location_id = ${scope.location_id}::uuid
              AND consumed_at IS NULL
              AND expires_at > clock_timestamp()
            RETURNING id
          `;
          if (consumedTokens[0] === undefined) {
            throw new EntryAdmissionUnavailableError();
          }
          const reviewSessionId = randomUUID();
          await transaction.$executeRaw`
            INSERT INTO review_sessions (
              id, tenant_id, location_id, visit_id, invitation_token_id,
              status, rating, selected_action, configuration_snapshot_id,
              expires_at
            ) VALUES (
              ${reviewSessionId}::uuid,
              ${scope.tenant_id}::uuid,
              ${scope.location_id}::uuid,
              ${scope.visit_id}::uuid,
              ${scope.invitation_token_id}::uuid,
              'OPEN',
              ${scope.provisional_rating},
              ${scope.provisional_action}::generation_action,
              ${snapshot.id}::uuid,
              ${reviewSessionExpiresAt}::timestamptz
            )
          `;
          await transaction.$executeRaw`
            INSERT INTO review_session_browser_bindings (
              tenant_id, location_id, review_session_id,
              route_handle_hash, browser_capability_hash, expires_at
            ) VALUES (
              ${scope.tenant_id}::uuid,
              ${scope.location_id}::uuid,
              ${reviewSessionId}::uuid,
              ${input.reviewSessionRouteHandleHash},
              ${input.browserCapabilityHash},
              ${browserBindingExpiresAt}::timestamptz
            )
          `;
          return {
            status: "admitted" as const,
            reviewSessionId,
            tenantId: scope.tenant_id,
            locationId: scope.location_id,
          };
        });
      } catch (error) {
        if (error instanceof EntryAdmissionUnavailableError) {
          return { status: "unavailable" };
        }
        throw error;
      }
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}

const sha256 = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

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

const asRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored Effective Configuration Snapshot is invalid");
  }
  return value as Readonly<Record<string, unknown>>;
};

const requireString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string => {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Stored configuration field ${key} is invalid`);
  }
  return value;
};

const admissionPolarity = (
  value: string,
): "positive" | "neutral" | "negative" => {
  if (value === "positive" || value === "neutral" || value === "negative") {
    return value;
  }
  const polarity = toPolarity(value);
  if (polarity === undefined) {
    throw new Error("Stored Fact Option polarity is invalid");
  }
  return polarity;
};

const GENERATION_INPUT_TOKEN_LIMIT = 1_500;
const GENERATION_OUTPUT_TOKEN_LIMIT = 350;
const GENERATION_PROTOCOL_TOKEN_OVERHEAD = 256;
const MICROS_PER_TOKEN_RATE_UNIT = 1_000_000n;

const rejectReviewerGeneration = (
  code: ReviewerGenerationRejectionCode,
  retryable = false,
  retryAfterSeconds?: number,
): ReviewerGenerationAdmissionResult => ({
  status: "rejected",
  code,
  retryable,
  ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
});

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );

const actionForCommand = (
  command: ReviewerGenerationAdmissionCommand,
): {
  readonly workload: ReviewerGenerationAdmissionCommand["kind"];
  readonly database:
    | "GENERATE"
    | "PARAPHRASE"
    | "REGENERATE"
    | "REFORMAT"
    | "CONDENSE"
    | "EXPAND"
    | "REVISE_WORDING";
} => {
  switch (command.kind) {
    case "generate":
      return { workload: command.kind, database: "GENERATE" };
    case "paraphrase":
      return { workload: command.kind, database: "PARAPHRASE" };
    case "resample":
      return { workload: command.kind, database: "REGENERATE" };
    case "reformat":
      return { workload: command.kind, database: "REFORMAT" };
    case "condense":
      return { workload: command.kind, database: "CONDENSE" };
    case "expand":
      return { workload: command.kind, database: "EXPAND" };
    case "revise-wording":
      return { workload: command.kind, database: "REVISE_WORDING" };
  }
};

const isImplementedAdmissionCommand = (
  command: ReviewerGenerationAdmissionCommand,
): command is Extract<
  ReviewerGenerationAdmissionCommand,
  { readonly kind: "generate" | "paraphrase" }
> => isExecutableGenerationAction(command.kind);

const normalizedAdmissionCommand = (
  command: ReviewerGenerationAdmissionCommand,
): Readonly<Record<string, unknown>> | undefined => {
  switch (command.kind) {
    case "generate": {
      const customerAssertion = command.customerAssertion?.trim();
      const factOptionIds = [...new Set(command.factOptionIds)];
      if (
        !isUuid(command.reviewFormatVersionId) ||
        factOptionIds.length !== command.factOptionIds.length ||
        factOptionIds.some((id) => !isUuid(id)) ||
        (factOptionIds.length === 0 && customerAssertion === undefined) ||
        (command.customerAssertion !== undefined &&
          (customerAssertion === undefined ||
            customerAssertion.length === 0 ||
            customerAssertion.length > 5_000))
      ) {
        return undefined;
      }
      return {
        kind: command.kind,
        factOptionIds,
        reviewFormatVersionId: command.reviewFormatVersionId,
        ...(customerAssertion === undefined ? {} : { customerAssertion }),
      };
    }
    case "paraphrase": {
      const sourceText = command.sourceText.trim();
      if (
        !isUuid(command.reviewFormatVersionId) ||
        sourceText.length < 20 ||
        sourceText.length > 10_000
      ) {
        return undefined;
      }
      return {
        kind: command.kind,
        sourceText,
        reviewFormatVersionId: command.reviewFormatVersionId,
      };
    }
    case "resample":
      return isUuid(command.sourceGenerationId)
        ? { kind: command.kind, sourceGenerationId: command.sourceGenerationId }
        : undefined;
    case "reformat":
      return isUuid(command.sourceGenerationId) &&
        isUuid(command.reviewFormatVersionId)
        ? {
            kind: command.kind,
            sourceGenerationId: command.sourceGenerationId,
            reviewFormatVersionId: command.reviewFormatVersionId,
          }
        : undefined;
    case "condense":
      return isUuid(command.sourceGenerationId) &&
        Number.isSafeInteger(command.targetMaxChars) &&
        command.targetMaxChars > 0 &&
        command.targetMaxChars <= 10_000
        ? {
            kind: command.kind,
            sourceGenerationId: command.sourceGenerationId,
            targetMaxChars: command.targetMaxChars,
          }
        : undefined;
    case "expand":
      return isUuid(command.sourceGenerationId) &&
        Number.isSafeInteger(command.targetMinChars) &&
        command.targetMinChars > 0 &&
        command.targetMinChars <= 10_000
        ? {
            kind: command.kind,
            sourceGenerationId: command.sourceGenerationId,
            targetMinChars: command.targetMinChars,
          }
        : undefined;
    case "revise-wording": {
      const instruction = command.presentationInstruction.trim();
      return isUuid(command.sourceGenerationId) &&
        instruction.length > 0 &&
        instruction.length <= 500
        ? {
            kind: command.kind,
            sourceGenerationId: command.sourceGenerationId,
            presentationInstruction: instruction,
          }
        : undefined;
    }
  }
};

const exactSnapshotPriceRate = (
  snapshot: Readonly<Record<string, unknown>>,
  providerModelId: string,
  provider: string,
  model: string,
): Readonly<Record<string, unknown>> | undefined => {
  const priceRates = snapshot["priceRates"];
  if (!Array.isArray(priceRates)) {
    return undefined;
  }
  const matches = priceRates
    .map((rate) => {
      try {
        return asRecord(rate);
      } catch {
        return undefined;
      }
    })
    .filter(
      (rate): rate is Readonly<Record<string, unknown>> =>
        rate !== undefined &&
        rate["providerModelId"] === providerModelId &&
        rate["provider"] === provider &&
        rate["model"] === model,
    );
  return matches.length === 1 ? matches[0] : undefined;
};

const exactSnapshotFacts = (input: {
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly factOptionIds: readonly string[];
  readonly tenantId: string;
  readonly locationId: string;
}): readonly AdmissionFactRow[] | undefined => {
  const rawFacts = input.snapshot["factOptions"];
  if (!Array.isArray(rawFacts)) {
    return undefined;
  }
  const byId = new Map<string, AdmissionFactRow>();
  try {
    for (const rawFact of rawFacts) {
      const fact = asRecord(rawFact);
      const id = requireString(fact, "id");
      const version = requireString(fact, "version");
      const proposition = requireString(fact, "proposition");
      const polarity = requireString(fact, "polarity");
      const owner = asRecord(fact["owner"]);
      const ownerMatches =
        owner["tenantId"] === input.tenantId &&
        (owner["scope"] === "tenant" ||
          (owner["scope"] === "location" &&
            owner["locationId"] === input.locationId));
      if (
        !isUuid(id) ||
        fact["active"] !== true ||
        !ownerMatches ||
        byId.has(id)
      ) {
        return undefined;
      }
      admissionPolarity(polarity);
      byId.set(id, { id, version, proposition, polarity });
    }
  } catch {
    return undefined;
  }
  const selected = input.factOptionIds.map((id) => byId.get(id));
  return selected.some((fact) => fact === undefined)
    ? undefined
    : (selected as readonly AdmissionFactRow[]);
};

const nonnegativeSafeInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

const worstCaseReservationMicros = (
  inputPerMillionMicros: bigint,
  outputPerMillionMicros: bigint,
): bigint => {
  const rounded = (tokens: number, rate: bigint): bigint =>
    (BigInt(tokens) * rate + MICROS_PER_TOKEN_RATE_UNIT - 1n) /
    MICROS_PER_TOKEN_RATE_UNIT;
  return (
    rounded(GENERATION_INPUT_TOKEN_LIMIT, inputPerMillionMicros) +
    rounded(GENERATION_OUTPUT_TOKEN_LIMIT, outputPerMillionMicros)
  );
};

const promptInputByteUpperBound = (input: {
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly reviewFormatVersionId: string;
  readonly action: "generate" | "paraphrase";
  readonly assertions: readonly { readonly id: string; readonly proposition: string }[];
}): number | undefined => {
  try {
    const settings = asRecord(input.snapshot["settings"]);
    const locale = settings["locale"];
    const toneGuidelines = settings["toneGuidelines"];
    const bannedTerms = settings["bannedTerms"];
    if (
      (locale !== "en-GB" && locale !== "de-DE") ||
      typeof toneGuidelines !== "string" ||
      !Array.isArray(bannedTerms) ||
      bannedTerms.some((term) => typeof term !== "string")
    ) {
      return undefined;
    }
    const rawFormats = input.snapshot["reviewFormats"];
    const rawPrompts = input.snapshot["promptVersions"];
    if (!Array.isArray(rawFormats) || !Array.isArray(rawPrompts)) {
      return undefined;
    }
    const formats = rawFormats as readonly ReviewFormatVersion[];
    const prompts = rawPrompts as readonly PromptVersion[];
    const format = formats.find(
      (candidate) => candidate.id === input.reviewFormatVersionId,
    );
    const matchingPrompts = prompts.filter(
      (candidate) => candidate.commandKind === input.action,
    );
    if (
      format === undefined ||
      !format.supportedCommands.includes(input.action) ||
      matchingPrompts.length !== 1
    ) {
      return undefined;
    }
    const style: ReviewFormatManifest = {
      key: format.key,
      version: format.version,
      displayName: format.displayName,
      targetPlatform: format.targetPlatform,
      locale: format.locale,
      description: format.description,
      sample: format.sample,
      constraints: format.constraints,
      supportedCommands: format.supportedCommands,
      promptFragments: {
        styleGuide: `Structure: ${format.displayName}`,
        fewShot: [],
      },
    };
    const composed = composePrompt({
      snapshot: {
        settings: {
          locale,
          toneGuidelines,
          bannedTerms: bannedTerms as readonly string[],
        },
      },
      style,
      promptVersion: matchingPrompts[0]!,
      action: input.action,
      assertions: input.assertions,
    });
    // Content tokens cannot exceed encoded bytes for the byte-capable routed
    // tokenizers. Include the output schema and a server-owned allowance for
    // provider message framing/special tokens rather than trusting the browser.
    return (
      new TextEncoder().encode(
        [
          composed.system,
          ...composed.messages.map((message) => message.content),
          JSON.stringify(composed.outputSchema),
        ].join("\n"),
      ).length + GENERATION_PROTOCOL_TOKEN_OVERHEAD
    );
  } catch {
    return undefined;
  }
};

export function createPostgresReviewerGenerationAdmissionStore({
  databaseUrl,
  providerMode,
}: {
  readonly databaseUrl: string;
  readonly providerMode: "fake-only" | "paid-enabled";
}): PostgresReviewerGenerationAdmissionStore {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Admission database URL is required");
  }
  if (providerMode !== "fake-only" && providerMode !== "paid-enabled") {
    throw new Error("Admission provider mode is required");
  }
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  return {
    async prepare(input) {
      const normalizedCommand = normalizedAdmissionCommand(input.command);
      if (
        input.idempotencyKey.length === 0 ||
        input.idempotencyKey.length > 128
      ) {
        return rejectReviewerGeneration("GENERATION_FAILED");
      }
      if (normalizedCommand === undefined) {
        return rejectReviewerGeneration(
          input.command.kind === "generate" || input.command.kind === "paraphrase"
            ? "GROUNDING_REJECTED"
            : "GENERATION_FAILED",
        );
      }
      // Capability retirement is fail-closed even for an idempotent retry of
      // a reservation created by an older deployment. A stored workload must
      // never revive an Action that the production evidence boundary no longer
      // supports.
      if (!isImplementedAdmissionCommand(input.command)) {
        return rejectReviewerGeneration("GENERATION_FAILED");
      }
      const implementedAction = input.command.kind;
      const bindings = await client.$queryRaw<BindingRow[]>`
        SELECT tenant_id, location_id, review_session_id
        FROM touch_live_review_session_browser_binding(
          ${input.routeHandleHash}, ${input.browserCapabilityHash}
        )
      `;
      const binding = bindings[0];
      if (binding === undefined) {
        return rejectReviewerGeneration("GENERATION_FAILED");
      }

      try {
        return await client.$transaction(async (transaction) => {
          await transaction.$executeRaw`
            SELECT set_config('app.tenant_id', ${binding.tenant_id}, true)
          `;
          const sessions = await transaction.$queryRaw<AdmissionSessionRow[]>`
            SELECT
              session.rating,
              session.selected_action::text,
              session.configuration_snapshot_id
            FROM tenants AS tenant
            JOIN locations AS location
              ON location.tenant_id = tenant.id
            JOIN review_sessions AS session
              ON session.tenant_id = tenant.id
             AND session.location_id = location.id
            WHERE tenant.id = ${binding.tenant_id}::uuid
              AND tenant.status = 'ACTIVE'
              AND location.id = ${binding.location_id}::uuid
              AND location.status = 'ACTIVE'
              AND session.id = ${binding.review_session_id}::uuid
              AND session.status = 'OPEN'
              AND session.expires_at > clock_timestamp()
            FOR UPDATE OF session
          `;
          const session = sessions[0];
          const action = actionForCommand(input.command);
          if (session === undefined || !isRating(session.rating)) {
            return rejectReviewerGeneration("GENERATION_FAILED");
          }

          const normalizedRequest = {
            command: normalizedCommand,
            rating: session.rating,
          };
          const requestHash = sha256(stableJson(normalizedRequest));

          // Replay is deliberately checked before every counter and budget gate.
          const existing = await transaction.$queryRaw<ExistingAdmissionRow[]>`
            SELECT
              batch.request_hash,
              reservation.permit_jti,
              reservation.expires_at,
              batch.normalized_input
            FROM generation_batches AS batch
            JOIN budget_reservations AS reservation
              ON reservation.id = batch.budget_reservation_id
             AND reservation.tenant_id = batch.tenant_id
             AND reservation.location_id = batch.location_id
             AND reservation.review_session_id = batch.review_session_id
            WHERE batch.tenant_id = ${binding.tenant_id}::uuid
              AND batch.review_session_id = ${binding.review_session_id}::uuid
              AND batch.idempotency_key = ${input.idempotencyKey}
            LIMIT 1
          `;
          if (existing[0] !== undefined) {
            const row = existing[0];
            const stored = asRecord(row.normalized_input);
            const storedWorkload = asRecord(stored["workload"]);
            if (providerMode === "fake-only") {
              const storedSnapshot = asRecord(storedWorkload["snapshot"]);
              const storedRouting = asRecord(storedSnapshot["providerRouting"]);
              if (storedRouting["primaryProvider"] !== "fake") {
                return rejectReviewerGeneration("PROVIDER_UNAVAILABLE");
              }
            }
            if (
              row.request_hash !== requestHash ||
              row.expires_at.getTime() <= Date.now()
            ) {
              return rejectReviewerGeneration("GENERATION_FAILED");
            }
            return {
              status: "prepared" as const,
              permitJti: row.permit_jti,
              permitExpiresAt: row.expires_at.toISOString(),
              workload: storedWorkload,
            };
          }

          if (
            isImplementedAdmissionCommand(input.command) &&
            session.selected_action !== action.database
          ) {
            return rejectReviewerGeneration("GENERATION_FAILED");
          }

          const publishedSnapshot = await loadPublishedSnapshot(
            transaction,
            binding.tenant_id,
            binding.location_id,
            session.configuration_snapshot_id,
          );
          if (publishedSnapshot === undefined) {
            return rejectReviewerGeneration("PROVIDER_UNAVAILABLE");
          }
          const snapshotRow = {
            id: publishedSnapshot.id,
            content_hash: publishedSnapshot.contentHash,
          };
          const snapshot = publishedSnapshot.document;
          const settings = publishedSnapshot.settings;

          const customerAssertion =
            input.command.kind === "generate"
              ? (normalizedCommand["customerAssertion"] as string | undefined)
              : undefined;
          const sourceText =
            input.command.kind === "paraphrase"
              ? (normalizedCommand["sourceText"] as string)
              : undefined;
          const factOptionIds =
            input.command.kind === "generate"
              ? (normalizedCommand["factOptionIds"] as readonly string[])
              : [];
          const reviewFormatVersionId = normalizedCommand[
            "reviewFormatVersionId"
          ] as string;
          if (
            input.command.kind === "generate" &&
            ((customerAssertion === undefined &&
              factOptionIds.length <
                minimumFactSelections(settings)) ||
              (customerAssertion !== undefined &&
                customerAssertion.length >
                  maximumCustomerAssertionChars(settings)))
          ) {
            return rejectReviewerGeneration("GROUNDING_REJECTED");
          }

          const facts = exactSnapshotFacts({
            snapshot,
            factOptionIds,
            tenantId: binding.tenant_id,
            locationId: binding.location_id,
          });
          if (facts === undefined) {
            return rejectReviewerGeneration("GROUNDING_REJECTED");
          }
          const enabledCommands = settings["enabledCommands"];
          const enabledFormats = settings["enabledReviewFormatVersionIds"];
          if (
            !Array.isArray(enabledCommands) ||
            !enabledCommands.includes(action.workload) ||
            !Array.isArray(enabledFormats) ||
            !enabledFormats.includes(reviewFormatVersionId) ||
            settings["maxReviewFormatsPerRequest"] !== 1
          ) {
            return rejectReviewerGeneration("FORMAT_REJECTED");
          }

          const routing = asRecord(snapshot["providerRouting"]);
          const provider = requireString(routing, "primaryProvider");
          const model = requireString(routing, "primaryModel");
          const providerModelId = requireString(routing, "providerModelId");
          if (
            (providerMode === "fake-only" && provider !== "fake") ||
            !isUuid(providerModelId) ||
            (provider !== "fake" && provider !== "openai" && provider !== "gemini") ||
            (provider === "fake" && model !== "fake-v1")
          ) {
            return rejectReviewerGeneration("PROVIDER_UNAVAILABLE");
          }
          const snapshotPriceRate = exactSnapshotPriceRate(
            snapshot,
            providerModelId,
            provider,
            model,
          );
          if (snapshotPriceRate === undefined) {
            return rejectReviewerGeneration("PROVIDER_UNAVAILABLE");
          }
          const priceRateId = snapshotPriceRate["id"];
          const snapshotInputRate = nonnegativeSafeInteger(
            snapshotPriceRate["inputPerMillionMicros"],
          );
          const snapshotOutputRate = nonnegativeSafeInteger(
            snapshotPriceRate["outputPerMillionMicros"],
          );
          if (
            typeof priceRateId !== "string" ||
            !isUuid(priceRateId) ||
            snapshotInputRate === undefined ||
            snapshotOutputRate === undefined ||
            snapshotPriceRate["currency"] !== "EUR" ||
            snapshotPriceRate["unit"] !== "token"
          ) {
            return rejectReviewerGeneration("PROVIDER_UNAVAILABLE");
          }
          const priceRows = await transaction.$queryRaw<AdmissionPriceRateRow[]>`
            SELECT
              rate.id AS price_rate_id,
              model_row.id AS provider_model_id,
              provider_row.key AS provider_key,
              model_row.model_key,
              length(trim(provider_row.credential_reference)) > 0
                AS credential_available,
              rate.input_per_million_micros,
              rate.output_per_million_micros,
              rate.currency,
              rate.effective_from,
              rate.effective_to
            FROM price_rates AS rate
            JOIN provider_models AS model_row
              ON model_row.id = rate.provider_model_id
            JOIN providers AS provider_row
              ON provider_row.id = model_row.provider_id
            WHERE rate.id = ${priceRateId}::uuid
              AND model_row.id = ${providerModelId}::uuid
              AND provider_row.key = ${provider}
              AND model_row.model_key = ${model}
              AND provider_row.status = 'ACTIVE'
              AND model_row.status = 'ACTIVE'
            LIMIT 1
          `;
          const priceRow = priceRows[0];
          if (
            priceRow === undefined ||
            priceRow.input_per_million_micros !== BigInt(snapshotInputRate) ||
            priceRow.output_per_million_micros !== BigInt(snapshotOutputRate) ||
            priceRow.currency !== snapshotPriceRate["currency"]
          ) {
            return rejectReviewerGeneration("PROVIDER_UNAVAILABLE");
          }
          const funded = provider !== "fake";
          if (
            (!funded &&
              (priceRow.input_per_million_micros !== 0n ||
                priceRow.output_per_million_micros !== 0n)) ||
            (funded &&
              (!priceRow.credential_available ||
                (priceRow.input_per_million_micros === 0n &&
                  priceRow.output_per_million_micros === 0n)))
          ) {
            return rejectReviewerGeneration("PROVIDER_UNAVAILABLE");
          }

          const factAssertions = facts.map((fact) => ({
            id: randomUUID(),
            version: fact.version,
            reviewSessionId: binding.review_session_id,
            semanticId: fact.id,
            proposition: fact.proposition,
            semanticKind: "experience-fact" as const,
            polarity: admissionPolarity(fact.polarity),
            source: {
              kind: "fact-option" as const,
              factOptionId: fact.id,
              factOptionVersion: fact.version,
            },
          }));
          const reviewerText = customerAssertion ?? sourceText;
          const sourceTextRevisionId =
            reviewerText === undefined ? undefined : randomUUID();
          const reviewerAssertionId =
            reviewerText === undefined ? undefined : randomUUID();
          const reviewerAssertions =
            reviewerText === undefined ||
            sourceTextRevisionId === undefined ||
            reviewerAssertionId === undefined
              ? []
              : [
                  {
                    id: reviewerAssertionId,
                    version: `${reviewerAssertionId}@1`,
                    reviewSessionId: binding.review_session_id,
                    semanticId: sourceTextRevisionId,
                    proposition: reviewerText,
                    semanticKind: "experience-fact" as const,
                    polarity: "neutral" as const,
                    source: {
                      kind: "reviewer-text" as const,
                      sourceRevisionId: sourceTextRevisionId,
                      start: 0,
                      end: reviewerText.length,
                      quotedText: reviewerText,
                    },
                  },
                ];
          const assertions = [...factAssertions, ...reviewerAssertions];
          if (assertions.length === 0) {
            return rejectReviewerGeneration("GROUNDING_REJECTED");
          }
          const inputByteUpperBound = promptInputByteUpperBound({
            snapshot,
            reviewFormatVersionId,
            action: implementedAction,
            assertions,
          });
          if (inputByteUpperBound === undefined) {
            return rejectReviewerGeneration("FORMAT_REJECTED");
          }
          if (inputByteUpperBound > GENERATION_INPUT_TOKEN_LIMIT) {
            return rejectReviewerGeneration("POLICY_REJECTED");
          }

          const limits = (
            await transaction.$queryRaw<AdmissionLimitRow[]>`
              SELECT
                (
                  SELECT count(*)
                  FROM generation_batches
                  WHERE tenant_id = ${binding.tenant_id}::uuid
                    AND review_session_id = ${binding.review_session_id}::uuid
                    AND created_at > clock_timestamp() - interval '30 minutes'
                ) AS session_recent,
                (
                  SELECT count(*)
                  FROM generation_batches
                  WHERE tenant_id = ${binding.tenant_id}::uuid
                    AND created_at > clock_timestamp() - interval '1 hour'
                ) AS tenant_recent,
                (
                  SELECT count(*)
                  FROM budget_reservations
                  WHERE tenant_id = ${binding.tenant_id}::uuid
                    AND review_session_id = ${binding.review_session_id}::uuid
                    AND status IN ('RESERVED', 'REDEEMED')
                ) AS session_active,
                (
                  SELECT count(*)
                  FROM budget_reservations
                  WHERE tenant_id = ${binding.tenant_id}::uuid
                    AND status IN ('RESERVED', 'REDEEMED')
                ) AS tenant_active
            `
          )[0];
          if (limits === undefined) {
            return rejectReviewerGeneration("RATE_LIMITED", true);
          }
          if (limits.session_active >= 1n || limits.tenant_active >= 1n) {
            return rejectReviewerGeneration("RATE_LIMITED", true, 60);
          }
          if (limits.tenant_recent >= 10n) {
            return rejectReviewerGeneration("RATE_LIMITED", true, 3_600);
          }
          if (limits.session_recent >= 3n) {
            return rejectReviewerGeneration("RATE_LIMITED", true, 1_800);
          }

          const reservedMicros = funded
            ? worstCaseReservationMicros(
                priceRow.input_per_million_micros,
                priceRow.output_per_million_micros,
              )
            : 0n;
          if (funded) {
            const snapshotBudget = nonnegativeSafeInteger(
              settings["monthlyBudgetMicros"],
            );
            if (
              snapshotBudget === undefined ||
              snapshotBudget <= 0
            ) {
              return rejectReviewerGeneration("BUDGET_EXCEEDED");
            }
            const spend = (
              await transaction.$queryRaw<AdmissionSpendRow[]>`
                SELECT
                  COALESCE(sum(actual_cost_micros) FILTER (
                    WHERE status = 'SETTLED'
                      AND settled_at >= date_trunc('month', clock_timestamp())
                  ), 0)::bigint AS settled_micros,
                  COALESCE(sum(reserved_micros) FILTER (
                    WHERE status IN ('RESERVED', 'REDEEMED')
                  ), 0)::bigint AS live_micros
                FROM budget_reservations
                WHERE tenant_id = ${binding.tenant_id}::uuid
              `
            )[0];
            if (
              spend === undefined ||
              spend.settled_micros + spend.live_micros + reservedMicros >
                BigInt(snapshotBudget)
            ) {
              return rejectReviewerGeneration("BUDGET_EXCEEDED");
            }
          }

          const assertionSetHash = sha256(stableJson(assertions));
          const generationBatchId = randomUUID();
          const generationId = randomUUID();
          const reservationId = randomUUID();
          const permitJti = randomUUID();
          const permitExpiresAt = new Date(Date.now() + 60_000);
          const workload = {
            bindings: {
              tenantId: binding.tenant_id,
              locationId: binding.location_id,
              reviewSessionId: binding.review_session_id,
              generationBatchId,
              generationId,
              action: action.workload,
              reviewFormatVersionId,
              assertionSetHash,
              requestHash,
              snapshotId: snapshotRow.id,
              snapshotHash: snapshotRow.content_hash,
              providerModelId,
              priceRateId,
              idempotencyKey: input.idempotencyKey,
            },
            snapshot,
            command:
              input.command.kind === "generate"
                ? {
                    kind: "generate" as const,
                    assertionIds: assertions.map((assertion) => assertion.id),
                    rating: session.rating,
                  }
                : {
                    kind: "paraphrase" as const,
                    sourceTextRevisionId: sourceTextRevisionId!,
                  },
            assertions,
          };

          if (reviewerText !== undefined && sourceTextRevisionId !== undefined) {
            await transaction.$executeRaw`
              INSERT INTO source_text_revisions (
                id, tenant_id, location_id, review_session_id,
                revision, body, content_hash, created_at
              )
              SELECT
                ${sourceTextRevisionId}::uuid,
                ${binding.tenant_id}::uuid,
                ${binding.location_id}::uuid,
                ${binding.review_session_id}::uuid,
                COALESCE(MAX(revision), 0) + 1,
                ${reviewerText},
                ${sha256(reviewerText)},
                clock_timestamp()
              FROM source_text_revisions
              WHERE tenant_id = ${binding.tenant_id}::uuid
                AND review_session_id = ${binding.review_session_id}::uuid
            `;
          }
          for (const [index, assertion] of factAssertions.entries()) {
            await transaction.$executeRaw`
              INSERT INTO assertions (
                id, tenant_id, location_id, review_session_id, source,
                proposition, fact_option_version_id, confirmed_at
              ) VALUES (
                ${assertion.id}::uuid,
                ${binding.tenant_id}::uuid,
                ${binding.location_id}::uuid,
                ${binding.review_session_id}::uuid,
                'FACT_OPTION',
                ${assertion.proposition},
                ${facts[index]!.id}::uuid,
                clock_timestamp()
              )
            `;
          }
          if (
            reviewerText !== undefined &&
            sourceTextRevisionId !== undefined &&
            reviewerAssertionId !== undefined
          ) {
            await transaction.$executeRaw`
              INSERT INTO assertions (
                id, tenant_id, location_id, review_session_id, source,
                proposition, source_text_revision_id,
                source_span_start, source_span_end, confirmed_at
              ) VALUES (
                ${reviewerAssertionId}::uuid,
                ${binding.tenant_id}::uuid,
                ${binding.location_id}::uuid,
                ${binding.review_session_id}::uuid,
                'SOURCE_TEXT',
                ${reviewerText},
                ${sourceTextRevisionId}::uuid,
                0,
                ${reviewerText.length},
                clock_timestamp()
              )
            `;
          }
          await transaction.$executeRaw`
            INSERT INTO budget_reservations (
              id, tenant_id, location_id, review_session_id, snapshot_id,
              permit_jti, request_hash, action, reserved_micros, status, expires_at
            ) VALUES (
              ${reservationId}::uuid,
              ${binding.tenant_id}::uuid,
              ${binding.location_id}::uuid,
              ${binding.review_session_id}::uuid,
              ${snapshotRow.id}::uuid,
              ${permitJti},
              ${requestHash},
              ${action.database}::generation_action,
              ${reservedMicros},
              'RESERVED',
              ${permitExpiresAt}
            )
          `;
          await transaction.$executeRaw`
            SELECT claim_platform_generation_capacity(
              ${reservationId}::uuid, ${funded}
            )
          `;
          await transaction.$executeRaw`
            INSERT INTO generation_batches (
              id, tenant_id, location_id, review_session_id, snapshot_id,
              budget_reservation_id, idempotency_key, request_hash, action,
              normalized_input
            ) VALUES (
              ${generationBatchId}::uuid,
              ${binding.tenant_id}::uuid,
              ${binding.location_id}::uuid,
              ${binding.review_session_id}::uuid,
              ${snapshotRow.id}::uuid,
              ${reservationId}::uuid,
              ${input.idempotencyKey},
              ${requestHash},
              ${action.database}::generation_action,
              ${JSON.stringify({ workload })}::jsonb
            )
          `;
          const queueRows = await transaction.$queryRaw<
            { readonly enqueued: boolean }[]
          >`
            SELECT enqueue_reconciliation_queue_item(
              ${reservationId}::uuid,
              ${binding.tenant_id}::uuid,
              ${permitExpiresAt}::timestamptz + interval '30 seconds'
            ) AS enqueued
          `;
          if (queueRows[0]?.enqueued !== true) {
            throw new Error("GENERATION_RECONCILIATION_ENQUEUE_FAILED");
          }
          for (const assertion of assertions) {
            await transaction.$executeRaw`
              INSERT INTO generation_batch_assertions (
                tenant_id, location_id, review_session_id,
                generation_batch_id, assertion_id
              ) VALUES (
                ${binding.tenant_id}::uuid,
                ${binding.location_id}::uuid,
                ${binding.review_session_id}::uuid,
                ${generationBatchId}::uuid,
                ${assertion.id}::uuid
              )
            `;
          }
          return {
            status: "prepared" as const,
            permitJti,
            permitExpiresAt: permitExpiresAt.toISOString(),
            workload,
          };
        });
      } catch (error) {
        const message = String(error);
        if (
          message.includes("GENERATION_PLATFORM_ACTIVE_LIMIT") ||
          message.includes("GENERATION_PLATFORM_MINUTE_LIMIT")
        ) {
          return rejectReviewerGeneration("RATE_LIMITED", true, 60);
        }
        if (message.includes("GENERATION_PLATFORM_FUNDED_DAILY_LIMIT")) {
          return rejectReviewerGeneration("RATE_LIMITED", true, 86_400);
        }
        if (
          message.includes("Stored Effective Configuration Snapshot") ||
          message.includes("Stored configuration field")
        ) {
          return rejectReviewerGeneration("PROVIDER_UNAVAILABLE");
        }
        if (message.includes("GENERATION_PLATFORM_RESERVATION_SCOPE_INVALID")) {
          return rejectReviewerGeneration("GENERATION_FAILED");
        }
        throw error;
      }
    },

    async activate(input) {
      const leaseExpiresAt = new Date(input.leaseExpiresAt);
      if (Number.isNaN(leaseExpiresAt.getTime())) {
        return { status: "rejected" };
      }
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const activated = await transaction.$queryRaw<ActivationRow[]>`
          UPDATE budget_reservations AS reservation
          SET
            status = 'REDEEMED',
            redeemed_at = clock_timestamp(),
            execution_lease_id = ${input.leaseId}::uuid,
            activation_expires_at = LEAST(
              ${leaseExpiresAt}::timestamptz,
              clock_timestamp() + interval '30 seconds'
            )
          WHERE reservation.tenant_id = ${input.tenantId}::uuid
            AND reservation.location_id = ${input.locationId}::uuid
            AND reservation.review_session_id = ${input.reviewSessionId}::uuid
            AND reservation.permit_jti = ${input.permitJti}
            AND reservation.request_hash = ${input.requestHash}
            AND reservation.status = 'RESERVED'
            AND reservation.expires_at > clock_timestamp()
            AND ${leaseExpiresAt}::timestamptz > clock_timestamp()
            AND EXISTS (
              SELECT 1
              FROM generation_batches AS batch
              WHERE batch.id = ${input.generationBatchId}::uuid
                AND batch.budget_reservation_id = reservation.id
                AND batch.tenant_id = reservation.tenant_id
                AND batch.location_id = reservation.location_id
                AND batch.review_session_id = reservation.review_session_id
                AND batch.request_hash = reservation.request_hash
                AND batch.normalized_input #>> '{workload,bindings,generationId}' = ${input.generationId}
            )
          RETURNING id AS reservation_id, execution_lease_id, activation_expires_at
        `;
        const current =
          activated[0] ??
          (
            await transaction.$queryRaw<ActivationRow[]>`
              SELECT id AS reservation_id, execution_lease_id, activation_expires_at
              FROM budget_reservations
              WHERE tenant_id = ${input.tenantId}::uuid
                AND location_id = ${input.locationId}::uuid
                AND review_session_id = ${input.reviewSessionId}::uuid
                AND permit_jti = ${input.permitJti}
                AND request_hash = ${input.requestHash}
                AND status = 'REDEEMED'
                AND execution_lease_id = ${input.leaseId}::uuid
                AND activation_expires_at > clock_timestamp()
            `
          )[0];
        if (current !== undefined) {
          const rescheduled = await transaction.$queryRaw<
            { readonly rescheduled: boolean }[]
          >`
            SELECT reschedule_reconciliation_queue_item(
              ${current.reservation_id}::uuid,
              ${input.tenantId}::uuid,
              ${input.leaseId}::uuid,
              ${leaseExpiresAt}::timestamptz
            ) AS rescheduled
          `;
          if (rescheduled[0]?.rescheduled !== true) {
            return { status: "rejected" } as const;
          }
        }
        return current === undefined
          ? ({ status: "rejected" } as const)
          : {
              status: "activated" as const,
              leaseId: current.execution_lease_id,
              activationExpiresAt: current.activation_expires_at.toISOString(),
            };
      });
    },

    async settle(input) {
      if (
        !Number.isSafeInteger(input.actualCostMicros) ||
        input.actualCostMicros < 0
      ) {
        return { status: "rejected" };
      }
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const settled = await transaction.$queryRaw<
          { readonly reservation_id: string }[]
        >`
          UPDATE budget_reservations AS reservation
          SET
            status = 'SETTLED',
            actual_cost_micros = ${input.actualCostMicros},
            settled_at = clock_timestamp()
          WHERE reservation.tenant_id = ${input.tenantId}::uuid
            AND reservation.location_id = ${input.locationId}::uuid
            AND reservation.review_session_id = ${input.reviewSessionId}::uuid
            AND reservation.permit_jti = ${input.permitJti}
            AND reservation.request_hash = ${input.requestHash}
            AND reservation.status = 'REDEEMED'
            AND reservation.execution_lease_id = ${input.leaseId}::uuid
            AND reservation.reserved_micros >= ${input.actualCostMicros}
            AND EXISTS (
              SELECT 1
              FROM generation_batches AS batch
              WHERE batch.id = ${input.generationBatchId}::uuid
                AND batch.budget_reservation_id = reservation.id
                AND batch.tenant_id = reservation.tenant_id
                AND batch.location_id = reservation.location_id
                AND batch.review_session_id = reservation.review_session_id
                AND batch.normalized_input #>> '{workload,bindings,generationId}' = ${input.generationId}
            )
          RETURNING reservation.id AS reservation_id
        `;
        await transaction.$executeRaw`
          SELECT release_platform_generation_capacity(reservation.id)
          FROM budget_reservations AS reservation
          WHERE reservation.tenant_id = ${input.tenantId}::uuid
            AND reservation.permit_jti = ${input.permitJti}
            AND reservation.status = 'SETTLED'
            AND reservation.execution_lease_id = ${input.leaseId}::uuid
        `;
        const settledReservationId = settled[0]?.reservation_id;
        if (settledReservationId !== undefined) {
          const removed = await transaction.$queryRaw<
            { readonly removed: boolean }[]
          >`
            SELECT remove_reconciliation_queue_item(
              ${settledReservationId}::uuid,
              ${input.tenantId}::uuid
            ) AS removed
          `;
          if (removed[0]?.removed !== true) {
            throw new Error("GENERATION_RECONCILIATION_REMOVE_FAILED");
          }
          return { status: "settled" } as const;
        }
        const existing = await transaction.$queryRaw<{ readonly found: boolean }[]>`
          SELECT true AS found
          FROM budget_reservations
          WHERE tenant_id = ${input.tenantId}::uuid
            AND location_id = ${input.locationId}::uuid
            AND review_session_id = ${input.reviewSessionId}::uuid
            AND permit_jti = ${input.permitJti}
            AND request_hash = ${input.requestHash}
            AND status = 'SETTLED'
            AND execution_lease_id = ${input.leaseId}::uuid
            AND actual_cost_micros = ${input.actualCostMicros}
          LIMIT 1
        `;
        return existing[0]?.found === true
          ? ({ status: "settled" } as const)
          : ({ status: "rejected" } as const);
      });
    },

    async listReconciliationCandidates({ limit }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("Reconciliation limit is invalid");
      }
      const queued = await client.$queryRaw<ReconciliationQueueRow[]>`
        SELECT reservation_id, tenant_id, execution_lease_id
        FROM claim_due_reconciliation_queue(
          ${randomUUID()}::uuid,
          ${limit}::integer
        )
      `;
      const candidates: (
        | {
            readonly kind: "never-leased";
            readonly permitJti: string;
            readonly workload: Readonly<Record<string, unknown>>;
          }
        | {
            readonly kind: "expired-lease";
            readonly permitJti: string;
            readonly leaseId: string;
            readonly workload: Readonly<Record<string, unknown>>;
          }
      )[] = [];
      for (const queuedItem of queued) {
        const candidate = await client.$transaction(async (transaction) => {
          await transaction.$executeRaw`
            SELECT set_config('app.tenant_id', ${queuedItem.tenant_id}, true)
          `;
          return (
            await transaction.$queryRaw<ReconciliationCandidateRow[]>`
              SELECT
                reservation.permit_jti,
                reservation.execution_lease_id,
                batch.normalized_input
              FROM budget_reservations AS reservation
              JOIN generation_batches AS batch
                ON batch.budget_reservation_id = reservation.id
               AND batch.tenant_id = reservation.tenant_id
               AND batch.location_id = reservation.location_id
               AND batch.review_session_id = reservation.review_session_id
              WHERE reservation.id = ${queuedItem.reservation_id}::uuid
                AND reservation.tenant_id = ${queuedItem.tenant_id}::uuid
                AND reservation.status IN ('RESERVED', 'REDEEMED')
              LIMIT 1
            `
          )[0];
        });
        if (candidate === undefined) {
          continue;
        }
        const workload = asRecord(
          asRecord(candidate.normalized_input)["workload"],
        );
        if (candidate.execution_lease_id === null) {
          candidates.push({
            kind: "never-leased",
            permitJti: candidate.permit_jti,
            workload,
          });
        } else {
          candidates.push({
            kind: "expired-lease",
            permitJti: candidate.permit_jti,
            leaseId: candidate.execution_lease_id,
            workload,
          });
        }
      }
      return candidates;
    },

    async releaseReconciled(input) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const leasePredicate =
          input.outcome === "cancelled"
            ? Prisma.sql`reservation.status = 'REDEEMED'
                AND reservation.execution_lease_id = ${input.leaseId}::uuid
                AND reconciliation_queue_item_is_releasable(
                  reservation.id,
                  reservation.tenant_id,
                  ${input.leaseId}::uuid,
                  'cancelled'
                )`
            : Prisma.sql`reservation.status = 'RESERVED'
                AND reservation.execution_lease_id IS NULL
                AND reservation.expires_at + interval '30 seconds' <= clock_timestamp()
                AND reconciliation_queue_item_is_releasable(
                  reservation.id,
                  reservation.tenant_id,
                  NULL,
                  'never-leased'
                )`;
        const released = await transaction.$queryRaw<
          { readonly reservation_id: string }[]
        >`
          UPDATE budget_reservations AS reservation
          SET
            status = 'RELEASED',
            actual_cost_micros = 0,
            settled_at = clock_timestamp()
          WHERE reservation.tenant_id = ${input.tenantId}::uuid
            AND reservation.location_id = ${input.locationId}::uuid
            AND reservation.review_session_id = ${input.reviewSessionId}::uuid
            AND reservation.permit_jti = ${input.permitJti}
            AND reservation.request_hash = ${input.requestHash}
            AND ${leasePredicate}
            AND EXISTS (
              SELECT 1
              FROM generation_batches AS batch
              WHERE batch.id = ${input.generationBatchId}::uuid
                AND batch.budget_reservation_id = reservation.id
                AND batch.tenant_id = reservation.tenant_id
                AND batch.location_id = reservation.location_id
                AND batch.review_session_id = reservation.review_session_id
                AND batch.normalized_input #>> '{workload,bindings,generationId}' = ${input.generationId}
            )
          RETURNING reservation.id AS reservation_id
        `;
        const reservationId = released[0]?.reservation_id;
        if (reservationId !== undefined) {
          await transaction.$executeRaw`
            SELECT release_platform_generation_capacity(${reservationId}::uuid)
          `;
          const removed = await transaction.$queryRaw<
            { readonly removed: boolean }[]
          >`
            SELECT remove_reconciliation_queue_item(
              ${reservationId}::uuid,
              ${input.tenantId}::uuid
            ) AS removed
          `;
          if (removed[0]?.removed !== true) {
            throw new Error("GENERATION_RECONCILIATION_REMOVE_FAILED");
          }
          return { status: "released" } as const;
        }
        const existing = await transaction.$queryRaw<{ readonly found: boolean }[]>`
          SELECT true AS found
          FROM budget_reservations AS reservation
          WHERE reservation.tenant_id = ${input.tenantId}::uuid
            AND reservation.location_id = ${input.locationId}::uuid
            AND reservation.review_session_id = ${input.reviewSessionId}::uuid
            AND reservation.permit_jti = ${input.permitJti}
            AND reservation.request_hash = ${input.requestHash}
            AND reservation.status = 'RELEASED'
            AND ${
              input.outcome === "cancelled"
                ? Prisma.sql`reservation.execution_lease_id = ${input.leaseId}::uuid`
                : Prisma.sql`reservation.execution_lease_id IS NULL`
            }
            AND EXISTS (
              SELECT 1
              FROM generation_batches AS batch
              WHERE batch.id = ${input.generationBatchId}::uuid
                AND batch.budget_reservation_id = reservation.id
                AND batch.tenant_id = reservation.tenant_id
                AND batch.location_id = reservation.location_id
                AND batch.review_session_id = reservation.review_session_id
                AND batch.normalized_input #>> '{workload,bindings,generationId}' = ${input.generationId}
            )
          LIMIT 1
        `;
        return existing[0]?.found === true
          ? ({ status: "released" } as const)
          : ({ status: "rejected" } as const);
      });
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}
