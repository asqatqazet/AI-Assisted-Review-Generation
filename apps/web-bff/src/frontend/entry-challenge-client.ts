import {
  EntryChallengeProjectionDtoSchema,
  type EntryChallengeProjectionDto,
} from "@review/contracts/context";

import { sendPayloadBoundPost } from "./payload-bound-request.js";
import { readBffClientError } from "./bff-error.js";

export interface StartEntryInput {
  readonly entryChallengeHandle: string;
  readonly rating: 1 | 2 | 3 | 4 | 5;
  readonly action: "generate" | "paraphrase";
  readonly csrfToken: string;
}

export interface EntryChallengeClient {
  read(
    entryChallengeHandle: string,
    signal: AbortSignal,
  ): Promise<EntryChallengeProjectionDto>;
  start(
    input: StartEntryInput,
    signal: AbortSignal,
  ): Promise<{ readonly redirectTo: string }>;
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
        throw await readBffClientError(response);
      }

      return EntryChallengeProjectionDtoSchema.parse(await response.json());
    },

    async start(input, signal) {
      const body = new URLSearchParams({
        rating: String(input.rating),
        action: input.action,
        csrfToken: input.csrfToken,
      }).toString();
      const response = await sendPayloadBoundPost(
        fetchFn,
        `/api/v1/entry-challenges/${encodeURIComponent(input.entryChallengeHandle)}/start`,
        body,
        {
          contentType: "application/x-www-form-urlencoded;charset=UTF-8",
          signal,
        },
      );

      if (!response.ok) {
        throw await readBffClientError(response);
      }
      const redirectUrl = new URL(response.url);
      if (!/^\/review\/[A-Za-z0-9_-]{1,200}$/.test(redirectUrl.pathname)) {
        throw new Error("ENTRY_UNAVAILABLE");
      }
      return { redirectTo: redirectUrl.pathname };
    },
  };
}
