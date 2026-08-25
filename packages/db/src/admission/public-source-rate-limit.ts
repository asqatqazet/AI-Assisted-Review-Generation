import { PrismaClient } from "../generated/admission/index.js";

export type DatabasePublicSourceRateLimitPolicy =
  | "entry-prepare"
  | "entry-start"
  | "generation";

export interface PostgresPublicSourceRateLimitStore {
  consume(input: {
    readonly policy: DatabasePublicSourceRateLimitPolicy;
    readonly currentSourceBucketHash: string;
    readonly previousSourceBucketHash: string;
    readonly nextSourceBucketHash: string;
  }): Promise<
    | { readonly status: "allowed" }
    | { readonly status: "limited"; readonly retryAfterSeconds: number }
  >;
  cleanupExpired(): Promise<number>;
  disconnect(): Promise<void>;
}

export function createPostgresPublicSourceRateLimitStore({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): PostgresPublicSourceRateLimitStore {
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  return {
    async consume(input) {
      const rows = await client.$queryRaw<
        {
          readonly allowed: boolean;
          readonly retry_after_seconds: number | null;
        }[]
      >`
        SELECT allowed, retry_after_seconds
        FROM consume_public_source_rate_limit(
          ${input.currentSourceBucketHash},
          ${input.previousSourceBucketHash},
          ${input.nextSourceBucketHash},
          ${input.policy}
        )
      `;
      const result = rows[0];
      if (rows.length !== 1 || result === undefined) {
        throw new Error("PUBLIC_SOURCE_RATE_LIMIT_RESULT_INVALID");
      }
      if (result.allowed) {
        return { status: "allowed" };
      }
      if (
        result.retry_after_seconds === null ||
        !Number.isInteger(result.retry_after_seconds) ||
        result.retry_after_seconds < 1
      ) {
        throw new Error("PUBLIC_SOURCE_RATE_LIMIT_RETRY_INVALID");
      }
      return {
        status: "limited",
        retryAfterSeconds: result.retry_after_seconds,
      };
    },

    async cleanupExpired() {
      const rows = await client.$queryRaw<
        { readonly deleted_count: number }[]
      >`
        SELECT cleanup_expired_public_source_rate_limits() AS deleted_count
      `;
      const deletedCount = rows[0]?.deleted_count;
      if (
        rows.length !== 1 ||
        !Number.isInteger(deletedCount) ||
        deletedCount === undefined ||
        deletedCount < 0
      ) {
        throw new Error("PUBLIC_SOURCE_RATE_LIMIT_CLEANUP_RESULT_INVALID");
      }
      return deletedCount;
    },

    async disconnect() {
      await client.$disconnect();
    },
  };
}
