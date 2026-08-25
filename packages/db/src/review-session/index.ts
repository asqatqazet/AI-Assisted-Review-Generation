import { Prisma, PrismaClient } from "../generated/admission/index.js";

export type ReviewSessionJourneyPhase =
  | "facts"
  | "paraphrase-input"
  | "format"
  | "results"
  | "editing"
  | "done";

export interface StoredReviewSessionProgress {
  readonly epoch: number;
  readonly phase: ReviewSessionJourneyPhase;
  readonly selectedFactOptionIds: readonly string[];
  readonly customerAssertion: string;
  readonly sourceText: string;
  readonly selectedReviewFormatId: string | null;
}

export interface StoredReviewerDraftProjection {
  readonly id: string;
  readonly generationId: string;
  readonly revision: number;
  readonly text: string;
  readonly systemAnnotations: {
    readonly kind: "assisted-review-disclosure";
    readonly text: string;
    readonly policyVersionId: string;
  }[];
}

export interface ReviewSessionProgressInput {
  readonly phase: ReviewSessionJourneyPhase;
  readonly selectedFactOptionIds: readonly string[];
  readonly customerAssertion: string;
  readonly sourceText: string;
  readonly selectedReviewFormatId: string | null;
}

export interface PostgresReviewSessionProgressStore {
  read(input: {
    readonly routeHandleHash: string;
    readonly browserCapabilityHash: string;
  }): Promise<
    | {
        readonly status: "ready";
        readonly progress: StoredReviewSessionProgress;
        readonly drafts: readonly StoredReviewerDraftProjection[];
      }
    | { readonly status: "unavailable" }
  >;
  save(input: {
    readonly routeHandleHash: string;
    readonly browserCapabilityHash: string;
    readonly expectedEpoch: number;
    readonly progress: ReviewSessionProgressInput;
  }): Promise<
    | { readonly status: "saved"; readonly progress: StoredReviewSessionProgress }
    | {
        readonly status: "conflict";
        readonly progress: StoredReviewSessionProgress;
      }
    | { readonly status: "unavailable" }
  >;
  forget(input: {
    readonly routeHandleHash: string;
    readonly browserCapabilityHash: string;
  }): Promise<{ readonly status: "forgotten" | "unavailable" }>;
  disconnect(): Promise<void>;
}

interface BindingRow {
  readonly tenant_id: string;
  readonly location_id: string;
  readonly review_session_id: string;
}

interface SessionProgressRow {
  readonly session_version: number;
  readonly journey_phase: string;
  readonly selected_fact_option_ids: readonly string[];
  readonly customer_assertion: string;
  readonly source_text: string;
  readonly selected_review_format_version_id: string | null;
  readonly selected_action: string;
  readonly tenant_policy: unknown;
}

interface DraftRow {
  readonly draft_id: string;
  readonly generation_id: string;
  readonly revision: number;
  readonly text: string;
  readonly annotations: unknown;
}

const systemAnnotationsFrom = (
  value: unknown,
): StoredReviewerDraftProjection["systemAnnotations"] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored Draft annotations are invalid");
  }
  const envelope = value as Readonly<Record<string, unknown>>;
  if (Object.keys(envelope).length === 0) {
    return [];
  }
  const candidates = envelope["systemAnnotations"];
  if (!Array.isArray(candidates)) {
    throw new Error("Stored Draft annotations are invalid");
  }
  return candidates.map((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      throw new Error("Stored Draft annotations are invalid");
    }
    const annotation = candidate as Readonly<Record<string, unknown>>;
    if (
      annotation["kind"] !== "assisted-review-disclosure" ||
      typeof annotation["text"] !== "string" ||
      typeof annotation["policyVersionId"] !== "string"
    ) {
      throw new Error("Stored Draft annotations are invalid");
    }
    return {
      kind: "assisted-review-disclosure" as const,
      text: annotation["text"],
      policyVersionId: annotation["policyVersionId"],
    };
  });
};

const toPhase = (value: string): ReviewSessionJourneyPhase | undefined => {
  switch (value) {
    case "FACTS":
      return "facts";
    case "PARAPHRASE_INPUT":
      return "paraphrase-input";
    case "FORMAT":
      return "format";
    case "RESULTS":
      return "results";
    case "EDITING":
      return "editing";
    case "DONE":
      return "done";
    default:
      return undefined;
  }
};

const toStoredProgress = (
  row: SessionProgressRow,
): StoredReviewSessionProgress | undefined => {
  const phase = toPhase(row.journey_phase);
  if (phase === undefined) {
    return undefined;
  }
  return {
    epoch: row.session_version,
    phase,
    selectedFactOptionIds: [...row.selected_fact_option_ids],
    customerAssertion: row.customer_assertion,
    sourceText: row.source_text,
    selectedReviewFormatId: row.selected_review_format_version_id,
  };
};

