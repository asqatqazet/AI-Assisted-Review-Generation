import {
  ReviewSessionProjectionDtoSchema,
  type ReviewSessionProjectionDto,
} from "@review/contracts/context";

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
        throw new Error("REVIEW_SESSION_UNAVAILABLE");
      }
      return ReviewSessionProjectionDtoSchema.parse(await response.json());
    },
  };
}
