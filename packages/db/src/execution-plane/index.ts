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

interface PrepareLeaseRow {
  readonly outcome: "leased" | "existing";
  readonly lease_id: string;
  readonly lease_expires_at: Date;
}

interface ClaimAttemptRow {
  readonly outcome: "claimed" | "existing";
  readonly attempt_id: string;
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
