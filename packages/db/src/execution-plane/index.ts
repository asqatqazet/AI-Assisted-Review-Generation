import { PrismaClient } from "../generated/execution-plane/index.js";
import type { Prisma } from "../generated/execution-plane/index.js";

export * from "./reviewer-disposition-store.js";
export * from "./console-execution-projections.js";
export * from "./database-identity.js";

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

type LeaseState =
  | "no-lease"
  | "leased"
  | "running"
  | "indeterminate"
  | "cancelled"
  | "terminal";

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
    readonly providerOutput: Readonly<Record<string, unknown>>;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly providerReceipt: unknown;
  } & (
    | {
        readonly status: "completed";
        readonly draftBody: string;
        readonly systemAnnotations: readonly {
          readonly kind: "assisted-review-disclosure";
          readonly text: string;
          readonly policyVersionId: string;
        }[];
        readonly claims: readonly {
          readonly proposition: string;
          readonly assertionIds: readonly string[];
        }[];
      }
    | {
        readonly status: "rejected";
        readonly code:
          | "GROUNDING_REJECTED"
          | "POLICY_REJECTED"
          | "FORMAT_REJECTED";
        readonly retryable: false;
      }
  );
}

export type FinalizeGenerationInput = Omit<CompleteGenerationInput, "result">;

export interface ProviderAttemptRecoveryInput extends GenerationExecutionScope {
  readonly leaseId: string;
  readonly attemptId: string;
}

export type ProviderAttemptRecoveryState =
  | { readonly state: "none" }
  | { readonly state: "checkpointed" }
  | { readonly state: "indeterminate" };

export type RecoverGenerationByScopeInput = Omit<
  FinalizeGenerationInput,
  "leaseId" | "attemptId"
>;

export type RecoverGenerationByScopeResult =
  | { readonly state: "none" | "indeterminate" }
  | {
      readonly state: "completed";
      readonly leaseId: string;
      readonly terminal: PersistedGenerationTerminal;
    };

export type MarkProviderAttemptIndeterminateResult =
  | { readonly state: "indeterminate" }
  | { readonly state: "checkpointed" }
  | { readonly state: "terminal" };

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
    readonly systemAnnotations: {
      readonly kind: "assisted-review-disclosure";
      readonly text: string;
      readonly policyVersionId: string;
    }[];
  };
  readonly actualCostMicros: number;
}

export interface PersistedTerminalRejection {
  readonly rejection: {
    readonly code:
      | "GROUNDING_REJECTED"
      | "POLICY_REJECTED"
      | "FORMAT_REJECTED"
      | "PROVIDER_UNAVAILABLE";
    readonly retryable: boolean;
  };
  readonly actualCostMicros: number;
}

export type PersistedGenerationTerminal =
  | PersistedTerminalDraft
  | PersistedTerminalRejection;

export interface PostgresGenerationTerminalStore {
  read(
    scope: GenerationExecutionScope,
  ): Promise<PersistedGenerationTerminal | null>;
  checkpoint(input: CompleteGenerationInput): Promise<void>;
  complete(input: FinalizeGenerationInput): Promise<PersistedGenerationTerminal>;
  recoveryState(
    input: ProviderAttemptRecoveryInput,
  ): Promise<ProviderAttemptRecoveryState>;
  recoverByScope(
    input: RecoverGenerationByScopeInput,
  ): Promise<RecoverGenerationByScopeResult>;
  markIndeterminate(
    input: ProviderAttemptRecoveryInput & {
      readonly code: "PROVIDER_RESULT_INDETERMINATE";
    },
  ): Promise<MarkProviderAttemptIndeterminateResult>;
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

interface TerminalProjectionRow {
  readonly generation_status: string;
  readonly policy_result: unknown;
  readonly draft_id: string | null;
  readonly generation_id: string;
  readonly revision: number | null;
  readonly text: string | null;
  readonly annotations: unknown | null;
  readonly total_cost_micros: bigint;
}

interface IdRow {
  readonly id: string;
}

interface RecoveryTargetRow {
  readonly lease_id: string;
  readonly attempt_id: string;
}

interface ProviderAttemptCheckpointRow {
  readonly status: string;
  readonly provider_output: unknown | null;
  readonly provider_response: unknown | null;
  readonly result_checkpoint: unknown | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
}

type PersistedSystemAnnotation =
  PersistedTerminalDraft["draft"]["systemAnnotations"][number];

type PersistedResultCheckpoint =
  | {
      readonly status: "completed";
      readonly draftBody: string;
      readonly systemAnnotations: PersistedSystemAnnotation[];
      readonly claims: readonly {
        readonly proposition: string;
        readonly assertionIds: readonly string[];
      }[];
    }
  | {
      readonly status: "rejected";
      readonly code:
        | "GROUNDING_REJECTED"
        | "POLICY_REJECTED"
        | "FORMAT_REJECTED";
      readonly retryable: false;
    };

function requireSingleRow<Row>(rows: readonly Row[], operation: string): Row {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`${operation} returned an invalid row count`);
  }
  return rows[0];
}

