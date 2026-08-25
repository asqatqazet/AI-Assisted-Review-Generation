import type {
  ConsumePublicSourceRateLimitInvocationDto,
  ConsumePublicSourceRateLimitInvocationResultDto,
  PublicSourceRateLimitPolicyDto,
} from "@review/contracts/context";
import { createHmac } from "node:crypto";

export interface PublicSourceRateLimitStore {
  consume(input: {
    readonly policy: PublicSourceRateLimitPolicyDto;
    readonly currentSourceBucketHash: string;
    readonly previousSourceBucketHash: string;
    readonly nextSourceBucketHash: string;
  }): Promise<ConsumePublicSourceRateLimitInvocationResultDto["result"]>;
}

export interface PublicSourceRateLimitService {
  consume(
    input: ConsumePublicSourceRateLimitInvocationDto["input"],
  ): Promise<ConsumePublicSourceRateLimitInvocationResultDto["result"]>;
}

export function createPublicSourceRateLimitService({
  secret,
  store,
  now = () => new Date(),
}: {
  readonly secret: string;
  readonly store: PublicSourceRateLimitStore;
  readonly now?: (() => Date) | undefined;
}): PublicSourceRateLimitService {
  if (new TextEncoder().encode(secret).byteLength < 32) {
    throw new Error("Public source rate-limit secret must be at least 32 bytes.");
  }

  return {
    async consume(input) {
      const currentTime = now();
      const currentUtcDay = currentTime.toISOString().slice(0, 10);
      const previousUtcDay = new Date(
        currentTime.getTime() - 24 * 60 * 60 * 1_000,
      )
        .toISOString()
        .slice(0, 10);
      const nextUtcDay = new Date(
        currentTime.getTime() + 24 * 60 * 60 * 1_000,
      )
        .toISOString()
        .slice(0, 10);
      const hashSourceBucket = (utcDay: string) =>
        createHmac("sha256", secret)
          .update(
            `public-source-rate:v1\0${utcDay}\0${input.policy}\0${input.sourceAddress}`,
          )
          .digest("hex");
      return await store.consume({
        policy: input.policy,
        currentSourceBucketHash: hashSourceBucket(currentUtcDay),
        previousSourceBucketHash: hashSourceBucket(previousUtcDay),
        nextSourceBucketHash: hashSourceBucket(nextUtcDay),
      });
    },
  };
}
