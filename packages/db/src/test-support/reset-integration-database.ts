import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Clears only fixture data from an isolated integration database. Migrations,
 * functions, roles and policies remain intact. This is intentionally kept out
 * of every production barrel.
 */
export async function resetIntegrationDatabase(input: {
  readonly databaseUrl: string;
  readonly psql: string;
}): Promise<void> {
  await execFileAsync(
    input.psql,
    [
      input.databaseUrl,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      `
        DO $reset$
        DECLARE
          tables_to_reset text;
        BEGIN
          SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
          INTO tables_to_reset
          FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename <> '_prisma_migrations';

          IF tables_to_reset IS NOT NULL THEN
            EXECUTE 'TRUNCATE TABLE ' || tables_to_reset || ' CASCADE';
          END IF;
        END
        $reset$;
      `,
    ],
    { maxBuffer: 1024 * 1024 },
  );
}
