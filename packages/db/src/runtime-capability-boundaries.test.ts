import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../prisma/migrations/20260824000022_context_runtime_capabilities/migration.sql",
  ),
  "utf8",
);
const admission = fs.readFileSync(
  path.resolve(__dirname, "admission/index.ts"),
  "utf8",
);
const reviewSession = fs.readFileSync(
  path.resolve(__dirname, "review-session/index.ts"),
  "utf8",
);

describe("Context runtime database capabilities", () => {
  it("seals every runtime login as a non-inheriting, forced-RLS role", () => {
    for (const role of [
      "context_runtime_svc",
      "console_control_svc",
      "generation_svc",
    ]) {
      expect(migration).toContain(`ALTER ROLE ${role} LOGIN NOINHERIT;`);
      expect(migration).not.toMatch(
        new RegExp(`ALTER ROLE ${role}[^;]*(?:SUPERUSER|BYPASSRLS)`),
      );
    }
    expect(migration).toContain("rolsuper OR role.rolbypassrls");
    expect(migration).toContain("SERVICE_ROLE_SECURITY_ATTRIBUTES_INVALID");
  });

  it("resolves, touches and revokes browser bindings only by both exact hashes", () => {
    expect(migration).toContain(
      "ALTER TABLE review_session_browser_bindings FORCE ROW LEVEL SECURITY;",
    );
    for (const name of [
      "lookup_live_review_session_browser_binding",
      "touch_live_review_session_browser_binding",
      "revoke_live_review_session_browser_binding",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?p_route_handle_hash varchar,[\\s\\S]*?p_browser_capability_hash varchar[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = pg_catalog, public`,
        ),
      );
    }
    expect(migration).toMatch(
      /REVOKE SELECT, UPDATE, DELETE ON review_session_browser_bindings FROM context_runtime_svc;/u,
    );
    expect(reviewSession).not.toMatch(
      /FROM review_session_browser_bindings|UPDATE review_session_browser_bindings/u,
    );
  });

  it("claims only a bounded, leased queue batch and removes direct scans", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION claim_due_reconciliation_queue\([\s\S]*?p_limit integer[\s\S]*?p_limit > 100[\s\S]*?FOR UPDATE SKIP LOCKED[\s\S]*?LIMIT p_limit/u,
    );
    expect(migration).toContain("claim_expires_at");
    expect(migration).toMatch(
      /REVOKE ALL ON reconciliation_queue_items FROM context_runtime_svc;/u,
    );
    expect(admission).toContain("FROM claim_due_reconciliation_queue(");
    expect(admission).not.toMatch(
      /FROM reconciliation_queue_items\s+WHERE due_at <= clock_timestamp\(\)/u,
    );
  });

  it("locks only the mutable Review Session row during progress CAS", () => {
    expect(reviewSession).toContain("FOR UPDATE OF session");
    expect(reviewSession).not.toMatch(/Prisma\.sql`FOR UPDATE`/u);
  });
});
