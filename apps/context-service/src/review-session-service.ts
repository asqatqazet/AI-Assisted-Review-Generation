import type { ReviewSessionProjectionDto } from "@review/contracts/context";
import type { PostgresReviewSessionReader } from "@review/db/admission";

import { hashCapability } from "./capability-hash.js";

type ReviewSessionReader = Pick<PostgresReviewSessionReader, "read">;

export interface ReviewSessionServiceOptions {
  readonly reader: ReviewSessionReader;
}

export function createReviewSessionService({ reader }: ReviewSessionServiceOptions): {
  readReviewSession(input: {
    readonly reviewSessionHandle: string;
    readonly browserCapability: string;
  }): Promise<ReviewSessionProjectionDto | { readonly status: "unavailable" }>;
} {
  return {
    async readReviewSession({ reviewSessionHandle, browserCapability }) {
      const stored = await reader.read({
        routeHandleHash: await hashCapability(reviewSessionHandle),
        browserCapabilityHash: await hashCapability(browserCapability),
      });
      if (stored === null) {
        return { status: "unavailable" };
      }

      return {
        status: "ready",
        reviewSessionHandle,
        tenantDisplayName: stored.tenantDisplayName,
        locationDisplayName: stored.locationDisplayName,
        locale: stored.locale,
        rating: stored.rating,
        action: stored.action,
        requirements: { ...stored.requirements },
        factOptions: [...stored.factOptions],
        reviewFormats: stored.reviewFormats.map((format) => ({
          ...format,
          constraints: { ...format.constraints },
          availableCommands: [...format.availableCommands],
        })),
        destinations: stored.destinations.map((destination) => ({
          ...destination,
        })),
      };
    },
  };
}
