import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPostgresPublicSourceRateLimitStore } from "./admission/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const stores: Array<{ disconnect(): Promise<void> }> = [];

function asRole(role: string): string {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  const url = new URL(databaseUrl);
  url.username = role;
  url.password = "";
  return url.toString();
}

async function runSql(connectionUrl: string, sql: string): Promise<string> {
  const { stdout } = await execFileAsync(
    psql,
    [connectionUrl, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

function store() {
  const created = createPostgresPublicSourceRateLimitStore({
    databaseUrl: asRole("context_runtime_svc"),
  });
  stores.push(created);
  return created;
}

function sourceBuckets(
  current: string,
  previous: string,
  next: string,
): {
  readonly currentSourceBucketHash: string;
  readonly previousSourceBucketHash: string;
  readonly nextSourceBucketHash: string;
} {
  return {
    currentSourceBucketHash: current.repeat(64),
    previousSourceBucketHash: previous.repeat(64),
    nextSourceBucketHash: next.repeat(64),
  };
}

beforeEach(async () => {
  if (databaseUrl !== undefined) {
    await runSql(databaseUrl, "DELETE FROM public_source_rate_limit_events;");
  }
});

afterEach(async () => {
  await Promise.all(stores.splice(0).map(async (item) => item.disconnect()));
});

describeDatabase("PostgreSQL public source rate limits", () => {
  it("keeps the legacy overload fail-closed when callers rotate buckets", async () => {
    const legacyBuckets = "0123456789";
    for (const character of legacyBuckets) {
      const result = await runSql(
        asRole("context_svc"),
        `SELECT allowed, retry_after_seconds
         FROM consume_public_source_rate_limit(
           '${character.repeat(64)}', 'generation'
         );`,
      );
      expect(result.split("|")[0]).toBe("t");
    }

    const limited = await runSql(
      asRole("context_svc"),
      `SELECT allowed, retry_after_seconds
       FROM consume_public_source_rate_limit(
         '${"a".repeat(64)}', 'generation'
       );`,
    );
    expect(limited.split("|")[0]).toBe("f");
  });

  it.each([
    ["entry-prepare", 60],
    ["entry-start", 10],
    ["generation", 10],
  ] as const)("hardcodes the %s boundary", async (policy, limit) => {
    const limiter = store();
    const buckets =
      policy === "entry-prepare"
        ? sourceBuckets("1", "a", "b")
        : policy === "entry-start"
          ? sourceBuckets("2", "b", "c")
          : sourceBuckets("3", "c", "d");

    const allowed = [];
    for (let index = 0; index < limit; index += 1) {
      allowed.push(await limiter.consume({ policy, ...buckets }));
    }
    expect(allowed).toEqual(
      Array.from({ length: limit }, () => ({ status: "allowed" })),
    );
    await expect(
      limiter.consume({ policy, ...buckets }),
    ).resolves.toMatchObject({
      status: "limited",
      retryAfterSeconds: expect.any(Number),
    });
  });

  it("serializes concurrent consumers so exactly ten Generation requests win", async () => {
    const limiter = store();
    const outcomes = await Promise.all(
      Array.from({ length: 11 }, async () =>
        limiter.consume({
          policy: "generation",
          ...sourceBuckets("4", "d", "e"),
        }),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.status === "allowed")).toHaveLength(
      10,
    );
    expect(outcomes.filter((outcome) => outcome.status === "limited")).toHaveLength(
      1,
    );
  });

  it("uses a sliding database-time window and removes buckets older than one day", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const limiter = store();
    const buckets = sourceBuckets("5", "e", "f");
    for (let index = 0; index < 10; index += 1) {
      await limiter.consume({ policy: "generation", ...buckets });
    }
    await expect(
      limiter.consume({ policy: "generation", ...buckets }),
    ).resolves.toMatchObject({ status: "limited" });

    await runSql(
      databaseUrl,
      `UPDATE public_source_rate_limit_events
       SET consumed_at = clock_timestamp() - interval '61 minutes'
       WHERE source_bucket_hash = '${buckets.currentSourceBucketHash}';
       INSERT INTO public_source_rate_limit_events (
         source_bucket_hash, policy, consumed_at
       ) VALUES (
         '${"6".repeat(64)}', 'entry-prepare',
         clock_timestamp() - interval '25 hours'
       );`,
    );
    await expect(
      limiter.consume({ policy: "generation", ...buckets }),
    ).resolves.toEqual({ status: "allowed" });
    await expect(
      runSql(
        databaseUrl,
        `SELECT count(*) FROM public_source_rate_limit_events
         WHERE source_bucket_hash = '${"6".repeat(64)}';`,
      ),
    ).resolves.toBe("0");
  });

  it("cleans expired buckets without requiring another public request", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const limiter = store();
    await runSql(
      databaseUrl,
      `INSERT INTO public_source_rate_limit_events (
         source_bucket_hash, policy, consumed_at
       ) VALUES
         ('${"6".repeat(64)}', 'entry-prepare', clock_timestamp() - interval '23 hours 1 minute'),
         ('${"7".repeat(64)}', 'entry-prepare', clock_timestamp() - interval '22 hours');`,
    );

    await expect(limiter.cleanupExpired()).resolves.toBe(1);
    await expect(
      runSql(
        databaseUrl,
        `SELECT source_bucket_hash FROM public_source_rate_limit_events
         ORDER BY source_bucket_hash;`,
      ),
    ).resolves.toBe("7".repeat(64));
    await expect(
      runSql(
        asRole("context_runtime_svc"),
        "SELECT purge_public_source_rate_limits();",
      ),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("persists no raw address and permits no direct runtime scan", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const limiter = store();
    await limiter.consume({
      policy: "entry-prepare",
      currentSourceBucketHash:
        "904febf49650c9d6ab502d0f3f3f2f07748ee5a464e9b8f9c1138dab97d37180",
      previousSourceBucketHash: "f".repeat(64),
      nextSourceBucketHash: "e".repeat(64),
    });

    await expect(
      runSql(
        databaseUrl,
        `SELECT count(*) FROM public_source_rate_limit_events
         WHERE row_to_json(public_source_rate_limit_events)::text LIKE '%203.0.113.8%';`,
      ),
    ).resolves.toBe("0");
    await expect(
      runSql(
        asRole("context_runtime_svc"),
        "SELECT count(*) FROM public_source_rate_limit_events;",
      ),
    ).rejects.toThrow(/permission denied/iu);
    for (const role of ["console_control_svc", "generation_svc"]) {
      await expect(
        runSql(
          asRole(role),
          `SELECT * FROM consume_public_source_rate_limit(
            '${"7".repeat(64)}', 'entry-prepare'
          );`,
        ),
      ).rejects.toThrow(/permission denied/iu);
      await expect(
        runSql(
          asRole(role),
          `SELECT * FROM consume_public_source_rate_limit(
            '${"7".repeat(64)}', '${"8".repeat(64)}',
            '${"9".repeat(64)}', 'entry-prepare'
          );`,
        ),
      ).rejects.toThrow(/permission denied/iu);
    }
    await expect(
      runSql(
        asRole("context_svc"),
        `SELECT * FROM consume_public_source_rate_limit(
          '${"7".repeat(64)}', '${"8".repeat(64)}',
          '${"9".repeat(64)}', 'entry-prepare'
        );`,
      ),
    ).rejects.toThrow(/permission denied/iu);
  });

  it("cannot be redirected into a caller-owned temporary table", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const buckets = sourceBuckets("8", "9", "a");
    await runSql(
      asRole("context_runtime_svc"),
      `CREATE TEMP TABLE public_source_rate_limit_events (
         source_bucket_hash char(64),
         policy text,
         consumed_at timestamptz
       );
       SELECT allowed FROM consume_public_source_rate_limit(
         '${buckets.currentSourceBucketHash}',
         '${buckets.previousSourceBucketHash}',
         '${buckets.nextSourceBucketHash}',
         'entry-prepare'
       );`,
    );

    await expect(
      runSql(
        databaseUrl,
        `SELECT count(*) FROM public_source_rate_limit_events
         WHERE source_bucket_hash = '${buckets.currentSourceBucketHash}';`,
      ),
    ).resolves.toBe("1");
  });

  it("counts a post-midnight commit before a delayed pre-midnight transaction", async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for database integration tests");
    }
    const limiter = store();
    const beforeMidnight = sourceBuckets("b", "a", "c");
    const afterMidnight = sourceBuckets("c", "b", "d");
    await runSql(
      databaseUrl,
      `INSERT INTO public_source_rate_limit_events (
         source_bucket_hash, policy, consumed_at
       )
       SELECT '${beforeMidnight.currentSourceBucketHash}', 'generation',
              clock_timestamp() - interval '30 minutes'
       FROM generate_series(1, 9);`,
    );

    await expect(
      limiter.consume({ policy: "generation", ...afterMidnight }),
    ).resolves.toEqual({ status: "allowed" });
    await expect(
      limiter.consume({ policy: "generation", ...beforeMidnight }),
    ).resolves.toMatchObject({ status: "limited" });
    await expect(
      runSql(
        databaseUrl,
        `SELECT count(*) FROM public_source_rate_limit_events
         WHERE policy = 'generation'
           AND source_bucket_hash IN (
             '${beforeMidnight.currentSourceBucketHash}',
             '${afterMidnight.currentSourceBucketHash}'
           );`,
      ),
    ).resolves.toBe("10");
  });
});