function isLeaseState(value: string): value is LeaseState {
  return [
    "no-lease",
    "leased",
    "running",
    "indeterminate",
    "cancelled",
    "terminal",
  ].includes(value);
}

function requireLeaseState(value: string): LeaseState {
  if (!isLeaseState(value)) {
    throw new Error("Lease journal returned an invalid state");
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonText(value: unknown, label: string): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (_key, candidate: unknown) => {
      if (typeof candidate === "number" && !Number.isFinite(candidate)) {
        throw new Error(`${label} contains a non-finite number`);
      }
      if (
        typeof candidate === "bigint" ||
        typeof candidate === "function" ||
        typeof candidate === "symbol" ||
        typeof candidate === "undefined"
      ) {
        throw new Error(`${label} is not JSON data`);
      }
      return candidate;
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(`${label} is not JSON data`);
  }
  if (serialized === undefined) {
    throw new Error(`${label} is not JSON data`);
  }
  return serialized;
}

function parseSystemAnnotations(value: unknown): PersistedSystemAnnotation[] {
  if (!isRecord(value)) {
    throw new Error("Draft system annotations are invalid");
  }
  if (Object.keys(value).length === 0) {
    return [];
  }
  if (!Array.isArray(value["systemAnnotations"])) {
    throw new Error("Draft system annotations are invalid");
  }
  const annotations = value["systemAnnotations"].map((candidate) => {
    if (
      !isRecord(candidate) ||
      candidate["kind"] !== "assisted-review-disclosure" ||
      typeof candidate["text"] !== "string" ||
      candidate["text"].trim().length === 0 ||
      typeof candidate["policyVersionId"] !== "string" ||
      candidate["policyVersionId"].trim().length === 0
    ) {
      throw new Error("Draft system annotations are invalid");
    }
    return {
      kind: "assisted-review-disclosure" as const,
      text: candidate["text"],
      policyVersionId: candidate["policyVersionId"],
    };
  });
  return annotations;
}

function parseResultCheckpoint(value: unknown): PersistedResultCheckpoint {
  if (!isRecord(value)) {
    throw new Error("Provider result checkpoint is invalid");
  }
  if (value["status"] === "rejected") {
    const code = value["code"];
    if (
      !["GROUNDING_REJECTED", "POLICY_REJECTED", "FORMAT_REJECTED"].includes(
        code as string,
      ) ||
      value["retryable"] !== false
    ) {
      throw new Error("Provider result checkpoint is invalid");
    }
    return {
      status: "rejected",
      code: code as Extract<
        PersistedResultCheckpoint,
        { readonly status: "rejected" }
      >["code"],
      retryable: false,
    };
  }
  if (
    value["status"] !== "completed" ||
    typeof value["draftBody"] !== "string" ||
    value["draftBody"].trim().length === 0 ||
    value["draftBody"].length > 10_000 ||
    !Array.isArray(value["claims"])
  ) {
    throw new Error("Provider result checkpoint is invalid");
  }
  const systemAnnotations = parseSystemAnnotations({
    systemAnnotations: value["systemAnnotations"],
  });
  const claims = value["claims"].map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate["proposition"] !== "string" ||
      candidate["proposition"].trim().length === 0 ||
      !Array.isArray(candidate["assertionIds"]) ||
      candidate["assertionIds"].length === 0 ||
      !candidate["assertionIds"].every(
        (assertionId) =>
          typeof assertionId === "string" && assertionId.trim().length > 0,
      ) ||
      new Set(candidate["assertionIds"]).size !== candidate["assertionIds"].length
    ) {
      throw new Error("Provider result checkpoint is invalid");
    }
    return {
      proposition: candidate["proposition"],
      assertionIds: candidate["assertionIds"] as readonly string[],
    };
  });
  if (claims.length === 0) {
    throw new Error("Provider result checkpoint is invalid");
  }
  return {
    status: "completed",
    draftBody: value["draftBody"],
    systemAnnotations,
    claims,
  };
}

