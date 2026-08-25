import type {
  ForgetReviewSessionInvocationDto,
  ForgetReviewSessionInvocationResultDto,
  ReviewSessionProjectionDto,
  SaveReviewSessionProgressInvocationDto,
  SaveReviewSessionProgressInvocationResultDto,
} from "@review/contracts/context";
import type {
  PostgresReviewSessionProgressStore,
  PostgresReviewSessionReader,
} from "@review/db/admission";

import { hashCapability } from "./capability-hash.js";

type ReviewSessionReader = Pick<PostgresReviewSessionReader, "read">;

type ReviewSessionProgressStore = Pick<
  PostgresReviewSessionProgressStore,
  "read" | "save" | "forget"
>;

export interface ReviewSessionServiceOptions {
  readonly reader: ReviewSessionReader;
  readonly progressStore?: ReviewSessionProgressStore | undefined;
}

export function createReviewSessionService({
  reader,
  progressStore,
}: ReviewSessionServiceOptions): {
  readReviewSession(input: {
    readonly reviewSessionHandle: string;
    readonly browserCapability: string;
  }): Promise<ReviewSessionProjectionDto | { readonly status: "unavailable" }>;
  saveReviewSessionProgress(
    input: SaveReviewSessionProgressInvocationDto["input"],
  ): Promise<SaveReviewSessionProgressInvocationResultDto["result"]>;
  forgetReviewSession(
    input: ForgetReviewSessionInvocationDto["input"],
  ): Promise<ForgetReviewSessionInvocationResultDto["result"]>;
} {
  return {
    async readReviewSession({ reviewSessionHandle, browserCapability }) {
      const hashes = {
        routeHandleHash: await hashCapability(reviewSessionHandle),
        browserCapabilityHash: await hashCapability(browserCapability),
      };
      const stored = await reader.read(hashes);
      if (stored === null) {
        return { status: "unavailable" };
      }
      const resumable =
        progressStore?.read === undefined
          ? undefined
          : await progressStore.read(hashes);
      if (resumable?.status === "unavailable") {
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
        ...(resumable?.status === "ready"
          ? {
              progress: {
                ...resumable.progress,
                selectedFactOptionIds: [
                  ...resumable.progress.selectedFactOptionIds,
                ],
              },
              drafts: resumable.drafts.map((draft) => ({ ...draft })),
            }
          : {}),
      };
    },

    async saveReviewSessionProgress(input) {
      if (progressStore === undefined) {
        return { status: "unavailable" };
      }
      const result = await progressStore.save({
        routeHandleHash: await hashCapability(input.reviewSessionHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
        expectedEpoch: input.expectedEpoch,
        progress: input.progress,
      });
      return result.status === "saved" || result.status === "conflict"
        ? {
            status: result.status,
            progress: {
              ...result.progress,
              selectedFactOptionIds: [
                ...result.progress.selectedFactOptionIds,
              ],
            },
          }
        : result;
    },

    async forgetReviewSession(input) {
      if (progressStore === undefined) {
        return { status: "unavailable" };
      }
      return await progressStore.forget({
        routeHandleHash: await hashCapability(input.reviewSessionHandle),
        browserCapabilityHash: await hashCapability(input.browserCapability),
      });
    },
  };
}
