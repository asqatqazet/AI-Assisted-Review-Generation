import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = path.join(
  __dirname,
  "../prisma/migrations",
);

describe("SECURITY DEFINER migration safety", () => {
  it("places pg_temp last in every explicit function search path", () => {
    const insecureFunctions: string[] = [];
    for (const migration of fs.readdirSync(migrationsDirectory).sort()) {
      const migrationPath = path.join(
        migrationsDirectory,
        migration,
        "migration.sql",
      );
      if (!fs.existsSync(migrationPath)) {
        continue;
      }
      const lines = fs.readFileSync(migrationPath, "utf8").split("\n");
      for (const [index, line] of lines.entries()) {
        if (line.trim() !== "SECURITY DEFINER") {
          continue;
        }
        const searchPath = lines[index + 1]?.trim() ?? "";
        if (!/^SET search_path = .*, pg_temp$/u.test(searchPath)) {
          insecureFunctions.push(
            `${migration}/migration.sql:${String(index + 1)} ${searchPath}`,
          );
        }
      }
    }

    expect(insecureFunctions).toEqual([]);
  });
});
