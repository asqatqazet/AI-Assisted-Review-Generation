import { PrismaClient } from "../generated/execution-plane/index.js";
import type { Prisma } from "../generated/execution-plane/index.js";

export interface GenerationExecutionScope {
  readonly tenantId: string;
  readonly locationId: string;
  readonly reviewSessionId: string;
  readonly generationBatchId: string;
  readonly generationId: string;
  readonly permitJti: string;
}

export interface PrepareGenerationLeaseInput extends GenerationExecutionScope {
  readonly permitExpiresAt: string;
}

export interface ClaimGenerationAttemptInput extends GenerationExecutionScope {
  readonly leaseId: string;
  readonly activationExpiresAt: string;
  readonly attemptOrdinal: 1;
  readonly providerModelId: string;
  readonly priceRateId: string;
  readonly requestPayload: unknown;
}

type LeaseState = "no-lease" | "leased" | "running" | "cancelled" | "terminal";

export interface PostgresGenerationLeaseJournal {
  prepare(input: PrepareGenerationLeaseInput): Promise<{
    readonly status: "leased" | "existing";
    readonly leaseId: string;
    readonly leaseExpiresAt: string;
  }>;
  claimExecution(input: ClaimGenerationAttemptInput): Promise<
    | { readonly status: "claimed"; readonly attemptId: string }
    | { readonly status: "existing"; readonly attemptId: string }
  >;
  status(scope: GenerationExecutionScope): Promise<{
    readonly state: LeaseState;
  }>;
  cancelExpired(input: GenerationExecutionScope & { readonly leaseId: string }): Promise<{
    readonly state: Exclude<LeaseState, "leased">;
  }>;
  disconnect(): Promise<void>;
}

export interface PostgresGenerationLeaseJournalOptions {
  readonly databaseUrl: string;
}

export interface CompleteGenerationInput extends GenerationExecutionScope {
  readonly leaseId: string;
  readonly attemptId: string;
  readonly snapshotId: string;
  readonly promptVersionId: string;
  readonly reviewFormatVersionId: string;
  readonly action:
    | "GENERATE"
    | "PARAPHRASE"
    | "REFORMAT"
    | "CONDENSE"
    | "EXPAND"
    | "REVISE_WORDING"
    | "RESAMPLE";
  readonly result: {
    readonly draft: string;
    readonly claims: readonly {
      readonly proposition: string;
      readonly assertionIds: readonly string[];
    }[];
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly providerReceipt: unknown;
  };
}

export interface RejectGenerationInput extends GenerationExecutionScope {
  readonly leaseId: string;
  readonly attemptId: string;
  readonly snapshotId: string;
  readonly promptVersionId: string;
  readonly reviewFormatVersionId: string;
  readonly action: CompleteGenerationInput["action"];
  readonly code:
    | "GROUNDING_REJECTED"
    | "POLICY_REJECTED"
    | "FORMAT_REJECTED"
    | "PROVIDER_UNAVAILABLE";
  readonly retryable: boolean;
}

export interface PersistedTerminalDraft {
  readonly draft: {
    readonly id: string;
    readonly generationId: string;
    readonly revision: 1;
    readonly text: string;
  };
  readonly actualCostMicros: number;
}

export interface PostgresGenerationTerminalStore {
  read(
    scope: GenerationExecutionScope,
  ): Promise<PersistedTerminalDraft | null>;
  complete(input: CompleteGenerationInput): Promise<PersistedTerminalDraft>;
  reject(input: RejectGenerationInput): Promise<{
    readonly actualCostMicros: number;
  }>;
  disconnect(): Promise<void>;
}

interface PrepareLeaseRow {
  readonly outcome: "leased" | "existing";
  readonly lease_id: string;
  readonly lease_expires_at: Date;
}

interface ClaimAttemptRow {
  readonly outcome: "claimed" | "existing";
  readonly attempt_id: string;
}

interface TerminalDraftRow {
  readonly draft_id: string;
  readonly generation_id: string;
  readonly revision: number;
  readonly text: string;
  readonly total_cost_micros: bigint;
}

interface IdRow {
  readonly id: string;
}

function requireSingleRow<Row>(rows: readonly Row[], operation: string): Row {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`${operation} returned an invalid row count`);
  }
  return rows[0];
}

function isLeaseState(value: string): value is LeaseState {
  return ["no-lease", "leased", "running", "cancelled", "terminal"].includes(
    value,
  );
}

function requireLeaseState(value: string): LeaseState {
  if (!isLeaseState(value)) {
    throw new Error("Lease journal returned an invalid state");
  }
  return value;
}

