import { createHash, randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "../generated/admission/index.js";

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

export interface ReviewerGenerationAdmissionInput {
  readonly routeHandleHash: string;
  readonly browserCapabilityHash: string;
  readonly idempotencyKey: string;
  readonly factOptionIds: readonly string[];
  readonly reviewFormatVersionId: string;
}

export type ReviewerGenerationAdmissionResult =
  | {
      readonly status: "prepared";
      readonly permitJti: string;
      readonly permitExpiresAt: string;
      readonly workload: Readonly<Record<string, unknown>>;
    }
  | { readonly status: "rejected" };

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
    readonly routeHandleHash: string;
    readonly browserCapabilityHash: string;
    readonly expiresAt: string;
  }): Promise<{ readonly status: "prepared" } | { readonly status: "unavailable" }>;
  read(input: ReviewSessionCapabilityHashes): Promise<
    | {
        readonly status: "ready";
        readonly context: {
          readonly tenantDisplayName: string;
          readonly locationDisplayName: string;
          readonly locale: "en-GB" | "de-DE";
          readonly entryMode: "open-qr";
          readonly ratingRequired: true;
          readonly requirements: {
            readonly minimumFactSelections: number;
            readonly maximumReviewFormatsPerGeneration: 1;
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
  }): Promise<
    | {
        readonly status: "admitted";
        readonly reviewSessionId: string;
        readonly tenantId: string;
        readonly locationId: string;
      }
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
  readonly tenant_name: string;
  readonly location_name: string;
  readonly locale: string;
  readonly rating: number;
  readonly selected_action: string;
  readonly tenant_policy: unknown;
}

interface FactRow {
  readonly id: string;
  readonly label: string;
  readonly category_label: string;
  readonly polarity: string;
}

interface ReviewFormatRow {
  readonly id: string;
  readonly display_name: string | null;
  readonly description: string | null;
  readonly sample: string | null;
  readonly target_platform: string;
  readonly constraints: unknown;
  readonly allowed_actions: string[];
}

interface DestinationRow {
  readonly target_platform: string;
  readonly display_name: string;
  readonly target_url: string;
}

interface AdmissionSessionRow {
  readonly rating: number;
  readonly selected_action: string;
  readonly tenant_policy: unknown;
}

interface AdmissionFactRow {
  readonly id: string;
  readonly version: number;
  readonly proposition: string;
  readonly polarity: string;
}

interface AdmissionSnapshotRow {
  readonly id: string;
  readonly content_hash: string;
  readonly payload: unknown;
}

interface ExistingAdmissionRow {
  readonly request_hash: string;
  readonly permit_jti: string;
  readonly expires_at: Date;
  readonly normalized_input: unknown;
}

interface ActivationRow {
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
}

interface EntryContextRow {
  readonly tenant_name: string;
  readonly location_name: string;
  readonly locale: string;
  readonly tenant_policy: unknown;
}

