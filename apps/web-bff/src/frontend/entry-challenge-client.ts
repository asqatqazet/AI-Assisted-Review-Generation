import {
  EntryChallengeProjectionDtoSchema,
  type EntryChallengeProjectionDto,
} from "@review/contracts/context";

export interface EntryChallengeClient {
  read(
    entryChallengeHandle: string,
    signal: AbortSignal,
  ): Promise<EntryChallengeProjectionDto>;
}

export function createHttpEntryChallengeClient(
  fetchFn: typeof fetch = globalThis.fetch,
): EntryChallengeClient {
  return {
    async read(entryChallengeHandle, signal) {
      const response = await fetchFn(
        `/api/v1/entry-challenges/${encodeURIComponent(entryChallengeHandle)}`,
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal,
        },
      );

      if (!response.ok) {
        throw new Error("ENTRY_UNAVAILABLE");
      }

      return EntryChallengeProjectionDtoSchema.parse(await response.json());
    },
  };
}
