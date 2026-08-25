import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../prisma/migrations/20260824000021_console_execution_authorization/migration.sql",
  ),
  "utf8",
);

describe("Console execution database authorization", () => {
  it("derives scope in PostgreSQL instead of accepting Tenant ids from Generation", () => {
    expect(sql).toContain("CREATE TABLE console_execution_read_authorizations");
    expect(sql).toMatch(
      /CREATE FUNCTION console_execution_mint_authorization\([\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, public/u,
    );
    expect(sql).toContain("review_operator_has_tenant_capability_privileged");
    expect(sql).toContain("review_operator_has_platform_capability_privileged");
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.console_execution_overview\(\s*p_authorization_id uuid\s*\)/u,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.console_execution_analytics\(\s*p_authorization_id uuid\s*\)/u,
    );
    expect(sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.console_execution_(?:overview|analytics)\(\s*jsonb/u,
    );
  });

  it("keeps raw reviewer material behind a separate audited function", () => {
    expect(sql).toContain("'audit:read-raw'");
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.console_execution_generation_detail_audit\(\s*p_authorization_id uuid\s*\)/u,
    );
    expect(sql).toMatch(
      /console_execution_generation_detail_audit[\s\S]*?auth_record\.may_read_raw/u,
    );
    expect(sql).toContain("'{generation,freeTextAssertions}'");
    expect(sql).toContain("'{generation,sourceText}'");
    expect(sql).toContain("'{generation,removedClaims}'");
    expect(sql).toContain("'{generation,claims}'");
  });

  it("leaves no direct or legacy projection escape hatch", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON console_execution_read_authorizations FROM PUBLIC, context_runtime_svc, console_control_svc, generation_svc;/u,
    );
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.console_execution_generation_detail\(\s*jsonb, uuid, uuid, boolean\s*\) FROM generation_svc;/u,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.console_execution_generation_detail\(uuid\) TO generation_svc;/u,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.console_execution_generation_detail_audit\(uuid\) TO generation_svc;/u,
    );
  });
});
