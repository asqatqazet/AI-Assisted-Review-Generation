import { PrismaClient } from "../generated/execution-plane/index.js";

export interface RecordReviewerDispositionInput {
  readonly tenantId: string;
  readonly locationId: string;
  readonly reviewSessionId: string;
  readonly draftId: string;
  readonly generationId: string;
  readonly finalTextHash: string;
  readonly idempotencyKey: string;
  readonly permitJti: string;
  readonly finalText: string;
  readonly normalizedEditDistance: number;
}

export interface PostgresReviewerDispositionStore {
  readOriginal(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly reviewSessionId: string;
    readonly draftId: string;
    readonly generationId: string;
  }): Promise<{ readonly text: string }>;
  record(input: RecordReviewerDispositionInput): Promise<{
    readonly kind: "accepted" | "edited";
    readonly revision: number;
    readonly normalizedEditDistance: number;
  }>;
  disconnect(): Promise<void>;
}

interface DraftRevisionRow {
  readonly id: string;
  readonly revision: number;
  readonly text: string;
}

const requireSingle = <Row>(rows: readonly Row[], label: string): Row => {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`${label} is unavailable`);
  }
  return rows[0];
};

export function createPostgresReviewerDispositionStore({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): PostgresReviewerDispositionStore {
  if (databaseUrl.trim().length === 0) {
    throw new Error("Execution database URL is required");
  }
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  return {
    async readOriginal(input) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const originals = await transaction.$queryRaw<
          { readonly text: string }[]
        >`
          SELECT revision.text
          FROM drafts AS draft
          JOIN generations AS generation
            ON generation.id = draft.originating_generation_id
           AND generation.tenant_id = draft.tenant_id
           AND generation.location_id = draft.location_id
           AND generation.review_session_id = draft.review_session_id
          JOIN draft_revisions AS revision
            ON revision.draft_id = draft.id
           AND revision.tenant_id = draft.tenant_id
           AND revision.location_id = draft.location_id
           AND revision.review_session_id = draft.review_session_id
           AND revision.revision = 1
          WHERE draft.id = ${input.draftId}::uuid
            AND draft.tenant_id = ${input.tenantId}::uuid
            AND draft.location_id = ${input.locationId}::uuid
            AND draft.review_session_id = ${input.reviewSessionId}::uuid
            AND generation.id = ${input.generationId}::uuid
            AND generation.status = 'SUCCEEDED'
            AND generation.grounding_verdict = 'PASSED'
        `;
        return { ...requireSingle(originals, "Grounded Draft") };
      });
    },

    async record(input) {
      if (
        input.finalText.trim().length === 0 ||
        input.finalText.length > 10_000 ||
        !Number.isFinite(input.normalizedEditDistance) ||
        input.normalizedEditDistance < 0 ||
        input.normalizedEditDistance > 1
      ) {
        throw new Error("Reviewer final text is invalid");
      }
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const originals = await transaction.$queryRaw<DraftRevisionRow[]>`
          SELECT revision.id, revision.revision, revision.text
          FROM drafts AS draft
          JOIN generations AS generation
            ON generation.id = draft.originating_generation_id
           AND generation.tenant_id = draft.tenant_id
           AND generation.location_id = draft.location_id
           AND generation.review_session_id = draft.review_session_id
          JOIN draft_revisions AS revision
            ON revision.draft_id = draft.id
           AND revision.tenant_id = draft.tenant_id
           AND revision.location_id = draft.location_id
           AND revision.review_session_id = draft.review_session_id
           AND revision.revision = 1
          WHERE draft.id = ${input.draftId}::uuid
            AND draft.tenant_id = ${input.tenantId}::uuid
            AND draft.location_id = ${input.locationId}::uuid
            AND draft.review_session_id = ${input.reviewSessionId}::uuid
            AND generation.id = ${input.generationId}::uuid
            AND generation.status = 'SUCCEEDED'
            AND generation.grounding_verdict = 'PASSED'
          FOR UPDATE OF draft
        `;
        const original = requireSingle(originals, "Grounded Draft");
        const kind = input.finalText === original.text ? "accepted" : "edited";

        let selected = original;
        if (kind === "edited") {
          const matching = await transaction.$queryRaw<DraftRevisionRow[]>`
            SELECT id, revision, text
            FROM draft_revisions
            WHERE draft_id = ${input.draftId}::uuid
              AND tenant_id = ${input.tenantId}::uuid
              AND location_id = ${input.locationId}::uuid
              AND review_session_id = ${input.reviewSessionId}::uuid
              AND content_hash = encode(digest(${input.finalText}, 'sha256'), 'hex')
              AND text = ${input.finalText}
            ORDER BY revision
            LIMIT 1
          `;
          selected =
            matching[0] ??
            requireSingle(
              await transaction.$queryRaw<DraftRevisionRow[]>`
                INSERT INTO draft_revisions (
                  tenant_id, location_id, review_session_id, draft_id,
                  source_generation_id, revision, author, text, content_hash,
                  annotations
                )
                SELECT
                  ${input.tenantId}::uuid,
                  ${input.locationId}::uuid,
                  ${input.reviewSessionId}::uuid,
                  ${input.draftId}::uuid,
                  ${input.generationId}::uuid,
                  COALESCE(MAX(revision), 0) + 1,
                  'REVIEWER',
                  ${input.finalText},
                  encode(digest(${input.finalText}, 'sha256'), 'hex'),
                  '{}'::jsonb
                FROM draft_revisions
                WHERE draft_id = ${input.draftId}::uuid
                  AND tenant_id = ${input.tenantId}::uuid
                  AND location_id = ${input.locationId}::uuid
                  AND review_session_id = ${input.reviewSessionId}::uuid
                RETURNING id, revision, text
              `,
              "Reviewer Draft Revision",
            );
        }

        await transaction.$executeRaw`
          INSERT INTO dispositions (
            tenant_id, location_id, review_session_id, draft_id,
            generation_id, selected_draft_revision_id, kind,
            normalized_edit_distance, created_at
          ) VALUES (
            ${input.tenantId}::uuid,
            ${input.locationId}::uuid,
            ${input.reviewSessionId}::uuid,
            ${input.draftId}::uuid,
            ${input.generationId}::uuid,
            ${selected.id}::uuid,
            ${kind === "accepted" ? "ACCEPTED" : "EDITED"}::disposition_kind,
            ${input.normalizedEditDistance},
            clock_timestamp()
          )
          ON CONFLICT (draft_id) DO UPDATE SET
            generation_id = EXCLUDED.generation_id,
            selected_draft_revision_id = EXCLUDED.selected_draft_revision_id,
            kind = EXCLUDED.kind,
            normalized_edit_distance = EXCLUDED.normalized_edit_distance,
            created_at = clock_timestamp()
          WHERE dispositions.tenant_id = EXCLUDED.tenant_id
            AND dispositions.location_id = EXCLUDED.location_id
            AND dispositions.review_session_id = EXCLUDED.review_session_id
        `;

        return {
          kind,
          revision: selected.revision,
          normalizedEditDistance: input.normalizedEditDistance,
        };
      });
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}