export function createPostgresGenerationLeaseJournal({
  databaseUrl,
}: PostgresGenerationLeaseJournalOptions): PostgresGenerationLeaseJournal {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Execution database URL is required");
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
    async prepare(input) {
      const row = await withTenant(input.tenantId, async (transaction) =>
        requireSingleRow(
          await transaction.$queryRaw<PrepareLeaseRow[]>`
            SELECT outcome, lease_id, lease_expires_at
            FROM prepare_generation_lease(
              ${input.tenantId}::uuid,
              ${input.locationId}::uuid,
              ${input.reviewSessionId}::uuid,
              ${input.generationBatchId}::uuid,
              ${input.generationId}::uuid,
              ${input.permitJti}::varchar,
              ${new Date(input.permitExpiresAt)}::timestamptz
            )
          `,
          "prepare_generation_lease",
        ),
      );
      return {
        status: row.outcome,
        leaseId: row.lease_id,
        leaseExpiresAt: row.lease_expires_at.toISOString(),
      };
    },

    async claimExecution(input) {
      const row = await withTenant(input.tenantId, async (transaction) =>
        requireSingleRow(
          await transaction.$queryRaw<ClaimAttemptRow[]>`
            SELECT outcome, attempt_id
            FROM claim_generation_attempt(
              ${input.leaseId}::uuid,
              ${input.tenantId}::uuid,
              ${input.locationId}::uuid,
              ${input.reviewSessionId}::uuid,
              ${input.generationBatchId}::uuid,
              ${input.generationId}::uuid,
              ${input.permitJti}::varchar,
              ${new Date(input.activationExpiresAt)}::timestamptz,
              ${input.attemptOrdinal}::integer,
              ${input.providerModelId}::uuid,
              ${input.priceRateId}::uuid,
              ${JSON.stringify(input.requestPayload)}::jsonb
            )
          `,
          "claim_generation_attempt",
        ),
      );
      return { status: row.outcome, attemptId: row.attempt_id };
    },

    async status(scope) {
      const rows = await withTenant(scope.tenantId, async (transaction) =>
        transaction.$queryRaw<
          { readonly generation_lease_status: string }[]
        >`
          SELECT generation_lease_status(
            ${scope.tenantId}::uuid,
            ${scope.locationId}::uuid,
            ${scope.reviewSessionId}::uuid,
            ${scope.generationBatchId}::uuid,
            ${scope.generationId}::uuid,
            ${scope.permitJti}::varchar
          )
        `,
      );
      const row = requireSingleRow(rows, "generation_lease_status");
      return { state: requireLeaseState(row.generation_lease_status) };
    },

    async cancelExpired(input) {
      const rows = await withTenant(input.tenantId, async (transaction) =>
        transaction.$queryRaw<
          { readonly cancel_expired_generation_lease: string }[]
        >`
          SELECT cancel_expired_generation_lease(
            ${input.leaseId}::uuid,
            ${input.tenantId}::uuid,
            ${input.locationId}::uuid,
            ${input.reviewSessionId}::uuid,
            ${input.generationBatchId}::uuid,
            ${input.generationId}::uuid,
            ${input.permitJti}::varchar
          )
        `,
      );
      const row = requireSingleRow(rows, "cancel_expired_generation_lease");
      const state = requireLeaseState(row.cancel_expired_generation_lease);
      if (state === "leased") {
        throw new Error("Expiry cancellation returned a live lease");
      }
      return { state };
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}

export function createPostgresGenerationTerminalStore({
  databaseUrl,
}: PostgresGenerationLeaseJournalOptions): PostgresGenerationTerminalStore {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Execution database URL is required");
  }
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  const project = (row: TerminalDraftRow): PersistedTerminalDraft => {
    const actualCostMicros = Number(row.total_cost_micros);
    if (!Number.isSafeInteger(actualCostMicros) || row.revision !== 1) {
      throw new Error("Terminal Generation projection is invalid");
    }
    return {
      draft: {
        id: row.draft_id,
        generationId: row.generation_id,
        revision: 1,
        text: row.text,
      },
      actualCostMicros,
    };
  };

  return {
    async read(scope) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${scope.tenantId}, true)
        `;
        const rows = await transaction.$queryRaw<TerminalDraftRow[]>`
          SELECT
            draft.id AS draft_id,
            generation.id AS generation_id,
            revision.revision,
            revision.text,
            generation.total_cost_micros
          FROM generations AS generation
          JOIN drafts AS draft
            ON draft.originating_generation_id = generation.id
           AND draft.tenant_id = generation.tenant_id
           AND draft.location_id = generation.location_id
           AND draft.review_session_id = generation.review_session_id
          JOIN draft_revisions AS revision
            ON revision.draft_id = draft.id
           AND revision.tenant_id = draft.tenant_id
           AND revision.location_id = draft.location_id
           AND revision.review_session_id = draft.review_session_id
           AND revision.revision = 1
          WHERE generation.id = ${scope.generationId}::uuid
            AND generation.generation_batch_id = ${scope.generationBatchId}::uuid
            AND generation.tenant_id = ${scope.tenantId}::uuid
            AND generation.location_id = ${scope.locationId}::uuid
            AND generation.review_session_id = ${scope.reviewSessionId}::uuid
            AND EXISTS (
              SELECT 1
              FROM execution_leases AS lease
              WHERE lease.id = generation.execution_lease_id
                AND lease.permit_jti = ${scope.permitJti}
                AND lease.state = 'TERMINAL'
            )
          LIMIT 1
        `;
        return rows[0] === undefined ? null : project(rows[0]);
      });
    },

    async complete(input) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const existing = await transaction.$queryRaw<TerminalDraftRow[]>`
          SELECT
            draft.id AS draft_id,
            generation.id AS generation_id,
            revision.revision,
            revision.text,
            generation.total_cost_micros
          FROM generations AS generation
          JOIN drafts AS draft
            ON draft.originating_generation_id = generation.id
           AND draft.tenant_id = generation.tenant_id
           AND draft.location_id = generation.location_id
           AND draft.review_session_id = generation.review_session_id
          JOIN draft_revisions AS revision
            ON revision.draft_id = draft.id
           AND revision.tenant_id = draft.tenant_id
           AND revision.location_id = draft.location_id
           AND revision.review_session_id = draft.review_session_id
           AND revision.revision = 1
          WHERE generation.id = ${input.generationId}::uuid
            AND generation.tenant_id = ${input.tenantId}::uuid
            AND generation.location_id = ${input.locationId}::uuid
            AND generation.review_session_id = ${input.reviewSessionId}::uuid
        `;
        if (existing[0] !== undefined) {
          return project(existing[0]);
        }

        const finishedAttempts = await transaction.$executeRaw`
          UPDATE provider_attempts
          SET
            status = 'SUCCEEDED',
            provider_response = ${JSON.stringify(input.result.providerReceipt)}::jsonb,
            input_tokens = ${input.result.inputTokens},
            output_tokens = ${input.result.outputTokens},
            cost_micros = 0,
            finished_at = clock_timestamp()
          WHERE id = ${input.attemptId}::uuid
            AND execution_lease_id = ${input.leaseId}::uuid
            AND tenant_id = ${input.tenantId}::uuid
            AND location_id = ${input.locationId}::uuid
            AND review_session_id = ${input.reviewSessionId}::uuid
            AND generation_id = ${input.generationId}::uuid
            AND status = 'RUNNING'
        `;
        if (finishedAttempts !== 1) {
          throw new Error("Provider Attempt is not terminally claimable");
        }

        await transaction.$executeRaw`
          INSERT INTO generations (
            id, tenant_id, location_id, review_session_id,
            generation_batch_id, execution_lease_id, snapshot_id,
            prompt_version_id, review_format_version_id, action, status,
            provider_output, grounded_output, grounding_verdict, policy_result,
            total_input_tokens, total_output_tokens, total_cost_micros
          ) VALUES (
            ${input.generationId}::uuid,
            ${input.tenantId}::uuid,
            ${input.locationId}::uuid,
            ${input.reviewSessionId}::uuid,
            ${input.generationBatchId}::uuid,
            ${input.leaseId}::uuid,
            ${input.snapshotId}::uuid,
            ${input.promptVersionId}::uuid,
            ${input.reviewFormatVersionId}::uuid,
            ${input.action}::generation_action,
            'SUCCEEDED',
            NULL,
            ${input.result.draft},
            'PASSED',
            '{"violations":[]}'::jsonb,
            ${input.result.inputTokens},
            ${input.result.outputTokens},
            0
          )
        `;

        for (const [index, claim] of input.result.claims.entries()) {
          if (claim.assertionIds.length === 0) {
            throw new Error("A terminal Claim has no grounding Assertion");
          }
          const claimRow = requireSingleRow(
            await transaction.$queryRaw<IdRow[]>`
              INSERT INTO claims (
                tenant_id, location_id, review_session_id,
                generation_id, ordinal, proposition
              ) VALUES (
                ${input.tenantId}::uuid,
                ${input.locationId}::uuid,
                ${input.reviewSessionId}::uuid,
                ${input.generationId}::uuid,
                ${index + 1},
                ${claim.proposition}
              )
              RETURNING id
            `,
            "terminal Claim insert",
          );
          for (const assertionId of claim.assertionIds) {
            await transaction.$executeRaw`
              INSERT INTO claim_groundings (
                tenant_id, location_id, review_session_id,
                generation_id, claim_id, source_kind, assertion_id
              ) VALUES (
                ${input.tenantId}::uuid,
                ${input.locationId}::uuid,
                ${input.reviewSessionId}::uuid,
                ${input.generationId}::uuid,
                ${claimRow.id}::uuid,
                'ASSERTION',
                ${assertionId}::uuid
              )
            `;
          }
        }

        const draftRow = requireSingleRow(
          await transaction.$queryRaw<IdRow[]>`
            INSERT INTO drafts (
              tenant_id, location_id, review_session_id,
              originating_generation_id, status
            ) VALUES (
              ${input.tenantId}::uuid,
              ${input.locationId}::uuid,
              ${input.reviewSessionId}::uuid,
              ${input.generationId}::uuid,
              'ACTIVE'
            )
            RETURNING id
          `,
          "terminal Draft insert",
        );
        await transaction.$executeRaw`
          INSERT INTO draft_revisions (
            tenant_id, location_id, review_session_id, draft_id,
            source_generation_id, revision, author, text, content_hash,
            annotations
          ) VALUES (
            ${input.tenantId}::uuid,
            ${input.locationId}::uuid,
            ${input.reviewSessionId}::uuid,
            ${draftRow.id}::uuid,
            ${input.generationId}::uuid,
            1,
            'GENERATION',
            ${input.result.draft},
            encode(digest(${input.result.draft}, 'sha256'), 'hex'),
            '{}'::jsonb
          )
        `;
        const terminalLeases = await transaction.$executeRaw`
          UPDATE execution_leases
          SET state = 'TERMINAL', terminal_at = clock_timestamp()
          WHERE id = ${input.leaseId}::uuid
            AND tenant_id = ${input.tenantId}::uuid
            AND location_id = ${input.locationId}::uuid
            AND review_session_id = ${input.reviewSessionId}::uuid
            AND generation_batch_id = ${input.generationBatchId}::uuid
            AND generation_id = ${input.generationId}::uuid
            AND permit_jti = ${input.permitJti}
            AND state = 'RUNNING'
        `;
        if (terminalLeases !== 1) {
          throw new Error("Execution Lease is not terminally claimable");
        }

        return {
          draft: {
            id: draftRow.id,
            generationId: input.generationId,
            revision: 1,
            text: input.result.draft,
          },
          actualCostMicros: 0,
        };
      });
    },

    async reject(input) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const failedAttempts = await transaction.$executeRaw`
          UPDATE provider_attempts
          SET
            status = 'FAILED',
            error_code = ${input.code},
            cost_micros = 0,
            finished_at = clock_timestamp()
          WHERE id = ${input.attemptId}::uuid
            AND execution_lease_id = ${input.leaseId}::uuid
            AND tenant_id = ${input.tenantId}::uuid
            AND location_id = ${input.locationId}::uuid
            AND review_session_id = ${input.reviewSessionId}::uuid
            AND generation_id = ${input.generationId}::uuid
            AND status = 'RUNNING'
        `;
        if (failedAttempts !== 1) {
          throw new Error("Provider Attempt is not rejectable");
        }

        const generationStatus =
          input.code === "PROVIDER_UNAVAILABLE" ? "PROVIDER_ERROR" : "REJECTED";
        await transaction.$executeRaw`
          INSERT INTO generations (
            id, tenant_id, location_id, review_session_id,
            generation_batch_id, execution_lease_id, snapshot_id,
            prompt_version_id, review_format_version_id, action, status,
            provider_output, grounded_output, grounding_verdict, policy_result,
            total_input_tokens, total_output_tokens, total_cost_micros
          ) VALUES (
            ${input.generationId}::uuid,
            ${input.tenantId}::uuid,
            ${input.locationId}::uuid,
            ${input.reviewSessionId}::uuid,
            ${input.generationBatchId}::uuid,
            ${input.leaseId}::uuid,
            ${input.snapshotId}::uuid,
            ${input.promptVersionId}::uuid,
            ${input.reviewFormatVersionId}::uuid,
            ${input.action}::generation_action,
            ${generationStatus}::generation_status,
            NULL,
            NULL,
            'REJECTED',
            ${JSON.stringify({ code: input.code, retryable: input.retryable })}::jsonb,
            0,
            0,
            0
          )
        `;
        const terminalLeases = await transaction.$executeRaw`
          UPDATE execution_leases
          SET state = 'TERMINAL', terminal_at = clock_timestamp()
          WHERE id = ${input.leaseId}::uuid
            AND tenant_id = ${input.tenantId}::uuid
            AND location_id = ${input.locationId}::uuid
            AND review_session_id = ${input.reviewSessionId}::uuid
            AND generation_batch_id = ${input.generationBatchId}::uuid
            AND generation_id = ${input.generationId}::uuid
            AND permit_jti = ${input.permitJti}
            AND state = 'RUNNING'
        `;
        if (terminalLeases !== 1) {
          throw new Error("Execution Lease is not terminally rejectable");
        }
        return { actualCostMicros: 0 };
      });
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}
