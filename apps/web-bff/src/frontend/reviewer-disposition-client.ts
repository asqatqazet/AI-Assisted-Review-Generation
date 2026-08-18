import {
  ReviewerDispositionCommandDtoSchema,
  ReviewerDispositionResultDtoSchema,
  type ReviewerDispositionResultDto,
} from "@review/contracts/generation";

import { readBffClientError } from "./bff-error.js";

export interface ReviewerDispositionClient {
  record(input: {
    readonly reviewSessionHandle: string;
    readonly idempotencyKey: string;
    readonly draftId: string;
    readonly generationId: string;
    readonly finalText: string;
  }): Promise<ReviewerDispositionResultDto>;
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

export function createHttpReviewerDispositionClient(
  fetchFn: typeof fetch = globalThis.fetch,
): ReviewerDispositionClient {
  return {
    async record(input) {
      if (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200) {
        throw new Error("INVALID_IDEMPOTENCY_KEY");
      }
      const command = ReviewerDispositionCommandDtoSchema.parse({
        draftId: input.draftId,
        generationId: input.generationId,
        finalText: input.finalText,
      });
      const body = JSON.stringify(command);
      const response = await fetchFn(
        `/api/v1/review-sessions/${encodeURIComponent(input.reviewSessionHandle)}/dispositions`,
        {
          method: "POST",
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
      if (!response.ok) {
        throw await readBffClientError(response);
      }
      return ReviewerDispositionResultDtoSchema.parse(await response.json());
    },
  };
}