const isLocale = (value: string): value is "en-GB" | "de-DE" =>
  value === "en-GB" || value === "de-DE";

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
      return "generate";
    case "PARAPHRASE":
      return "paraphrase";
    case "REFORMAT":
      return "reformat";
    case "CONDENSE":
      return "condense";
    case "EXPAND":
      return "expand";
    case "REVISE_WORDING":
      return "revise-wording";
    default:
      return undefined;
  }
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
        FROM review_session_browser_bindings
        WHERE route_handle_hash = ${routeHandleHash}
          AND browser_capability_hash = ${browserCapabilityHash}
          AND revoked_at IS NULL
          AND expires_at > clock_timestamp()
        LIMIT 1
      `;
      const binding = bindings[0];
      if (binding === undefined) {
        return null;
      }

      return await withTenant(binding.tenant_id, async (transaction) => {
        const sessions = await transaction.$queryRaw<SessionRow[]>`
          SELECT
            session.id AS review_session_id,
            tenant.name AS tenant_name,
            location.name AS location_name,
            tenant.locale,
            session.rating,
            session.selected_action::text,
            tenant.policy AS tenant_policy
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
        if (session === undefined || !isLocale(session.locale) || !isRating(session.rating)) {
          return null;
        }
        const action = toAction(session.selected_action);
        if (action === undefined) {
          return null;
        }

        const facts = await transaction.$queryRaw<FactRow[]>`
          SELECT
            fact.id,
            COALESCE(fact.label ->> ${session.locale}, fact.label ->> 'en-GB') AS label,
            COALESCE(category.label ->> ${session.locale}, category.label ->> 'en-GB') AS category_label,
            fact.polarity::text
          FROM fact_option_versions AS fact
          JOIN fact_option_categories AS category
            ON category.id = fact.category_id
           AND category.tenant_id = fact.tenant_id
          WHERE fact.tenant_id = ${binding.tenant_id}::uuid
            AND (fact.location_id IS NULL OR fact.location_id = ${binding.location_id}::uuid)
            AND fact.is_active = true
            AND fact.retired_at IS NULL
          ORDER BY fact.sort_order, fact.id
        `;
        const factOptions: ReviewSessionFactProjection[] = [];
        for (const fact of facts) {
          const polarity = toPolarity(fact.polarity);
          if (polarity === undefined || fact.label === null || fact.category_label === null) {
            continue;
          }
          factOptions.push({
            id: fact.id,
            label: fact.label,
            categoryLabel: fact.category_label,
            polarity,
          });
        }

        const formatRows = await transaction.$queryRaw<ReviewFormatRow[]>`
          SELECT
            format.id,
            COALESCE(
              format.localized_text -> 'displayName' ->> ${session.locale},
              format.localized_text -> 'displayName' ->> 'en-GB'
            ) AS display_name,
            COALESCE(
              format.localized_text -> 'description' ->> ${session.locale},
              format.localized_text -> 'description' ->> 'en-GB'
            ) AS description,
            COALESCE(
              format.localized_text -> 'sample' ->> ${session.locale},
              format.localized_text -> 'sample' ->> 'en-GB'
            ) AS sample,
            format.target_platform,
            format.constraints,
            enablement.allowed_actions::text[]
          FROM review_format_enablements AS enablement
          JOIN review_format_versions AS format
            ON format.id = enablement.review_format_version_id
          WHERE enablement.tenant_id = ${binding.tenant_id}::uuid
            AND enablement.enabled = true
            AND format.status = 'ACTIVE'
            AND format.locale IN (${session.locale}, 'any')
            AND enablement.allowed_actions @>
              ARRAY[${session.selected_action}::generation_action]
            AND format.supported_actions @>
              ARRAY[${session.selected_action}::generation_action]
          ORDER BY enablement.sort_order, format.id
        `;
        const reviewFormats: ReviewSessionFormatProjection[] = [];
        for (const format of formatRows) {
          const constraints = formatConstraints(format.constraints);
          if (
            format.display_name === null ||
            format.description === null ||
            format.sample === null ||
            constraints === undefined
          ) {
            continue;
          }
          reviewFormats.push({
            id: format.id,
            displayName: format.display_name,
            description: format.description,
            sample: format.sample,
            targetPlatform: format.target_platform,
            constraints,
            availableCommands: format.allowed_actions.flatMap((action) => {
              const command = toAvailableCommand(action);
              return command === undefined ? [] : [command];
            }),
          });
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
          tenantDisplayName: session.tenant_name,
          locationDisplayName: session.location_name,
          locale: session.locale,
          rating: session.rating,
          action,
          requirements: {
            minimumFactSelections: minimumFactSelections(session.tenant_policy),
            maximumReviewFormatsPerGeneration: 1 as const,
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
        SELECT challenge_id, tenant_id, location_id
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
      const rows = await client.$queryRaw<{ readonly prepared: boolean }[]>`
        SELECT prepare_open_qr_entry_challenge(
          ${input.tenantSlug}::varchar,
          ${input.locationSlug}::varchar,
          ${input.routeHandleHash}::varchar,
          ${input.browserCapabilityHash}::varchar,
          ${expiresAt}::timestamptz
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
        const contexts = await transaction.$queryRaw<EntryContextRow[]>`
          SELECT
            tenant.name AS tenant_name,
            location.name AS location_name,
            tenant.locale,
            tenant.policy AS tenant_policy
          FROM tenants AS tenant
          JOIN locations AS location
            ON location.tenant_id = tenant.id
          WHERE tenant.id = ${scope.tenant_id}::uuid
            AND tenant.status = 'ACTIVE'
            AND tenant.default_entry_mode_key = 'open-qr'
            AND location.id = ${scope.location_id}::uuid
            AND location.status = 'ACTIVE'
        `;
        const context = contexts[0];
        if (context === undefined || !isLocale(context.locale)) {
          return { status: "unavailable" } as const;
        }
        const facts = await transaction.$queryRaw<FactRow[]>`
          SELECT
            fact.id,
            COALESCE(fact.label ->> ${context.locale}, fact.label ->> 'en-GB') AS label,
            COALESCE(category.label ->> ${context.locale}, category.label ->> 'en-GB') AS category_label,
            fact.polarity::text
          FROM fact_option_versions AS fact
          JOIN fact_option_categories AS category
            ON category.id = fact.category_id
           AND category.tenant_id = fact.tenant_id
          WHERE fact.tenant_id = ${scope.tenant_id}::uuid
            AND (fact.location_id IS NULL OR fact.location_id = ${scope.location_id}::uuid)
            AND fact.is_active = true
            AND fact.retired_at IS NULL
          ORDER BY fact.sort_order, fact.id
        `;
        const factOptions = facts.flatMap((fact) => {
          const polarity = toPolarity(fact.polarity);
          return polarity === undefined ||
            fact.label === null ||
            fact.category_label === null
            ? []
            : [
                {
                  id: fact.id,
                  label: fact.label,
                  categoryLabel: fact.category_label,
                  polarity,
                },
              ];
        });
        const formats = await transaction.$queryRaw<ReviewFormatRow[]>`
          SELECT
            format.id,
            COALESCE(
              format.localized_text -> 'displayName' ->> ${context.locale},
              format.localized_text -> 'displayName' ->> 'en-GB'
            ) AS display_name,
            COALESCE(
              format.localized_text -> 'description' ->> ${context.locale},
              format.localized_text -> 'description' ->> 'en-GB'
            ) AS description,
            COALESCE(
              format.localized_text -> 'sample' ->> ${context.locale},
              format.localized_text -> 'sample' ->> 'en-GB'
            ) AS sample,
            format.target_platform,
            format.constraints,
            enablement.allowed_actions::text[]
          FROM review_format_enablements AS enablement
          JOIN review_format_versions AS format
            ON format.id = enablement.review_format_version_id
          WHERE enablement.tenant_id = ${scope.tenant_id}::uuid
            AND enablement.enabled = true
            AND format.status = 'ACTIVE'
            AND format.locale IN (${context.locale}, 'any')
          ORDER BY enablement.sort_order, format.id
        `;
        const reviewFormats: ReviewSessionFormatProjection[] = [];
        for (const format of formats) {
          const constraints = formatConstraints(format.constraints);
          if (
            format.display_name === null ||
            format.description === null ||
            format.sample === null ||
            constraints === undefined
          ) {
            continue;
          }
          reviewFormats.push({
            id: format.id,
            displayName: format.display_name,
            description: format.description,
            sample: format.sample,
            targetPlatform: format.target_platform,
            constraints,
            availableCommands: format.allowed_actions.flatMap((action) => {
              const command = toAvailableCommand(action);
              return command === undefined ? [] : [command];
            }),
          });
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
          context: {
            tenantDisplayName: context.tenant_name,
            locationDisplayName: context.location_name,
            locale: context.locale,
            entryMode: "open-qr" as const,
            ratingRequired: true as const,
            requirements: {
              minimumFactSelections: minimumFactSelections(context.tenant_policy),
              maximumReviewFormatsPerGeneration: 1 as const,
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
      if (
        scope === undefined ||
        Number.isNaN(reviewSessionExpiresAt.getTime())
      ) {
        return { status: "unavailable" };
      }
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${scope.tenant_id}, true)
        `;
        const compatibleFormats = await transaction.$queryRaw<
          { readonly id: string }[]
        >`
          SELECT format.id
          FROM review_format_enablements AS enablement
          JOIN review_format_versions AS format
            ON format.id = enablement.review_format_version_id
          WHERE enablement.tenant_id = ${scope.tenant_id}::uuid
            AND enablement.enabled = true
            AND enablement.allowed_actions @>
              ARRAY[${input.action}::generation_action]
            AND format.status = 'ACTIVE'
            AND format.supported_actions @>
              ARRAY[${input.action}::generation_action]
          LIMIT 1
        `;
        if (compatibleFormats[0] === undefined) {
          return { status: "unavailable" } as const;
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
        const reviewSessionId = randomUUID();
        await transaction.$executeRaw`
          INSERT INTO review_sessions (
            id, tenant_id, location_id, status, rating,
            selected_action, expires_at
          ) VALUES (
            ${reviewSessionId}::uuid,
            ${scope.tenant_id}::uuid,
            ${scope.location_id}::uuid,
            'OPEN',
            ${input.rating},
            ${input.action}::generation_action,
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
            ${reviewSessionExpiresAt}::timestamptz
          )
        `;
        return {
          status: "admitted" as const,
          reviewSessionId,
          tenantId: scope.tenant_id,
          locationId: scope.location_id,
        };
      });
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
  const polarity = toPolarity(value);
  if (polarity === undefined) {
    throw new Error("Stored Fact Option polarity is invalid");
  }
  return polarity;
};

