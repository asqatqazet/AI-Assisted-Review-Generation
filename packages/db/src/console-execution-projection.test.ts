import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../prisma/migrations/20260823000020_console_execution_projections/migration.sql",
  ),
  "utf8",
);
const subjectSlugSql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../prisma/migrations/20260824000026_console_execution_subject_slugs/migration.sql",
  ),
  "utf8",
);

describe("Console execution projection capability", () => {
  it("exposes only fixed SECURITY DEFINER projections to generation_svc", () => {
    for (const functionName of [
      "console_execution_overview",
      "console_execution_analytics",
      "console_execution_generation_detail",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.${functionName}\\([\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = pg_catalog, public`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${functionName}\\([\\s\\S]*?FROM PUBLIC;`,
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${functionName}\\([\\s\\S]*?TO generation_svc;`,
        ),
      );
    }
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON/i);
  });

  it("validates an explicit, bounded, unique Tenant-id set in SQL", () => {
    expect(sql).toContain("jsonb_array_length(p_tenant_ids) > 1000");
    expect(sql).toContain("count(DISTINCT tenant_id)");
    expect(sql).toContain("generation.tenant_id = ANY(authorized_tenant_ids)");
  });

  it("keeps raw reviewer text and removed candidates behind the signed audit flag", () => {
    expect(sql).toContain("'sourceText', CASE WHEN p_may_read_raw_candidates");
    expect(sql).toContain("'removedClaims', CASE WHEN p_may_read_raw_candidates");
  });

  it("projects canonical subject slugs through composite ownership joins", () => {
    expect(subjectSlugSql).toContain("tenant.slug AS tenant_slug");
    expect(subjectSlugSql).toContain("location.slug AS location_slug");
    expect(subjectSlugSql).toMatch(
      /JOIN public\.locations AS location[\s\S]*?location\.id = generation\.location_id[\s\S]*?location\.tenant_id = generation\.tenant_id/,
    );
    expect(subjectSlugSql).toContain("'slug', location_slug");
    expect(subjectSlugSql).toContain("'slug', tenant_slug");
    expect(subjectSlugSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.console_execution_overview\([\s\S]*?FROM PUBLIC, generation_svc, console_control_svc, context_runtime_svc;/,
    );
    expect(subjectSlugSql).not.toMatch(/GRANT\s+EXECUTE/iu);
    expect(subjectSlugSql).not.toMatch(/GRANT\s+SELECT/iu);
  });
});
