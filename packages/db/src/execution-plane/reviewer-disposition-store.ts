import { createHash } from "node:crypto";

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

export interface RecordReviewerDraftRevisionInput {
  readonly tenantId: string;
  readonly locationId: string;
  readonly reviewSessionId: string;
  readonly draftId: string;
  readonly generationId: string;
  readonly expectedRevision: number;
  readonly textHash: string;
  readonly idempotencyKey: string;
  readonly permitJti: string;
  readonly text: string;
}

export interface StoredDraftSystemAnnotation {
  readonly kind: "assisted-review-disclosure";
  readonly text: string;
  readonly policyVersionId: string;
}

export interface PostgresReviewerDispositionStore {
  readOriginal(input: {
    readonly tenantId: string;
    readonly locationId: string;
    readonly reviewSessionId: string;
    readonly draftId: string;
    readonly generationId: string;
  }): Promise<{
    readonly text: string;
    readonly systemAnnotations: readonly StoredDraftSystemAnnotation[];
  }>;
  record(input: RecordReviewerDispositionInput): Promise<{
    readonly kind: "accepted" | "edited";
    readonly revision: number;
    readonly normalizedEditDistance: number;
  }>;
  saveRevision(input: RecordReviewerDraftRevisionInput): Promise<{
    readonly status: "recorded" | "conflict";
    readonly revision: number;
  }>;
  disconnect(): Promise<void>;
}

interface DraftRevisionRow {
  readonly id: string;
  readonly revision: number;
  readonly text: string;
  readonly annotations: unknown;
}

const requireSingle = <Row>(rows: readonly Row[], label: string): Row => {
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error(`${label} is unavailable`);
  }
  return rows[0];
};

const parseSystemAnnotations = (
  value: unknown,
): readonly StoredDraftSystemAnnotation[] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Draft system annotations are invalid");
  }
  const envelope = value as Readonly<Record<string, unknown>>;
  if (Object.keys(envelope).length === 0) {
    return [];
  }
  if (
    Object.keys(envelope).length !== 1 ||
    !("systemAnnotations" in envelope)
  ) {
    throw new Error("Draft system annotations are invalid");
  }
  const candidates = envelope["systemAnnotations"];
  if (!Array.isArray(candidates)) {
    throw new Error("Draft system annotations are invalid");
  }
  return candidates.map((candidate) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      throw new Error("Draft system annotations are invalid");
    }
    const annotation = candidate as Readonly<Record<string, unknown>>;
    if (
      Object.keys(annotation).length !== 3 ||
      annotation["kind"] !== "assisted-review-disclosure" ||
      typeof annotation["text"] !== "string" ||
      annotation["text"].trim().length === 0 ||
      typeof annotation["policyVersionId"] !== "string"
      || annotation["policyVersionId"].trim().length === 0
    ) {
      throw new Error("Draft system annotations are invalid");
    }
    return {
      kind: "assisted-review-disclosure" as const,
      text: annotation["text"],
      policyVersionId: annotation["policyVersionId"],
    };
  });
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
    async saveRevision(input) {
      const actualTextHash = `sha256:${createHash("sha256")
        .update(input.text)
        .digest("hex")}`;
      if (
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 1 ||
        input.text.trim().length === 0 ||
        input.text.length > 10_000 ||
        input.textHash !== actualTextHash
      ) {
        throw new Error("Reviewer Draft revision is invalid");
      }

      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const current = requireSingle(
          await transaction.$queryRaw<DraftRevisionRow[]>`
            SELECT revision.id, revision.revision, revision.text, revision.annotations
            FROM drafts AS draft
            JOIN generations AS generation
              ON generation.id = draft.originating_generation_id
             AND generation.tenant_id = draft.tenant_id
             AND generation.location_id = draft.location_id
             AND generation.review_session_id = draft.review_session_id
            JOIN LATERAL (
              SELECT stored.id, stored.revision, stored.text, stored.annotations
              FROM draft_revisions AS stored
              WHERE stored.draft_id = draft.id
                AND stored.tenant_id = draft.tenant_id
                AND stored.location_id = draft.location_id
                AND stored.review_session_id = draft.review_session_id
              ORDER BY stored.revision DESC
              LIMIT 1
            ) AS revision ON true
            WHERE draft.id = ${input.draftId}::uuid
              AND draft.tenant_id = ${input.tenantId}::uuid
              AND draft.location_id = ${input.locationId}::uuid
              AND draft.review_session_id = ${input.reviewSessionId}::uuid
              AND draft.status = 'ACTIVE'
              AND generation.id = ${input.generationId}::uuid
              AND generation.status = 'SUCCEEDED'
              AND generation.grounding_verdict = 'PASSED'
            FOR UPDATE OF draft
          `,
          "Grounded Draft",
        );

        const inheritedAnnotations = {
          systemAnnotations: parseSystemAnnotations(current.annotations),
        };

        if (current.text === input.text) {
          return { status: "recorded", revision: current.revision } as const;
        }
        if (current.revision !== input.expectedRevision) {
          return { status: "conflict", revision: current.revision } as const;
        }

        const recorded = requireSingle(
          await transaction.$queryRaw<DraftRevisionRow[]>`
            INSERT INTO draft_revisions (
              tenant_id, location_id, review_session_id, draft_id,
              source_generation_id, revision, author, text, content_hash,
              annotations
            ) VALUES (
              ${input.tenantId}::uuid,
              ${input.locationId}::uuid,
              ${input.reviewSessionId}::uuid,
              ${input.draftId}::uuid,
              ${input.generationId}::uuid,
              ${current.revision + 1},
              'REVIEWER',
              ${input.text},
              encode(digest(${input.text}, 'sha256'), 'hex'),
              ${JSON.stringify(inheritedAnnotations)}::jsonb
            )
            RETURNING id, revision, text, annotations
          `,
          "Reviewer Draft Revision",
        );
        return { status: "recorded", revision: recorded.revision } as const;
      });
    },

    async readOriginal(input) {
      return await client.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT set_config('app.tenant_id', ${input.tenantId}, true)
        `;
        const originals = await transaction.$queryRaw<
          { readonly text: string; readonly annotations: unknown }[]
        >`
          SELECT revision.text, revision.annotations
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
        const original = requireSingle(originals, "Grounded Draft");
        return {
          text: original.text,
          systemAnnotations: parseSystemAnnotations(original.annotations),
        };
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
          SELECT revision.id, revision.revision, revision.text, revision.annotations
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
        const inheritedAnnotations = {
          systemAnnotations: parseSystemAnnotations(original.annotations),
        };
        const kind = input.finalText === original.text ? "accepted" : "edited";

        let selected = original;
        if (kind === "edited") {
          const matching = await transaction.$queryRaw<DraftRevisionRow[]>`
            SELECT id, revision, text, annotations
            FROM draft_revisions
            WHERE draft_id = ${input.draftId}::uuid
              AND tenant_id = ${input.tenantId}::uuid
              AND location_id = ${input.locationId}::uuid
              AND review_session_id = ${input.reviewSessionId}::uuid
              AND content_hash = encode(digest(${input.finalText}, 'sha256'), 'hex')
              AND text = ${input.finalText}
              AND annotations = ${JSON.stringify(inheritedAnnotations)}::jsonb
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
                  ${JSON.stringify(inheritedAnnotations)}::jsonb
                FROM draft_revisions
                WHERE draft_id = ${input.draftId}::uuid
                  AND tenant_id = ${input.tenantId}::uuid
                  AND location_id = ${input.locationId}::uuid
                  AND review_session_id = ${input.reviewSessionId}::uuid
                RETURNING id, revision, text, annotations
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