export function createPostgresReviewerGenerationAdmissionStore({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): PostgresReviewerGenerationAdmissionStore {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Admission database URL is required");
  }
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  return {
    async prepare(input) {
      if (
        input.factOptionIds.length === 0 ||
        input.idempotencyKey.length === 0 ||
        input.idempotencyKey.length > 128
      ) {
        return { status: "rejected" };
      }
      const bindings = await client.$queryRaw<BindingRow[]>`
        SELECT tenant_id, location_id, review_session_id
        FROM review_session_browser_bindings
        WHERE route_handle_hash = ${input.routeHandleHash}
          AND browser_capability_hash = ${input.browserCapabilityHash}
          AND revoked_at IS NULL
          AND expires_at > clock_timestamp()
        LIMIT 1
      `;
      const binding = bindings[0];
      if (binding === undefined) {
        return { status: "rejected" };
      }

      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${binding.tenant_id}, true)
        `;
        const sessions = await transaction.$queryRaw<AdmissionSessionRow[]>`
          SELECT
            session.rating,
            session.selected_action::text,
            tenant.policy AS tenant_policy
          FROM review_sessions AS session
          JOIN tenants AS tenant ON tenant.id = session.tenant_id
          WHERE session.id = ${binding.review_session_id}::uuid
            AND session.tenant_id = ${binding.tenant_id}::uuid
            AND session.location_id = ${binding.location_id}::uuid
            AND session.status = 'OPEN'
            AND session.expires_at > clock_timestamp()
          FOR UPDATE
        `;
        const session = sessions[0];
        if (
          session === undefined ||
          !isRating(session.rating) ||
          session.selected_action !== "GENERATE" ||
          input.factOptionIds.length < minimumFactSelections(session.tenant_policy)
        ) {
          return { status: "rejected" } as const;
        }
        const normalizedRequest = {
          factOptionIds: [...new Set(input.factOptionIds)],
          reviewFormatVersionId: input.reviewFormatVersionId,
          rating: session.rating,
        };
        if (normalizedRequest.factOptionIds.length !== input.factOptionIds.length) {
          return { status: "rejected" } as const;
        }
        const requestHash = sha256(stableJson(normalizedRequest));

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
          if (
            row.request_hash !== requestHash ||
            row.expires_at.getTime() <= Date.now()
          ) {
            return { status: "rejected" } as const;
          }
          return {
            status: "prepared" as const,
            permitJti: row.permit_jti,
            permitExpiresAt: row.expires_at.toISOString(),
            workload: asRecord(stored["workload"]),
          };
        }

        const facts = await transaction.$queryRaw<AdmissionFactRow[]>`
          SELECT id, version, proposition, polarity::text
          FROM fact_option_versions
          WHERE tenant_id = ${binding.tenant_id}::uuid
            AND id::text IN (${Prisma.join(normalizedRequest.factOptionIds)})
            AND (location_id IS NULL OR location_id = ${binding.location_id}::uuid)
            AND is_active = true
            AND retired_at IS NULL
          ORDER BY array_position(
            ARRAY[${Prisma.join(normalizedRequest.factOptionIds)}]::text[],
            id::text
          )
        `;
        if (facts.length !== normalizedRequest.factOptionIds.length) {
          return { status: "rejected" } as const;
        }
        const formats = await transaction.$queryRaw<{ readonly id: string }[]>`
          SELECT format.id
          FROM review_format_versions AS format
          JOIN review_format_enablements AS enablement
            ON enablement.review_format_version_id = format.id
          WHERE format.id = ${input.reviewFormatVersionId}::uuid
            AND format.status = 'ACTIVE'
            AND format.supported_actions @> ARRAY['GENERATE']::generation_action[]
            AND enablement.tenant_id = ${binding.tenant_id}::uuid
            AND enablement.enabled = true
            AND enablement.allowed_actions @> ARRAY['GENERATE']::generation_action[]
          LIMIT 1
        `;
        if (formats[0] === undefined) {
          return { status: "rejected" } as const;
        }
        const snapshots = await transaction.$queryRaw<AdmissionSnapshotRow[]>`
          SELECT id, content_hash, payload
          FROM effective_configuration_snapshots
          WHERE tenant_id = ${binding.tenant_id}::uuid
            AND location_id = ${binding.location_id}::uuid
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `;
        const snapshotRow = snapshots[0];
        if (snapshotRow === undefined) {
          return { status: "rejected" } as const;
        }
        const snapshot = asRecord(snapshotRow.payload);
        if (
          snapshot["snapshotId"] !== snapshotRow.id ||
          snapshot["tenantId"] !== binding.tenant_id ||
          snapshot["locationId"] !== binding.location_id
        ) {
          throw new Error("Stored Effective Configuration Snapshot is not self-bound");
        }
        const routing = asRecord(snapshot["providerRouting"]);
        if (
          requireString(routing, "primaryProvider") !== "fake" ||
          requireString(routing, "primaryModel") !== "fake-v1"
        ) {
          return { status: "rejected" } as const;
        }
        const providerModelId = requireString(routing, "providerModelId");
        const priceRates = snapshot["priceRates"];
        if (!Array.isArray(priceRates)) {
          throw new Error("Stored Price Rates are invalid");
        }
        const priceRate = priceRates
          .map(asRecord)
          .find(
            (rate) =>
              rate["providerModelId"] === providerModelId &&
              rate["provider"] === "fake" &&
              rate["model"] === "fake-v1" &&
              rate["inputPerMillionMicros"] === 0 &&
              rate["outputPerMillionMicros"] === 0,
          );
        if (priceRate === undefined) {
          return { status: "rejected" } as const;
        }

        const assertions = facts.map((fact) => ({
          id: randomUUID(),
          version: `${fact.id}@${fact.version}`,
          reviewSessionId: binding.review_session_id,
          semanticId: fact.id,
          proposition: fact.proposition,
          semanticKind: "experience-fact" as const,
          polarity: admissionPolarity(fact.polarity),
          source: {
            kind: "fact-option" as const,
            factOptionId: fact.id,
            factOptionVersion: `${fact.id}@${fact.version}`,
          },
        }));
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
            action: "generate",
            reviewFormatVersionId: input.reviewFormatVersionId,
            assertionSetHash,
            requestHash,
            snapshotId: snapshotRow.id,
            snapshotHash: snapshotRow.content_hash,
            providerModelId,
            priceRateId: requireString(priceRate, "id"),
            idempotencyKey: input.idempotencyKey,
          },
          snapshot,
          command: {
            kind: "generate",
            assertionIds: assertions.map((assertion) => assertion.id),
            rating: session.rating,
          },
          assertions,
        };

        for (const [index, assertion] of assertions.entries()) {
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
            'GENERATE',
            0,
            'RESERVED',
            ${permitExpiresAt}
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
            'GENERATE',
            ${JSON.stringify({ workload })}::jsonb
          )
        `;
        await transaction.$executeRaw`
          INSERT INTO reconciliation_queue_items (
            reservation_id, tenant_id, due_at
          ) VALUES (
            ${reservationId}::uuid,
            ${binding.tenant_id}::uuid,
            ${permitExpiresAt}::timestamptz + interval '30 seconds'
          )
        `;
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
          RETURNING execution_lease_id, activation_expires_at
        `;
        const current =
          activated[0] ??
          (
            await transaction.$queryRaw<ActivationRow[]>`
              SELECT execution_lease_id, activation_expires_at
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
          await transaction.$executeRaw`
            UPDATE reconciliation_queue_items
            SET
              execution_lease_id = ${input.leaseId}::uuid,
              due_at = ${leaseExpiresAt}::timestamptz
            WHERE reservation_id = (
              SELECT id
              FROM budget_reservations
              WHERE tenant_id = ${input.tenantId}::uuid
                AND permit_jti = ${input.permitJti}
                AND execution_lease_id = ${input.leaseId}::uuid
            )
          `;
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
        const settled = await transaction.$executeRaw`
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
        `;
        if (settled === 1) {
          await transaction.$executeRaw`
            DELETE FROM reconciliation_queue_items
            WHERE reservation_id = (
              SELECT id
              FROM budget_reservations
              WHERE tenant_id = ${input.tenantId}::uuid
                AND permit_jti = ${input.permitJti}
                AND status = 'SETTLED'
            )
          `;
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
        FROM reconciliation_queue_items
        WHERE due_at <= clock_timestamp()
        ORDER BY due_at, reservation_id
        LIMIT ${limit}
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
                AND queue.execution_lease_id = ${input.leaseId}::uuid`
            : Prisma.sql`reservation.status = 'RESERVED'
                AND reservation.execution_lease_id IS NULL
                AND queue.execution_lease_id IS NULL
                AND reservation.expires_at + interval '30 seconds' <= clock_timestamp()`;
        const released = await transaction.$queryRaw<
          { readonly reservation_id: string }[]
        >`
          UPDATE budget_reservations AS reservation
          SET
            status = 'RELEASED',
            actual_cost_micros = 0,
            settled_at = clock_timestamp()
          FROM reconciliation_queue_items AS queue
          WHERE queue.reservation_id = reservation.id
            AND queue.tenant_id = reservation.tenant_id
            AND queue.due_at <= clock_timestamp()
            AND reservation.tenant_id = ${input.tenantId}::uuid
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
            DELETE FROM reconciliation_queue_items
            WHERE reservation_id = ${reservationId}::uuid
          `;
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
