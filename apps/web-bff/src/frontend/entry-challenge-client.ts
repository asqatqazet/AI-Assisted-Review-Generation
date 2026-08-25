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

export type StartEntryResult =
  | { readonly redirectTo: string }
  | { readonly status: "verification-required" };

export interface VerifyEntryInput {
  readonly entryChallengeHandle: string;
  readonly verificationEvidence: string;
  readonly csrfToken: string;
}

export type VerifyEntryResult =
  | { readonly redirectTo: string }
  | { readonly status: "verification-unavailable" };

export interface EntryChallengeClient {
  read(
    entryChallengeHandle: string,
    signal: AbortSignal,
  ): Promise<EntryChallengeProjectionDto>;
  start(
    input: StartEntryInput,
    signal: AbortSignal,
  ): Promise<StartEntryResult>;
  verify(
    input: VerifyEntryInput,
    signal: AbortSignal,
  ): Promise<VerifyEntryResult>;
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
      if (response.status === 202) {
        const result: unknown = await response.json();
        if (
          typeof result === "object" &&
          result !== null &&
          Object.keys(result).length === 1 &&
          "status" in result &&
          result.status === "verification-required"
        ) {
          return { status: "verification-required" };
        }
        throw new Error("ENTRY_UNAVAILABLE");
      }
      const redirectUrl = new URL(response.url);
      if (!/^\/review\/[A-Za-z0-9_-]{1,200}$/.test(redirectUrl.pathname)) {
        throw new Error("ENTRY_UNAVAILABLE");
      }
      return { redirectTo: redirectUrl.pathname };
    },

    async verify(input, signal) {
      const body = new URLSearchParams({
        verificationEvidence: input.verificationEvidence,
        csrfToken: input.csrfToken,
      }).toString();
      const response = await sendPayloadBoundPost(
        fetchFn,
        `/api/v1/entry-challenges/${encodeURIComponent(input.entryChallengeHandle)}/verify`,
        body,
        {
          contentType: "application/x-www-form-urlencoded;charset=UTF-8",
          signal,
        },
      );

      if (!response.ok) {
        throw await readBffClientError(response);
      }
      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        const result: unknown = await response.json();
        if (
          typeof result === "object" &&
          result !== null &&
          Object.keys(result).length === 1 &&
          "status" in result &&
          result.status === "verification-unavailable"
        ) {
          return { status: "verification-unavailable" };
        }
        throw new Error("ENTRY_UNAVAILABLE");
      }
      const redirectUrl = new URL(response.url);
      if (!/^\/review\/[A-Za-z0-9_-]{1,200}$/.test(redirectUrl.pathname)) {
        throw new Error("ENTRY_UNAVAILABLE");
      }
      return { redirectTo: redirectUrl.pathname };
    },
  };
}
