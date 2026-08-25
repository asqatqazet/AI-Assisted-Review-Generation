import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.join(
    here,
    "../prisma/migrations/20260823000018_configuration_publication/migration.sql",
  ),
  "utf8",
);
const roleMigration = fs.readFileSync(
  path.join(
    here,
    "../prisma/migrations/20260823000019_operator_capability_rls/migration.sql",
  ),
  "utf8",
);

describe("immutable published configuration records", () => {
  it.each(["prompt_versions", "effective_configuration_snapshots"])(
    "rejects UPDATE and DELETE of %s even when a caller retains a broad grant",
    (table) => {
      expect(migration).toMatch(
        new RegExp(
          `CREATE TRIGGER ${table}_append_only[\\s\\S]*BEFORE UPDATE OR DELETE ON ${table}`,
          "u",
        ),
      );
    },
  );

  it("removes legacy mutation grants from the old Context role", () => {
    expect(migration).toContain(
      "REVOKE UPDATE, DELETE, TRUNCATE ON prompt_versions, effective_configuration_snapshots FROM context_svc;",
    );
  });

  it("gives the Console role INSERT-only access to immutable records", () => {
    expect(roleMigration).toMatch(
      /GRANT INSERT ON prompt_versions, effective_configuration_snapshots\s+TO console_control_svc;/u,
    );
    expect(roleMigration).toMatch(
      /REVOKE UPDATE, DELETE, TRUNCATE ON\s+prompt_versions, effective_configuration_snapshots\s+FROM console_control_svc;/u,
    );
  });
});
