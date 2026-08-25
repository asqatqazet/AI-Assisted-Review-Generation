import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  STUDENT_STRICT_ZERO_PROMPT_APPROVAL,
  strictZeroPromptContentPolicy,
} from "./prompt-release-content-policy.js";

const migration = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../prisma/migrations/20260824000033_prompt_release_approved_hash_policy/migration.sql",
  ),
  "utf8",
);

describe("strict-zero Prompt content approval", () => {
  it("approves only the explicitly reviewed immutable student Prompt", () => {
    expect(strictZeroPromptContentPolicy(STUDENT_STRICT_ZERO_PROMPT_APPROVAL)).toBe(
      "approved",
    );
    expect(
      strictZeroPromptContentPolicy({
        ...STUDENT_STRICT_ZERO_PROMPT_APPROVAL,
        promptVersionId: "00000000-0000-4000-8000-000000000999",
        promptVersionHash: `sha256:${"a".repeat(64)}`,
      }),
    ).toBe("rejected");
    expect(
      strictZeroPromptContentPolicy({
        ...STUDENT_STRICT_ZERO_PROMPT_APPROVAL,
        tenantId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe("rejected");
  });

  it("enforces the same checked-in approval in every PostgreSQL release gate", () => {
    expect(migration).toContain(
      "CREATE FUNCTION public.strict_zero_prompt_content_is_approved",
    );
    expect(migration).toContain(STUDENT_STRICT_ZERO_PROMPT_APPROVAL.tenantId);
    expect(migration).toContain(
      STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionId,
    );
    expect(migration).toContain(
      STUDENT_STRICT_ZERO_PROMPT_APPROVAL.promptVersionHash,
    );
    expect(migration).toMatch(
      /enforce_strict_zero_prompt_candidacy_content[\s\S]*strict_zero_prompt_content_is_approved/u,
    );
    expect(migration).toMatch(
      /enforce_strict_zero_prompt_deployment_content[\s\S]*strict_zero_prompt_content_is_approved/u,
    );
    expect(migration).toMatch(
      /enforce_strict_zero_running_experiment_content[\s\S]*strict_zero_prompt_content_is_approved/u,
    );
    expect(migration).toContain(
      "prompt_candidacy_decisions_01_strict_zero_content_gate",
    );
    expect(migration).toContain(
      "prompt_deployments_01_strict_zero_content_gate",
    );
    expect(migration).not.toMatch(/requested_tenant_id\s*<>/u);
    expect(migration).toContain(
      "CREATE FUNCTION public.assert_strict_zero_prompt_executable_state",
    );
    expect(migration).toContain(
      "CREATE FUNCTION public.strict_zero_snapshot_prompts_are_approved",
    );
    for (const boundary of [
      "CANDIDATE",
      "DEPLOYMENT",
      "EXPERIMENT",
      "SNAPSHOT",
    ]) {
      expect(migration).toContain(
        `STRICT_ZERO_PROMPT_UPGRADE_${boundary}_NOT_APPROVED`,
      );
    }
    expect(migration).toContain(
      "SELECT public.assert_strict_zero_prompt_executable_state()",
    );
    expect(migration).not.toMatch(
      /DELETE\s+FROM\s+(?:prompt_|effective_configuration_snapshots)/u,
    );
    expect(migration).not.toContain("providerBehaviorMeasured=true");
  });
});
