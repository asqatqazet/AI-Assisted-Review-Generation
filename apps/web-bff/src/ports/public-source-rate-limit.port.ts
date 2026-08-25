import type {
  PublicSourceRateLimitPolicyDto,
  ConsumePublicSourceRateLimitInvocationResultDto,
} from "@review/contracts/context";
import { isIP } from "node:net";

export interface PublicSourceRateLimitPort {
  consume(input: {
    readonly policy: PublicSourceRateLimitPolicyDto;
    readonly sourceAddress: string;
  }): Promise<ConsumePublicSourceRateLimitInvocationResultDto["result"]>;
}

function canonicalIp(candidate: string): string | null {
  const version = isIP(candidate);
  if (version === 4) {
    return candidate;
  }
  if (version === 6) {
    const canonical = new URL(`http://[${candidate}]/`).hostname.slice(1, -1);
    const [head = "", tail = ""] = canonical.split("::");
    const headWords = head === "" ? [] : head.split(":");
    const tailWords = tail === "" ? [] : tail.split(":");
    const zeroWords = Array.from(
      { length: 8 - headWords.length - tailWords.length },
      () => "0",
    );
    const words = [...headWords, ...zeroWords, ...tailWords].map((word) =>
      Number.parseInt(word, 16),
    );
    if (
      words.length !== 8 ||
      words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)
    ) {
      return null;
    }

    if (
      words.slice(0, 5).every((word) => word === 0) &&
      words[5] === 0xffff
    ) {
      const high = words[6] ?? 0;
      const low = words[7] ?? 0;
      return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join(".");
    }

    const network = [...words.slice(0, 4), 0, 0, 0, 0]
      .map((word) => word.toString(16))
      .join(":");
    return new URL(`http://[${network}]/`).hostname.slice(1, -1);
  }
  return null;
}

/**
 * CloudFront appends the actual viewer address to X-Forwarded-For. Entries to
 * its left came from the viewer and therefore carry no authority.
 */
export function cloudFrontViewerSource(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded === null) {
    return null;
  }
  const candidates = forwarded.split(",");
  return canonicalIp(candidates.at(-1)?.trim() ?? "");
}
