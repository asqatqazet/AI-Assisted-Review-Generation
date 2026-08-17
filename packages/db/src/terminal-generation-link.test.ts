import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("US-03.2 terminal Generation persistence boundary", () => {
  it("allows Lease and Attempt evidence to exist before immutable Generation output", () => {
    const schema = fs.readFileSync(
      path.resolve(__dirname, "../prisma/schema.prisma"),
      "utf8",
    );
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        "../prisma/migrations/20260817000003_terminal_generation_link/migration.sql",
      ),
      "utf8",
    );

    const generationModel = schema.match(
      /model Generation\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    const attemptModel = schema.match(
      /model ProviderAttempt\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    const leaseModel = schema.match(
      /model ExecutionLease\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(generationModel).toMatch(/executionLeaseId\s+String\s+@unique/);
    expect(generationModel).toMatch(/executionLease\s+ExecutionLease\s+@relation/);
    expect(leaseModel).toMatch(/generation\s+Generation\?/);
    expect(attemptModel).toMatch(/executionLease\s+ExecutionLease\s+@relation/);
    expect(attemptModel).not.toMatch(/generation\s+Generation\s+@relation/);

    expect(migration).toContain(
      "DROP CONSTRAINT provider_attempts_generation_fk",
    );
    expect(migration).toContain(
      "DROP CONSTRAINT execution_leases_generation_scope_fk",
    );
    expect(migration).toMatch(
      /ADD COLUMN execution_lease_id uuid NOT NULL UNIQUE/,
    );
    expect(migration).toContain(
      "ADD CONSTRAINT generations_execution_lease_scope_fk",
    );
  });
});
