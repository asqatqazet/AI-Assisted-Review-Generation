import {
  ReviewSessionProgressInputDtoSchema,
  SaveReviewSessionProgressInvocationResultDtoSchema,
  type ReviewSessionProgressDto,
  type SaveReviewSessionProgressInvocationResultDto,
} from "@review/contracts/context";

import { readBffClientError } from "./bff-error.js";

export interface SaveReviewProgressInput {
  readonly reviewSessionHandle: string;
  readonly expectedEpoch: number;
  readonly progress: Omit<ReviewSessionProgressDto, "epoch">;
}

export interface ReviewProgressClient {
  save(
    input: SaveReviewProgressInput,
    options?: { readonly keepalive?: boolean | undefined },
  ): Promise<SaveReviewSessionProgressInvocationResultDto["result"]>;
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

export function createHttpReviewProgressClient(
  fetchFn: typeof fetch = globalThis.fetch,
): ReviewProgressClient {
  return {
    async save(input, options) {
      const body = JSON.stringify({
        expectedEpoch: input.expectedEpoch,
        progress: ReviewSessionProgressInputDtoSchema.parse(input.progress),
      });
      const response = await fetchFn(
        `/api/v1/review-sessions/${encodeURIComponent(input.reviewSessionHandle)}/progress`,
        {
          method: "PUT",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-amz-content-sha256": await sha256Hex(body),
          },
          body,
          keepalive: options?.keepalive ?? false,
        },
      );
      if (response.status !== 200 && response.status !== 409) {
        throw await readBffClientError(response);
      }
      const parsed = SaveReviewSessionProgressInvocationResultDtoSchema.parse({
        operation: "save-review-session-progress",
        result: (await response.json()) as unknown,
      });
      return parsed.result;
    },
  };
}
