import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("US-03.2 fenced execution persistence", () => {
  it("persists finite scoped leases and unique Attempt ordinals", () => {
    const schema = fs.readFileSync(
      path.resolve(__dirname, "../prisma/schema.prisma"),
      "utf8",
    );
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        "../prisma/migrations/20260817000002_fenced_generation/migration.sql",
      ),
      "utf8",
    );

    expect(schema).toMatch(
      /enum ExecutionLeaseState\s*\{[\s\S]*LEASED[\s\S]*RUNNING[\s\S]*CANCELLED[\s\S]*TERMINAL[\s\S]*\}/,
    );
    expect(schema).toMatch(
      /model ExecutionLease\s*\{[\s\S]*permitJti[\s\S]*generationBatchId[\s\S]*generationId[\s\S]*leaseExpiresAt[\s\S]*state\s+ExecutionLeaseState[\s\S]*@@unique\(\[id, tenantId, locationId, reviewSessionId, generationId\]\)[\s\S]*@@map\("execution_leases"\)/,
    );
    expect(schema).toMatch(
      /model ProviderAttempt\s*\{[\s\S]*executionLeaseId[\s\S]*attemptOrdinal[\s\S]*@@unique\(\[executionLeaseId, attemptOrdinal\]\)/,
    );

    expect(migration).toContain("CREATE TABLE execution_leases");
    expect(migration).toMatch(
      /CONSTRAINT execution_leases_expiry_order CHECK \(lease_expires_at <= permit_expires_at\)/,
    );
    expect(migration).toContain(
      "ALTER TABLE execution_leases ENABLE ROW LEVEL SECURITY;",
    );
    expect(migration).toContain(
      "ALTER TABLE execution_leases FORCE ROW LEVEL SECURITY;",
    );
    expect(migration).toContain(
      "CREATE POLICY tenant_isolation_policy ON execution_leases",
    );
    expect(migration).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON execution_leases TO generation_svc;/,
    );
    expect(migration).not.toMatch(/GRANT[^;]*execution_leases[^;]*context_svc/);
  });
});
