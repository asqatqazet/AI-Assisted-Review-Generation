import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("US-03.2 database-time execution fence", () => {
  const schema = fs.readFileSync(
    path.resolve(__dirname, "../prisma/schema.prisma"),
    "utf8",
  );
  const migrationPath = path.resolve(
    __dirname,
    "../prisma/migrations/20260817000004_execution_fence/migration.sql",
  );
  const recoveryMigrationPath = path.resolve(
    __dirname,
    "../prisma/migrations/20260824000030_provider_result_checkpoint/migration.sql",
  );

  it("represents an Attempt claimed before provider completion", () => {
    expect(schema).toMatch(
      /enum ProviderAttemptStatus\s*\{[\s\S]*RUNNING[\s\S]*SUCCEEDED[\s\S]*FAILED[\s\S]*TIMED_OUT[\s\S]*CANCELLED[\s\S]*\}/,
    );
  });

  it("separates a durable Provider result checkpoint from its Provider receipt", () => {
    const sql = fs.readFileSync(recoveryMigrationPath, "utf8");

    expect(schema).toMatch(
      /enum ProviderAttemptStatus\s*\{[\s\S]*RUNNING[\s\S]*CHECKPOINTED[\s\S]*SUCCEEDED/,
    );
    expect(schema).toMatch(
      /model ProviderAttempt\s*\{[\s\S]*providerOutput\s+Json\?[\s\S]*providerResponse\s+Json\?[\s\S]*resultCheckpoint\s+Json\?[\s\S]*resultCheckpointedAt/,
    );
    expect(schema).toMatch(
      /model Generation\s*\{[\s\S]*providerOutput\s+Json\?/,
    );
    expect(sql).toContain("ADD VALUE 'CHECKPOINTED'");
    expect(sql).toContain("ADD COLUMN provider_output jsonb");
    expect(sql).toContain("ADD COLUMN result_checkpoint jsonb");
    expect(sql).toContain("ALTER COLUMN provider_output TYPE jsonb");
    expect(sql).toMatch(
      /console_execution_generation_detail_audit[\s\S]*?auth_record\.may_read_raw[\s\S]*?'\{generation,providerOutput\}'/u,
    );
    expect(sql).toContain("SET search_path = pg_catalog, public, pg_temp");
  });

  it("uses database time to prepare a finite, idempotent no-provider lease", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE FUNCTION prepare_generation_lease");
    expect(sql).toMatch(/v_now\s*:=\s*clock_timestamp\(\)/);
    expect(sql).toMatch(/p_permit_expires_at\s*>\s*v_now/);
    expect(sql).toMatch(
      /LEAST\(p_permit_expires_at,\s*v_now\s*\+\s*interval '45 seconds'\)/,
    );
    expect(sql).toMatch(
      /ON CONFLICT \(permit_jti\) DO NOTHING/,
    );
  });

  it("claims the lease and Attempt ordinal atomically before provider I/O", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const claimFunction = sql.match(
      /CREATE FUNCTION claim_generation_attempt[\s\S]*?\$function\$;/,
    )?.[0];

    expect(claimFunction).toBeDefined();
    expect(claimFunction).toMatch(/v_now\s*:=\s*clock_timestamp\(\)/);
    expect(claimFunction).toMatch(
      /UPDATE execution_leases[\s\S]*SET[\s\S]*state\s*=\s*'RUNNING'[\s\S]*WHERE[\s\S]*state\s*=\s*'LEASED'/,
    );
    expect(claimFunction).toMatch(/lease_expires_at\s*>\s*v_now/);
    expect(claimFunction).toMatch(/p_activation_expires_at\s*>\s*v_now/);
    expect(claimFunction).toMatch(
      /p_activation_expires_at\s*<=\s*lease_expires_at/,
    );
    expect(claimFunction).toMatch(
      /INSERT INTO provider_attempts[\s\S]*FROM claimed_lease/,
    );
    expect(claimFunction).toMatch(/'RUNNING'::provider_attempt_status/);
    expect(claimFunction).toMatch(
      /WHERE execution_lease_id\s*=\s*p_execution_lease_id[\s\S]*attempt_ordinal\s*=\s*p_attempt_ordinal/,
    );
  });

  it("lets expiry cancellation race the same LEASED state exactly once", () => {
    const sql = fs.readFileSync(migrationPath, "utf8");
    const cancelFunction = sql.match(
      /CREATE FUNCTION cancel_expired_generation_lease[\s\S]*?\$function\$;/,
    )?.[0];

    expect(cancelFunction).toBeDefined();
    expect(cancelFunction).toMatch(/v_now\s*:=\s*clock_timestamp\(\)/);
    expect(cancelFunction).toMatch(
      /UPDATE execution_leases[\s\S]*SET[\s\S]*state\s*=\s*'CANCELLED'[\s\S]*WHERE[\s\S]*state\s*=\s*'LEASED'/,
    );
    expect(cancelFunction).toMatch(/lease_expires_at\s*<=\s*v_now/);
    expect(cancelFunction).toMatch(/cancelled_at\s*=\s*v_now/);
  });
});