function checkpointFromResult(
  result: CompleteGenerationInput["result"],
): PersistedResultCheckpoint {
  if (
    !isRecord(result.providerOutput) ||
    !Number.isSafeInteger(result.inputTokens) ||
    result.inputTokens < 0 ||
    !Number.isSafeInteger(result.outputTokens) ||
    result.outputTokens < 0
  ) {
    throw new Error("Provider result checkpoint is invalid");
  }
  jsonText(result.providerOutput, "Provider output");
  jsonText(result.providerReceipt, "Provider receipt");
  return parseResultCheckpoint(
    result.status === "completed"
      ? {
          status: "completed",
          draftBody: result.draftBody,
          systemAnnotations: result.systemAnnotations,
          claims: result.claims,
        }
      : {
          status: "rejected",
          code: result.code,
          retryable: false,
        },
  );
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

  const projectRead = (
    row: TerminalProjectionRow,
  ): PersistedGenerationTerminal => {
    const actualCostMicros = Number(row.total_cost_micros);
    if (!Number.isSafeInteger(actualCostMicros)) {
      throw new Error("Terminal Generation cost is invalid");
    }
    if (
      row.generation_status === "SUCCEEDED" &&
      row.draft_id !== null &&
      row.revision === 1 &&
      row.text !== null &&
      row.annotations !== null
    ) {
      return {
        draft: {
          id: row.draft_id,
          generationId: row.generation_id,
          revision: 1,
          text: row.text,
          systemAnnotations: parseSystemAnnotations(row.annotations),
        },
        actualCostMicros,
      };
    }
    const policy =
      typeof row.policy_result === "object" && row.policy_result !== null
        ? (row.policy_result as Readonly<Record<string, unknown>>)
        : {};
    const code = policy["code"];
    const retryable = policy["retryable"];
    if (
      ![
        "GROUNDING_REJECTED",
        "POLICY_REJECTED",
        "FORMAT_REJECTED",
        "PROVIDER_UNAVAILABLE",
      ].includes(code as string) ||
      typeof retryable !== "boolean" ||
      row.draft_id !== null
    ) {
      throw new Error("Rejected terminal Generation projection is invalid");
    }
    return {
      rejection: {
        code: code as PersistedTerminalRejection["rejection"]["code"],
        retryable,
      },
      actualCostMicros,
    };
  };

  const store: PostgresGenerationTerminalStore = {
    async read(scope) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${scope.tenantId}, true)
        `;
        const rows = await transaction.$queryRaw<TerminalProjectionRow[]>`
          SELECT
            generation.status::text AS generation_status,
            generation.policy_result,
            draft.id AS draft_id,
            generation.id AS generation_id,
            revision.revision,
            revision.text,
            revision.annotations,
            generation.total_cost_micros
          FROM generations AS generation
          LEFT JOIN drafts AS draft
            ON draft.originating_generation_id = generation.id
           AND draft.tenant_id = generation.tenant_id
           AND draft.location_id = generation.location_id
           AND draft.review_session_id = generation.review_session_id
          LEFT JOIN draft_revisions AS revision
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
        return rows[0] === undefined ? null : projectRead(rows[0]);
      });
    },

    async checkpoint(input) {
      const checkpoint = checkpointFromResult(input.result);
      const checkpointJson = jsonText(checkpoint, "Provider result checkpoint");
      const providerOutputJson = jsonText(
        input.result.providerOutput,
        "Provider output",
      );
      const providerReceiptJson = jsonText(
        input.result.providerReceipt,
        "Provider receipt",
      );

      await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const checkpointed = await transaction.$queryRaw<IdRow[]>`
          UPDATE provider_attempts AS attempt
          SET
            status = 'CHECKPOINTED',
            provider_output = ${providerOutputJson}::jsonb,
            provider_response = ${providerReceiptJson}::jsonb,
            result_checkpoint = ${checkpointJson}::jsonb,
            result_checkpointed_at = clock_timestamp(),
            input_tokens = ${input.result.inputTokens},
            output_tokens = ${input.result.outputTokens}
          WHERE attempt.id = ${input.attemptId}::uuid
            AND attempt.execution_lease_id = ${input.leaseId}::uuid
            AND attempt.tenant_id = ${input.tenantId}::uuid
            AND attempt.location_id = ${input.locationId}::uuid
            AND attempt.review_session_id = ${input.reviewSessionId}::uuid
            AND attempt.generation_id = ${input.generationId}::uuid
            AND attempt.status = 'RUNNING'
            AND EXISTS (
              SELECT 1
              FROM execution_leases AS lease
              WHERE lease.id = attempt.execution_lease_id
                AND lease.tenant_id = attempt.tenant_id
                AND lease.location_id = attempt.location_id
                AND lease.review_session_id = attempt.review_session_id
                AND lease.generation_batch_id = ${input.generationBatchId}::uuid
                AND lease.generation_id = attempt.generation_id
                AND lease.permit_jti = ${input.permitJti}
                AND lease.state = 'RUNNING'
            )
          RETURNING attempt.id
        `;
        if (checkpointed.length === 1) {
          return;
        }

        const exactReplay = await transaction.$queryRaw<IdRow[]>`
          SELECT attempt.id
          FROM provider_attempts AS attempt
          JOIN execution_leases AS lease
            ON lease.id = attempt.execution_lease_id
           AND lease.tenant_id = attempt.tenant_id
           AND lease.location_id = attempt.location_id
           AND lease.review_session_id = attempt.review_session_id
           AND lease.generation_id = attempt.generation_id
          WHERE attempt.id = ${input.attemptId}::uuid
            AND attempt.execution_lease_id = ${input.leaseId}::uuid
            AND attempt.tenant_id = ${input.tenantId}::uuid
            AND attempt.location_id = ${input.locationId}::uuid
            AND attempt.review_session_id = ${input.reviewSessionId}::uuid
            AND attempt.generation_id = ${input.generationId}::uuid
            AND attempt.status = 'CHECKPOINTED'
            AND attempt.provider_output = ${providerOutputJson}::jsonb
            AND attempt.provider_response = ${providerReceiptJson}::jsonb
            AND attempt.result_checkpoint = ${checkpointJson}::jsonb
            AND attempt.input_tokens = ${input.result.inputTokens}
            AND attempt.output_tokens = ${input.result.outputTokens}
            AND lease.generation_batch_id = ${input.generationBatchId}::uuid
            AND lease.permit_jti = ${input.permitJti}
            AND lease.state = 'RUNNING'
        `;
        if (exactReplay.length !== 1) {
          throw new Error("Provider result checkpoint conflicts with Attempt state");
        }
      });
    },

    async recoveryState(input) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const rows = await transaction.$queryRaw<{ readonly state: string }[]>`
          SELECT converge_generation_attempt_recovery(
            ${input.tenantId}::uuid,
            ${input.locationId}::uuid,
            ${input.reviewSessionId}::uuid,
            ${input.generationBatchId}::uuid,
            ${input.generationId}::uuid,
            ${input.permitJti}::varchar,
            ${input.leaseId}::uuid,
            ${input.attemptId}::uuid
          ) AS state
        `;
        const state = requireSingleRow(
          rows,
          "converge_generation_attempt_recovery",
        ).state;
        if (["none", "checkpointed", "indeterminate"].includes(state)) {
          return { state } as ProviderAttemptRecoveryState;
        }
        throw new Error("Provider Attempt recovery returned an invalid state");
      });
    },

    async recoverByScope(input) {
      const targets = await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        return await transaction.$queryRaw<RecoveryTargetRow[]>`
          SELECT
            lease.id::text AS lease_id,
            attempt.id::text AS attempt_id
          FROM execution_leases AS lease
          JOIN provider_attempts AS attempt
            ON attempt.execution_lease_id = lease.id
           AND attempt.tenant_id = lease.tenant_id
           AND attempt.location_id = lease.location_id
           AND attempt.review_session_id = lease.review_session_id
           AND attempt.generation_id = lease.generation_id
          WHERE lease.tenant_id = ${input.tenantId}::uuid
            AND lease.location_id = ${input.locationId}::uuid
            AND lease.review_session_id = ${input.reviewSessionId}::uuid
            AND lease.generation_batch_id = ${input.generationBatchId}::uuid
            AND lease.generation_id = ${input.generationId}::uuid
            AND lease.permit_jti = ${input.permitJti}
            AND attempt.attempt_ordinal = 1
          LIMIT 2
        `;
      });
      if (targets.length === 0) {
        return { state: "none" };
      }
      const target = requireSingleRow(targets, "Provider Attempt recovery target");
      const fencedInput = {
        ...input,
        leaseId: target.lease_id,
        attemptId: target.attempt_id,
      };
      const existing = await store.read(input);
      if (existing !== null) {
        return {
          state: "completed",
          leaseId: target.lease_id,
          terminal: existing,
        };
      }
      const recovery = await store.recoveryState(fencedInput);
      if (recovery.state === "checkpointed") {
        return {
          state: "completed",
          leaseId: target.lease_id,
          terminal: await store.complete(fencedInput),
        };
      }
      if (recovery.state === "indeterminate") {
        return recovery;
      }
      const racedTerminal = await store.read(input);
      return racedTerminal === null
        ? recovery
        : {
            state: "completed",
            leaseId: target.lease_id,
            terminal: racedTerminal,
          };
    },

    async markIndeterminate(input) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const marked = await transaction.$queryRaw<IdRow[]>`
          UPDATE provider_attempts AS attempt
          SET
            status = 'TIMED_OUT',
            error_code = ${input.code},
            finished_at = clock_timestamp()
          WHERE attempt.id = ${input.attemptId}::uuid
            AND attempt.execution_lease_id = ${input.leaseId}::uuid
            AND attempt.tenant_id = ${input.tenantId}::uuid
            AND attempt.location_id = ${input.locationId}::uuid
            AND attempt.review_session_id = ${input.reviewSessionId}::uuid
            AND attempt.generation_id = ${input.generationId}::uuid
            AND attempt.status = 'RUNNING'
            AND EXISTS (
              SELECT 1
              FROM execution_leases AS lease
              WHERE lease.id = attempt.execution_lease_id
                AND lease.generation_batch_id = ${input.generationBatchId}::uuid
                AND lease.permit_jti = ${input.permitJti}
                AND lease.state = 'RUNNING'
            )
          RETURNING attempt.id
        `;
        if (marked.length === 1) {
          return { state: "indeterminate" } as const;
        }
        const existing = await transaction.$queryRaw<
          {
            readonly status: string;
            readonly error_code: string | null;
            readonly lease_state: string;
          }[]
        >`
          SELECT
            attempt.status::text AS status,
            attempt.error_code,
            lease.state::text AS lease_state
          FROM provider_attempts AS attempt
          JOIN execution_leases AS lease
            ON lease.id = attempt.execution_lease_id
          WHERE attempt.id = ${input.attemptId}::uuid
            AND attempt.execution_lease_id = ${input.leaseId}::uuid
            AND attempt.tenant_id = ${input.tenantId}::uuid
            AND attempt.location_id = ${input.locationId}::uuid
            AND attempt.review_session_id = ${input.reviewSessionId}::uuid
            AND attempt.generation_id = ${input.generationId}::uuid
            AND lease.generation_batch_id = ${input.generationBatchId}::uuid
            AND lease.permit_jti = ${input.permitJti}
        `;
        const current = existing[0];
        if (
          current?.status === "TIMED_OUT" &&
          current.error_code === input.code
        ) {
          return { state: "indeterminate" } as const;
        }
        if (current?.status === "CHECKPOINTED") {
          return { state: "checkpointed" } as const;
        }
        if (current?.lease_state === "TERMINAL") {
          return { state: "terminal" } as const;
        }
        throw new Error("Provider Attempt cannot be marked indeterminate");
      });
    },

    async complete(input) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const terminalizeLease = async (): Promise<void> => {
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
        };
        const existing = await transaction.$queryRaw<TerminalProjectionRow[]>`
          SELECT
            generation.status::text AS generation_status,
            generation.policy_result,
            draft.id AS draft_id,
            generation.id AS generation_id,
            revision.revision,
            revision.text,
            revision.annotations,
            generation.total_cost_micros
          FROM generations AS generation
          LEFT JOIN drafts AS draft
            ON draft.originating_generation_id = generation.id
           AND draft.tenant_id = generation.tenant_id
           AND draft.location_id = generation.location_id
           AND draft.review_session_id = generation.review_session_id
          LEFT JOIN draft_revisions AS revision
            ON revision.draft_id = draft.id
           AND revision.tenant_id = draft.tenant_id
           AND revision.location_id = draft.location_id
           AND revision.review_session_id = draft.review_session_id
           AND revision.revision = 1
          WHERE generation.id = ${input.generationId}::uuid
            AND generation.tenant_id = ${input.tenantId}::uuid
            AND generation.location_id = ${input.locationId}::uuid
            AND generation.review_session_id = ${input.reviewSessionId}::uuid
            AND generation.generation_batch_id = ${input.generationBatchId}::uuid
            AND generation.execution_lease_id = ${input.leaseId}::uuid
            AND EXISTS (
              SELECT 1
              FROM execution_leases AS lease
              WHERE lease.id = generation.execution_lease_id
                AND lease.permit_jti = ${input.permitJti}
                AND lease.state = 'TERMINAL'
            )
        `;
        if (existing[0] !== undefined) {
          return projectRead(existing[0]);
        }

        const attempt = requireSingleRow(
          await transaction.$queryRaw<ProviderAttemptCheckpointRow[]>`
            SELECT
              status::text AS status,
              provider_output,
              provider_response,
              result_checkpoint,
              input_tokens,
              output_tokens
            FROM provider_attempts
            WHERE id = ${input.attemptId}::uuid
              AND execution_lease_id = ${input.leaseId}::uuid
              AND tenant_id = ${input.tenantId}::uuid
              AND location_id = ${input.locationId}::uuid
              AND review_session_id = ${input.reviewSessionId}::uuid
              AND generation_id = ${input.generationId}::uuid
            FOR UPDATE
          `,
          "Provider result checkpoint",
        );
        if (
          attempt.status !== "CHECKPOINTED" ||
          !isRecord(attempt.provider_output) ||
          attempt.result_checkpoint === null ||
          attempt.input_tokens === null ||
          attempt.output_tokens === null ||
          !Number.isSafeInteger(attempt.input_tokens) ||
          attempt.input_tokens < 0 ||
          !Number.isSafeInteger(attempt.output_tokens) ||
          attempt.output_tokens < 0
        ) {
          throw new Error("Provider result checkpoint is not finalizable");
        }
        const checkpoint = parseResultCheckpoint(attempt.result_checkpoint);
        const providerOutputJson = jsonText(
          attempt.provider_output,
          "Provider output",
        );

        if (checkpoint.status === "rejected") {
          const failedAttempts = await transaction.$executeRaw`
            UPDATE provider_attempts
            SET
              status = 'FAILED',
              error_code = ${checkpoint.code},
              cost_micros = 0,
              finished_at = clock_timestamp()
            WHERE id = ${input.attemptId}::uuid
              AND execution_lease_id = ${input.leaseId}::uuid
              AND tenant_id = ${input.tenantId}::uuid
              AND location_id = ${input.locationId}::uuid
              AND review_session_id = ${input.reviewSessionId}::uuid
              AND generation_id = ${input.generationId}::uuid
              AND status = 'CHECKPOINTED'
          `;
          if (failedAttempts !== 1) {
            throw new Error("Rejected Provider checkpoint is not terminally claimable");
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
              'REJECTED',
              ${providerOutputJson}::jsonb,
              NULL,
              'REJECTED',
              ${JSON.stringify({
                code: checkpoint.code,
                retryable: false,
              })}::jsonb,
              ${attempt.input_tokens},
              ${attempt.output_tokens},
              0
            )
          `;
          await terminalizeLease();
          return {
            rejection: {
              code: checkpoint.code,
              retryable: false,
            },
            actualCostMicros: 0,
          };
        }

        const finishedAttempts = await transaction.$executeRaw`
          UPDATE provider_attempts
          SET
            status = 'SUCCEEDED',
            cost_micros = 0,
            finished_at = clock_timestamp()
          WHERE id = ${input.attemptId}::uuid
            AND execution_lease_id = ${input.leaseId}::uuid
            AND tenant_id = ${input.tenantId}::uuid
            AND location_id = ${input.locationId}::uuid
            AND review_session_id = ${input.reviewSessionId}::uuid
            AND generation_id = ${input.generationId}::uuid
            AND status = 'CHECKPOINTED'
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
            ${providerOutputJson}::jsonb,
            ${checkpoint.draftBody},
            'PASSED',
            ${JSON.stringify({
              violations: [],
              systemAnnotations: checkpoint.systemAnnotations,
            })}::jsonb,
            ${attempt.input_tokens},
            ${attempt.output_tokens},
            0
          )
        `;

        for (const [index, claim] of checkpoint.claims.entries()) {
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
            ${checkpoint.draftBody},
            encode(digest(${checkpoint.draftBody}, 'sha256'), 'hex'),
            ${JSON.stringify({
              systemAnnotations: checkpoint.systemAnnotations,
            })}::jsonb
          )
        `;
        await terminalizeLease();

        return {
          draft: {
            id: draftRow.id,
            generationId: input.generationId,
            revision: 1,
            text: checkpoint.draftBody,
            systemAnnotations: checkpoint.systemAnnotations,
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
  return store;
}
