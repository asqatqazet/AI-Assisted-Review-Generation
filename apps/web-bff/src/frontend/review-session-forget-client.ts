import { readBffClientError } from "./bff-error.js";

export interface ReviewSessionForgetClient {
  forget(input: { readonly reviewSessionHandle: string }): Promise<void>;
}

const encoder = new TextEncoder();

async function emptyBodyHash(): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(""),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createHttpReviewSessionForgetClient(
  fetchFn: typeof fetch = globalThis.fetch,
): ReviewSessionForgetClient {
  return {
    async forget(input) {
      const response = await fetchFn(
        `/api/v1/review-sessions/${encodeURIComponent(input.reviewSessionHandle)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "x-amz-content-sha256": await emptyBodyHash(),
          },
        },
      );
      if (!response.ok) {
        throw await readBffClientError(response);
      }
    },
  };
}
