import {
  ReviewSessionProjectionDtoSchema,
  type ReviewSessionProjectionDto,
} from "@review/contracts/context";

import { readBffClientError } from "./bff-error.js";

export interface ReviewSessionClient {
  read(
    reviewSessionHandle: string,
    signal: AbortSignal,
  ): Promise<ReviewSessionProjectionDto>;
}

export function createHttpReviewSessionClient(): ReviewSessionClient {
  return {
    async read(reviewSessionHandle, signal) {
      const response = await fetch(
        `/api/v1/review-sessions/${encodeURIComponent(reviewSessionHandle)}`,
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal,
        },
      );
      if (!response.ok) {
        throw await readBffClientError(response);
      }
      return ReviewSessionProjectionDtoSchema.parse(await response.json());
    },
  };
}
