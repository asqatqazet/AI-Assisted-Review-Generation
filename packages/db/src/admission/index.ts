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
  readonly availableCommands: readonly (
    | "generate"
    | "paraphrase"
    | "reformat"
    | "condense"
    | "expand"
    | "revise-wording"
  )[];
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
  readonly factOptions: readonly ReviewSessionFactProjection[];
  readonly reviewFormats: readonly ReviewSessionFormatProjection[];
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
  readonly allowed_actions: string[];
}

interface AdmissionSessionRow {
  readonly rating: number;
  readonly selected_action: string;
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

const isLocale = (value: string): value is "en-GB" | "de-DE" =>
  value === "en-GB" || value === "de-DE";

const isRating = (value: number): value is 1 | 2 | 3 | 4 | 5 =>
  Number.isInteger(value) && value >= 1 && value <= 5;

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
            session.selected_action::text
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
          if (
            format.display_name === null ||
            format.description === null ||
            format.sample === null
          ) {
            continue;
          }
          reviewFormats.push({
            id: format.id,
            displayName: format.display_name,
            description: format.description,
            sample: format.sample,
            availableCommands: format.allowed_actions.flatMap((action) => {
              const command = toAvailableCommand(action);
              return command === undefined ? [] : [command];
            }),
          });
        }

        return {
          reviewSessionId: session.review_session_id,
          tenantId: binding.tenant_id,
          locationId: binding.location_id,
          tenantDisplayName: session.tenant_name,
          locationDisplayName: session.location_name,
          locale: session.locale,
          rating: session.rating,
          action,
          factOptions,
          reviewFormats,
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
          SELECT rating, selected_action::text
          FROM review_sessions
          WHERE id = ${binding.review_session_id}::uuid
            AND tenant_id = ${binding.tenant_id}::uuid
            AND location_id = ${binding.location_id}::uuid
            AND status = 'OPEN'
            AND expires_at > clock_timestamp()
          FOR UPDATE
        `;
        const session = sessions[0];
        if (
          session === undefined ||
          !isRating(session.rating) ||
          session.selected_action !== "GENERATE"
        ) {
          return { status: "rejected" } as const;
        }
        const normalizedRequest = {
          factOptionIds: [...new Set(input.factOptionIds)].sort(),
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
          ORDER BY id
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

    async disconnect() {
      await client.$disconnect();
    },
  };
}