const policyInteger = (
  policy: unknown,
  key: string,
  fallback: number,
): number => {
  if (typeof policy !== "object" || policy === null || Array.isArray(policy)) {
    return fallback;
  }
  const value = (policy as Readonly<Record<string, unknown>>)[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
};

const databasePhase = (phase: ReviewSessionJourneyPhase): string =>
  phase.replace("-", "_").toUpperCase();

export function createPostgresReviewSessionProgressStore({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): PostgresReviewSessionProgressStore {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Review Session database URL is required");
  }
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  const resolveBinding = async (
    routeHandleHash: string,
    browserCapabilityHash: string,
  ): Promise<BindingRow | undefined> =>
    (
      await client.$queryRaw<BindingRow[]>`
        SELECT tenant_id, location_id, review_session_id
        FROM touch_live_review_session_browser_binding(
          ${routeHandleHash}, ${browserCapabilityHash}
        )
      `
    )[0];

  const readSession = async (
    transaction: Prisma.TransactionClient,
    binding: BindingRow,
    lock: boolean,
  ): Promise<SessionProgressRow | undefined> => {
    // Only the mutable Review Session row participates in the progress CAS.
    // Locking every joined table would require the reviewer runtime to receive
    // UPDATE authority over immutable Tenant/Location scope rows.
    const lockSql = lock ? Prisma.sql`FOR UPDATE OF session` : Prisma.empty;
    return (
      await transaction.$queryRaw<SessionProgressRow[]>`
        SELECT
          session.session_version,
          session.journey_phase::text,
          session.selected_fact_option_ids::text[],
          session.customer_assertion,
          session.source_text,
          session.selected_review_format_version_id::text,
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
          AND tenant.status = 'ACTIVE'
          AND location.status = 'ACTIVE'
        ${lockSql}
      `
    )[0];
  };

  const withTenant = async <Result>(
    binding: BindingRow,
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> =>
    await client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT set_config('app.tenant_id', ${binding.tenant_id}, true)
      `;
      return await operation(transaction);
    });

  return {
    async read(input) {
      const binding = await resolveBinding(
        input.routeHandleHash,
        input.browserCapabilityHash,
      );
      if (binding === undefined) {
        return { status: "unavailable" };
      }
      return await withTenant(binding, async (transaction) => {
        const row = await readSession(transaction, binding, false);
        if (row === undefined) {
          return { status: "unavailable" } as const;
        }
        const progress = toStoredProgress(row);
        if (progress === undefined) {
          return { status: "unavailable" } as const;
        }
        const drafts = await transaction.$queryRaw<DraftRow[]>`
          SELECT
            draft.id AS draft_id,
            draft.originating_generation_id AS generation_id,
            revision.revision,
            revision.text,
            revision.annotations
          FROM drafts AS draft
          JOIN LATERAL (
            SELECT stored.revision, stored.text, stored.annotations
            FROM draft_revisions AS stored
            WHERE stored.draft_id = draft.id
              AND stored.tenant_id = draft.tenant_id
              AND stored.location_id = draft.location_id
              AND stored.review_session_id = draft.review_session_id
            ORDER BY stored.revision DESC
            LIMIT 1
          ) AS revision ON true
          WHERE draft.tenant_id = ${binding.tenant_id}::uuid
            AND draft.location_id = ${binding.location_id}::uuid
            AND draft.review_session_id = ${binding.review_session_id}::uuid
            AND draft.status = 'ACTIVE'
          ORDER BY draft.created_at, draft.id
          LIMIT 20
        `;
        return {
          status: "ready" as const,
          progress,
          drafts: drafts.map((draft) => ({
            id: draft.draft_id,
            generationId: draft.generation_id,
            revision: draft.revision,
            text: draft.text,
            systemAnnotations: systemAnnotationsFrom(draft.annotations),
          })),
        };
      });
    },

    async save(input) {
      if (
        input.expectedEpoch < 1 ||
        input.progress.customerAssertion.length > 5_000 ||
        input.progress.sourceText.length > 10_000 ||
        input.progress.selectedFactOptionIds.length > 100 ||
        new Set(input.progress.selectedFactOptionIds).size !==
          input.progress.selectedFactOptionIds.length
      ) {
        return { status: "unavailable" };
      }
      const binding = await resolveBinding(
        input.routeHandleHash,
        input.browserCapabilityHash,
      );
      if (binding === undefined) {
        return { status: "unavailable" };
      }
      return await withTenant(binding, async (transaction) => {
        const current = await readSession(transaction, binding, true);
        if (current === undefined) {
          return { status: "unavailable" } as const;
        }
        const currentProgress = toStoredProgress(current);
        if (currentProgress === undefined) {
          return { status: "unavailable" } as const;
        }
        if (current.session_version !== input.expectedEpoch) {
          return { status: "conflict" as const, progress: currentProgress };
        }

        const maximumAssertionChars = policyInteger(
          current.tenant_policy,
          "maximumCustomerAssertionChars",
          500,
        );
        if (input.progress.customerAssertion.length > maximumAssertionChars) {
          return { status: "unavailable" } as const;
        }
        const selectedIds = input.progress.selectedFactOptionIds;
        if (selectedIds.length > 0) {
          const facts = await transaction.$queryRaw<{ readonly id: string }[]>`
            SELECT id
            FROM fact_option_versions
            WHERE tenant_id = ${binding.tenant_id}::uuid
              AND id::text IN (${Prisma.join(selectedIds)})
              AND (location_id IS NULL OR location_id = ${binding.location_id}::uuid)
              AND is_active = true
              AND retired_at IS NULL
          `;
          if (facts.length !== selectedIds.length) {
            return { status: "unavailable" } as const;
          }
        }

        const action = current.selected_action;
        const phaseRequiresConfirmedInput = ![
          "facts",
          "paraphrase-input",
        ].includes(input.progress.phase);
        if (
          (action === "GENERATE" &&
            input.progress.phase === "paraphrase-input") ||
          (action === "PARAPHRASE" && input.progress.phase === "facts")
        ) {
          return { status: "unavailable" } as const;
        }
        if (phaseRequiresConfirmedInput) {
          if (action === "GENERATE") {
            const minimumFacts = policyInteger(
              current.tenant_policy,
              "minimumFactSelections",
              1,
            );
            if (
              input.progress.customerAssertion.trim().length === 0 &&
              selectedIds.length < minimumFacts
            ) {
              return { status: "unavailable" } as const;
            }
          } else if (
            action === "PARAPHRASE" &&
            input.progress.sourceText.trim().length < 20
          ) {
            return { status: "unavailable" } as const;
          }
        }

        if (input.progress.selectedReviewFormatId !== null) {
          const compatible = await transaction.$queryRaw<
            { readonly id: string }[]
          >`
            SELECT format.id
            FROM review_format_versions AS format
            JOIN review_format_enablements AS enablement
              ON enablement.review_format_version_id = format.id
             AND enablement.tenant_id = ${binding.tenant_id}::uuid
            JOIN tenant_action_enablements AS action_enablement
              ON action_enablement.tenant_id = enablement.tenant_id
             AND action_enablement.action = ${action}::generation_action
            WHERE format.id = ${input.progress.selectedReviewFormatId}::uuid
              AND format.status = 'ACTIVE'
              AND enablement.enabled = true
              AND action_enablement.enabled = true
              AND format.supported_actions @> ARRAY[${action}::generation_action]
              AND enablement.allowed_actions @> ARRAY[${action}::generation_action]
            LIMIT 1
          `;
          if (compatible[0] === undefined) {
            return { status: "unavailable" } as const;
          }
        }

        const selectedIdsSql =
          selectedIds.length === 0
            ? Prisma.sql`ARRAY[]::uuid[]`
            : Prisma.sql`ARRAY[${Prisma.join(selectedIds)}]::uuid[]`;
        const updated = await transaction.$queryRaw<SessionProgressRow[]>`
          UPDATE review_sessions
          SET
            session_version = session_version + 1,
            journey_phase = ${databasePhase(input.progress.phase)}::review_session_journey_phase,
            selected_fact_option_ids = ${selectedIdsSql},
            customer_assertion = ${input.progress.customerAssertion},
            source_text = ${input.progress.sourceText},
            selected_review_format_version_id = ${input.progress.selectedReviewFormatId}::uuid
          WHERE id = ${binding.review_session_id}::uuid
            AND tenant_id = ${binding.tenant_id}::uuid
            AND location_id = ${binding.location_id}::uuid
            AND session_version = ${input.expectedEpoch}
          RETURNING
            session_version,
            journey_phase::text,
            selected_fact_option_ids::text[],
            customer_assertion,
            source_text,
            selected_review_format_version_id::text,
            selected_action::text,
            '{}'::jsonb AS tenant_policy
        `;
        const progress =
          updated[0] === undefined ? undefined : toStoredProgress(updated[0]);
        return progress === undefined
          ? ({ status: "unavailable" } as const)
          : ({ status: "saved", progress } as const);
      });
    },

    async forget(input) {
      const revoked = await client.$queryRaw<BindingRow[]>`
        SELECT tenant_id, location_id, review_session_id
        FROM revoke_live_review_session_browser_binding(
          ${input.routeHandleHash}, ${input.browserCapabilityHash}
        )
      `;
      return revoked[0] === undefined
        ? ({ status: "unavailable" } as const)
        : ({ status: "forgotten" } as const);
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}
