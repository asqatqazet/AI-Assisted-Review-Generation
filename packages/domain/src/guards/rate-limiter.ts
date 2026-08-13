export interface RateLimitInput {
  readonly windowSeconds: number;
  readonly maxRequests: number;
  readonly requestTimestamps: readonly number[];
  readonly now?: number | undefined;
}

export type RateLimitEvaluation =
  | {
      readonly allow: true;
      readonly remaining: number;
    }
  | {
      readonly allow: false;
      readonly reason: "rate-limit-exceeded";
      readonly retryAfterSeconds: number;
    };

export function evaluateRateLimit(input: RateLimitInput): RateLimitEvaluation {
  const currentTime = input.now ?? Date.now();
  const windowMs = input.windowSeconds * 1000;
  const cutoffTime = currentTime - windowMs;

  const activeTimestamps = input.requestTimestamps.filter((ts) => ts > cutoffTime);

  if (activeTimestamps.length >= input.maxRequests) {
    const oldestInWindow = Math.min(...activeTimestamps);
    const resetTimeMs = oldestInWindow + windowMs;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((resetTimeMs - currentTime) / 1000),
    );

    return {
      allow: false,
      reason: "rate-limit-exceeded",
      retryAfterSeconds,
    };
  }

  return {
    allow: true,
    remaining: input.maxRequests - (activeTimestamps.length + 1),
  };
}
