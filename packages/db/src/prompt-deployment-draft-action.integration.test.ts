import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { derivePromptVersionHash } from "@review/domain/experiment";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env["DATABASE_URL"];
const psql = process.env["PSQL_BIN"] ?? "psql";
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../prisma/migrations/20260824000031_prompt_deployment_draft_action/migration.sql",
);

async function sql(statement: string): Promise<void> {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  await execFileAsync(
    psql,
    [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", statement],
  );
}

async function scalar(statement: string): Promise<string> {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  const { stdout } = await execFileAsync(
    psql,
    [
      databaseUrl,
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ],
  );
  return stdout.trim();
}

async function replayMigration(): Promise<void> {
  if (databaseUrl === undefined) {
    throw new Error("DATABASE_URL is required");
  }
  await execFileAsync(
    psql,
    [databaseUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", migrationPath],
  );
}

describeDatabase.sequential("Prompt deployment Draft action migration", () => {
  it("backfills only a same-Tenant Prompt and rejects an orphan with an explicit diagnostic", async () => {
    const operatorId = randomUUID();
    const tenantId = randomUUID();
    const otherTenantId = randomUUID();
    const promptVersionId = randomUUID();
    const prompt = {
      key: `migration.generate.${promptVersionId}`,
      commandKind: "generate" as const,
      body: "Use only confirmed Assertions.",
      variables: [] as const,
    };
    const promptHash = derivePromptVersionHash(prompt);
    await sql(`
      INSERT INTO entry_mode_definitions (key, semantics)
      VALUES ('invite', '{}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
      INSERT INTO action_definitions (action, input_contract, status)
      VALUES ('GENERATE', '{}'::jsonb, 'ACTIVE')
      ON CONFLICT (action) DO NOTHING;
      INSERT INTO operators (id, email, external_issuer, external_subject)
      VALUES (
        '${operatorId}', 'draft-action-${operatorId}@example.test',
        'https://issuer.test', 'draft-action-${operatorId}'
      );
      INSERT INTO tenants (id, slug, name, locale, default_entry_mode_key)
      VALUES
        ('${tenantId}', 'draft-action-${tenantId}', 'Draft Action Tenant', 'en-GB', 'invite'),
        ('${otherTenantId}', 'draft-action-${otherTenantId}', 'Other Draft Tenant', 'en-GB', 'invite');
      INSERT INTO prompt_versions (
        id, tenant_id, prompt_key, action, content_hash, body, variables,
        version, status
      ) VALUES (
        '${promptVersionId}', '${tenantId}', '${prompt.key}', 'GENERATE',
        '${promptHash}', '${prompt.body}', ARRAY[]::text[], 1, 'DRAFT'
      );
      INSERT INTO configuration_drafts (
        tenant_id, base_revision, changes, created_by
      ) VALUES (
        '${tenantId}', 1,
        '[{"operation":"deploy-prompt-version","promptVersionId":"${promptVersionId}"}]'::jsonb,
        '${operatorId}'
      );
    `);

    await replayMigration();
    await expect(
      scalar(`
        SELECT changes -> 0 ->> 'action'
        FROM configuration_drafts
        WHERE tenant_id = '${tenantId}'::uuid;
      `),
    ).resolves.toBe("generate");

    await sql(`
      DELETE FROM configuration_drafts
      WHERE tenant_id = '${tenantId}'::uuid;
      INSERT INTO configuration_drafts (
        tenant_id, base_revision, changes, created_by
      ) VALUES (
        '${otherTenantId}', 1,
        '[{"operation":"deploy-prompt-version","promptVersionId":"${promptVersionId}"}]'::jsonb,
        '${operatorId}'
      );
    `);
    await expect(replayMigration()).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "LEGACY_PROMPT_DEPLOYMENT_DRAFT_ORPHANED",
      ),
    });
    await sql(`
      DELETE FROM configuration_drafts
      WHERE tenant_id = '${otherTenantId}'::uuid;
    `);
  });
});
