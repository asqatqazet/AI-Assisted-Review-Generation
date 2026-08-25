import {
  ReviewerDraftRevisionCommandDtoSchema,
  ReviewerDraftRevisionResultDtoSchema,
  type ReviewerDraftRevisionResultDto,
} from "@review/contracts/generation";

import { readBffClientError } from "./bff-error.js";

export interface ReviewerDraftRevisionClient {
  save(input: {
    readonly reviewSessionHandle: string;
    readonly idempotencyKey: string;
    readonly draftId: string;
    readonly generationId: string;
    readonly expectedRevision: number;
    readonly text: string;
  }): Promise<ReviewerDraftRevisionResultDto>;
}

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createHttpReviewerDraftRevisionClient(
  fetchFn: typeof fetch = globalThis.fetch,
): ReviewerDraftRevisionClient {
  return {
    async save(input) {
      if (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200) {
        throw new Error("INVALID_IDEMPOTENCY_KEY");
      }
      const command = ReviewerDraftRevisionCommandDtoSchema.parse({
        draftId: input.draftId,
        generationId: input.generationId,
        expectedRevision: input.expectedRevision,
        text: input.text,
      });
      const body = JSON.stringify(command);
      const response = await fetchFn(
        `/api/v1/review-sessions/${encodeURIComponent(input.reviewSessionHandle)}/draft-revisions`,
        {
          method: "PUT",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Idempotency-Key": input.idempotencyKey,
            "x-amz-content-sha256": await sha256Hex(body),
          },
          body,
        },
      );
      if (response.status === 409) {
        return ReviewerDraftRevisionResultDtoSchema.parse(await response.json());
      }
      if (!response.ok) {
        throw await readBffClientError(response);
      }
      return ReviewerDraftRevisionResultDtoSchema.parse(await response.json());
    },
  };
}
