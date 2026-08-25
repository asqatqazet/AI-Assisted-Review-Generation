import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../../..");
const migration = fs.readFileSync(
  path.join(
    root,
    "packages/db/prisma/migrations/20260824000034_configuration_release_pointers/migration.sql",
  ),
  "utf8",
);

describe("Configuration Release database boundary", () => {
  it("keeps immutable membership and append-only pointer evidence behind sealed functions", () => {
    for (const table of [
      "configuration_releases",
      "configuration_release_snapshots",
      "configuration_release_previous_pointers",
      "configuration_live_pointers",
      "configuration_release_pointer_events",
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
    for (const operation of [
      "register_configuration_release",
      "promote_configuration_release",
      "restore_configuration_release",
      "resolve_configuration_snapshot",
    ]) {
      expect(migration).toContain(`FUNCTION public.${operation}`);
    }
    expect(migration).toMatch(
      /configuration_release_pointer_events_append_only[\s\S]*?reject_published_configuration_mutation/u,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.restore_configuration_release\(uuid, uuid\)[\s\S]*?FROM PUBLIC, context_svc, context_runtime_svc, console_control_svc, generation_svc/u,
    );
  });

  it("binds Entry Challenges and Review Sessions to the selected immutable snapshot", () => {
    expect(migration).toMatch(
      /ALTER TABLE entry_challenges[\s\S]*?configuration_release_id uuid[\s\S]*?configuration_snapshot_id uuid/u,
    );
    expect(migration).toMatch(
      /ALTER TABLE review_sessions[\s\S]*?configuration_snapshot_id uuid[\s\S]*?effective_configuration_snapshots/u,
    );
    expect(migration).toMatch(
      /CREATE FUNCTION public\.prepare_entry_challenge\([\s\S]*?p_configuration_release_id uuid/u,
    );
    expect(migration).toMatch(
      /current_user = 'context_svc'[\s\S]*?configuration_live_pointers/u,
    );
    expect(migration).toMatch(
      /CREATE FUNCTION public\.bind_legacy_review_session_snapshot\(\)[\s\S]*?NEW\.configuration_snapshot_id[\s\S]*?configuration_live_pointers[\s\S]*?CREATE TRIGGER bind_legacy_review_session_snapshot/u,
    );
    expect(migration).toMatch(
      /generation_batches[\s\S]*?count\(DISTINCT evidence\.snapshot_id\)[\s\S]*?OPEN_REVIEW_SESSION_CONFIGURATION_SNAPSHOT_UNKNOWN/u,
    );
    expect(migration).not.toMatch(
      /ALTER TABLE review_sessions[\s\S]*?configuration_snapshot_id SET NOT NULL/u,
    );
  });

  it("uses exact pointer revisions for promote and restore CAS and rechecks strict Prompt policy", () => {
    expect(migration).toMatch(
      /configuration_release_previous_pointers[\s\S]*?previous_revision bigint/u,
    );
    expect(migration).toMatch(
      /live\.revision IS NOT DISTINCT FROM previous\.previous_revision/u,
    );
    expect(migration).toMatch(
      /live\.revision IS DISTINCT FROM COALESCE\(\s*previous\.previous_revision \+ 1, 1\s*\)/u,
    );
    for (const functionName of [
      "register_configuration_release",
      "promote_configuration_release",
      "restore_configuration_release",
    ]) {
      const start = migration.indexOf(`CREATE FUNCTION public.${functionName}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = migration.indexOf("$function$;", start);
      expect(migration.slice(start, end)).toContain(
        "strict_zero_snapshot_prompts_are_approved",
      );
    }
  });

  it("never mutates an existing Release membership or trusts a caller-supplied Console actor", () => {
    const registerStart = migration.indexOf(
      "CREATE FUNCTION public.register_configuration_release",
    );
    const registerEnd = migration.indexOf("$function$;", registerStart);
    const register = migration.slice(registerStart, registerEnd);
    expect(register).toContain("review_current_bound_console_operator()");
    expect(register).toContain("CONFIGURATION_RELEASE_ACTOR_FORBIDDEN");
    expect(register).toMatch(/ON CONFLICT \(id\) DO NOTHING[\s\S]*?RETURNING id/u);
    expect(register).toMatch(
      /IF inserted_release_id IS NULL THEN[\s\S]*?CONFIGURATION_RELEASE_ID_REUSED[\s\S]*?RETURN true;[\s\S]*?END IF;[\s\S]*?INSERT INTO public\.configuration_release_snapshots/u,
    );
    expect(register).toContain("CONFIGURATION_RELEASE_SCOPE_FORBIDDEN");
    expect(register.indexOf("CONFIGURATION_RELEASE_SCOPE_FORBIDDEN")).toBeLessThan(
      register.indexOf("CONFIGURATION_RELEASE_PROMPT_NOT_APPROVED"),
    );
  });

  it("authorizes the sealed snapshot resolver before returning any cross-scope identifier", () => {
    const resolveStart = migration.indexOf(
      "CREATE FUNCTION public.resolve_configuration_snapshot",
    );
    const resolveEnd = migration.indexOf("$function$;", resolveStart);
    const resolver = migration.slice(resolveStart, resolveEnd);
    expect(resolver).toContain("session_user IN ('context_svc', 'context_runtime_svc')");
    expect(resolver).toContain("current_setting('app.tenant_id', true)");
    expect(resolver).toContain("review_operator_has_tenant_capability_privileged");
  });

  it("backfills only executable active snapshots and validates the live pointer set", () => {
    expect(migration).toMatch(
      /JOIN tenants AS tenant[\s\S]*?tenant\.status = 'ACTIVE'[\s\S]*?JOIN locations AS location[\s\S]*?location\.status = 'ACTIVE'[\s\S]*?snapshot\.schema_version = 2[\s\S]*?strict_zero_snapshot_prompts_are_approved/u,
    );
    expect(migration).toMatch(
      /CREATE FUNCTION public\.assert_strict_zero_prompt_executable_state\(\)[\s\S]*?configuration_live_pointers[\s\S]*?STRICT_ZERO_PROMPT_LIVE_POINTER_NOT_APPROVED/u,
    );
  });

  it("retains the seven-argument prepare function only as a live-pointer compatibility wrapper", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.prepare_entry_challenge\([\s\S]*?p_expires_at timestamptz\s*\)[\s\S]*?prepare_entry_challenge_for_release\([\s\S]*?NULL::uuid/u,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.prepare_entry_challenge\([\s\S]*?timestamptz\s*\)[\s\S]*?TO context_svc, context_runtime_svc/u,
    );
  });
});
