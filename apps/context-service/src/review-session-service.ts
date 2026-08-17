import type { ReviewSessionProjectionDto } from "@review/contracts/context";
import type { PostgresReviewSessionReader } from "@review/db/admission";

type ReviewSessionReader = Pick<PostgresReviewSessionReader, "read">;

export interface ReviewSessionServiceOptions {
  readonly reader: ReviewSessionReader;
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

async function hashCapability(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sha256:${toHex(new Uint8Array(digest))}`;
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
        factOptions: [...stored.factOptions],
        reviewFormats: stored.reviewFormats.map((format) => ({
          ...format,
          availableCommands: [...format.availableCommands],
        })),
      };
    },
  };
}
