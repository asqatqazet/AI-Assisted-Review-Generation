import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.join(__dirname, "../..");
const validator = path.join(root, "scripts/validate-neon-database-url.mjs");

const validate = (value: string) =>
  spawnSync(process.execPath, [validator], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL_TO_CHECK: value,
    },
  });

describe("Neon migration-owner URL validation", () => {
  it("makes the wizard clear invalid retained input and ask again", () => {
    const setup = fs.readFileSync(
      path.join(root, "scripts/setup-student-deployment.sh"),
      "utf8",
    );

    expect(setup).toContain("scripts/validate-neon-database-url.mjs");
    expect(setup).toMatch(
      /ask_secret NEON_MIGRATION_DATABASE_URL[\s\S]*?until DATABASE_URL_TO_CHECK=[\s\S]*?do[\s\S]*?NEON_MIGRATION_DATABASE_URL=""[\s\S]*?read -rs NEON_MIGRATION_DATABASE_URL[\s\S]*?done/,
    );
    expect(setup).not.toContain(
      "const url = new URL(process.env.DATABASE_URL_TO_CHECK)",
    );
  });

  it("accepts a direct Frankfurt TLS URL including channel binding", () => {
    const result = validate(
      "postgresql://neondb_owner:redacted@ep-example.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("rejects pooled URLs", () => {
    const result = validate(
      "postgresql://neondb_owner:redacted@ep-example-pooler.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require",
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("rejects prompt text without echoing the invalid secret candidate", () => {
    const invalid = "Paste the direct migration-owner URL:";
    const result = validate(invalid);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
