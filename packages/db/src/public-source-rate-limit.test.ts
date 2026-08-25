import fs from "node:fs";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  new URL(
    "../prisma/migrations/20260824000028_public_source_rate_limits/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("public source rate-limit database boundary", () => {
  it("keeps the legacy overload fail-closed across caller-selected buckets", () => {
    expect(
      sql.match(/legacy-public-source-rate-limit-global:/gu),
    ).toHaveLength(2);
    expect(sql).toMatch(
      /CREATE FUNCTION consume_public_source_rate_limit\(\s*p_source_bucket_hash text,\s*p_policy text\s*\)[\s\S]*?WHERE policy = p_policy\s+AND consumed_at > v_now - v_window/u,
    );
  });

  it("hardcodes each policy and gives the caller no limit or clock input", () => {
    expect(sql).toMatch(
      /CREATE FUNCTION consume_public_source_rate_limit\(\s*p_current_source_bucket_hash text,\s*p_previous_source_bucket_hash text,\s*p_next_source_bucket_hash text,\s*p_policy text\s*\)/u,
    );
    expect(sql).toMatch(/WHEN 'entry-prepare' THEN\s+v_limit := 60/u);
    expect(sql).toMatch(/WHEN 'entry-start' THEN\s+v_limit := 10/u);
    expect(sql).toMatch(/WHEN 'generation' THEN\s+v_limit := 10/u);
    expect(sql).toContain("interval '5 minutes'");
    expect(sql).toContain("interval '1 hour'");
    expect(sql).not.toMatch(/p_(?:limit|window|now)/u);
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toMatch(
      /source_bucket_hash IN \(\s*p_previous_source_bucket_hash,\s*p_current_source_bucket_hash,\s*p_next_source_bucket_hash\s*\)/u,
    );
    expect(sql).toContain("ORDER BY bucket_hash");
    expect(sql).toContain("SET search_path = pg_catalog, public, pg_temp");
  });

  it("forces RLS, denies direct scans, and exposes only the sealed consumer", () => {
    expect(sql).toContain(
      "ALTER TABLE public_source_rate_limit_events FORCE ROW LEVEL SECURITY",
    );
    expect(sql).toMatch(
      /REVOKE ALL(?: PRIVILEGES)? ON public_source_rate_limit_events\s+FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc/u,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION consume_public_source_rate_limit\(text, text\)\s+FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc/u,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION consume_public_source_rate_limit\(text, text\)\s+TO context_runtime_svc, context_svc/u,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION consume_public_source_rate_limit\(text, text, text, text\)\s+FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc/u,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION consume_public_source_rate_limit\(text, text, text, text\)\s+TO context_runtime_svc/u,
    );
    expect(sql).not.toMatch(
      /GRANT[^;]*(?:SELECT|INSERT|UPDATE|DELETE)[^;]*public_source_rate_limit_events[^;]*context_runtime_svc/u,
    );
  });

  it("deletes buckets older than one day without retaining a raw address column", () => {
    expect(sql).toContain(
      "CREATE FUNCTION cleanup_expired_public_source_rate_limits()",
    );
    expect(sql).toContain("interval '23 hours'");
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION cleanup_expired_public_source_rate_limits\(\)\s+TO context_runtime_svc/u,
    );
    expect(sql).toContain("CREATE FUNCTION purge_public_source_rate_limits()");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION purge_public_source_rate_limits\(\)\s+FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc/u,
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION purge_public_source_rate_limits\(\)[^;]*context_runtime_svc/u,
    );
    expect(sql).toContain(
      "public_source_rate_limit_events_cleanup_idx\n  ON public_source_rate_limit_events (consumed_at)",
    );
    expect(sql).not.toMatch(/(?:ip|address)\s+(?:text|varchar|inet)/iu);
    expect(sql).toContain("source_bucket_hash char(64)");
  });
});
