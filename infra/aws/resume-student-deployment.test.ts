import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const wizard = readFileSync(
  new URL("../../scripts/resume-student-deployment-from-neon.sh", import.meta.url),
  "utf8",
);

describe("student deployment Neon recovery wizard", () => {
  it("resumes only the original stages 4 through 7", () => {
    expect(wizard).toContain("TOTAL_STAGES=4");
    expect(wizard).toContain('banner "Resume student deployment from Neon"');
    expect(wizard).not.toContain('stage "Revoke the exposed AWS root key"');
    expect(wizard).not.toContain('stage "Create the GitHub OIDC deployment role"');
  });

  it("validates a hidden direct URL before using it", () => {
    expect(wizard).toMatch(
      /ask_secret NEON_MIGRATION_DATABASE_URL[\s\S]*?until DATABASE_URL_TO_CHECK="\$NEON_MIGRATION_DATABASE_URL" node scripts\/validate-neon-database-url\.mjs/u,
    );
    expect(wizard).not.toContain("echo $NEON_MIGRATION_DATABASE_URL");
  });

  it("recovers only the known failed migration before retrying deploy", () => {
    expect(wizard).toContain("P3009");
    expect(wizard).toContain("20260823000019_operator_capability_rls");
    expect(wizard).toMatch(
      /migrate resolve[\s\S]*?--rolled-back "\$FAILED_MIGRATION"[\s\S]*?migrate deploy/u,
    );
    expect(wizard).toContain("UNEXPECTED_FAILED_MIGRATION");
  });

  it("continues with the three runtime URLs and release secrets", () => {
    for (const secret of [
      "NEON_MIGRATION_DATABASE_URL",
      "NEON_CONTEXT_RUNTIME_DATABASE_URL",
      "NEON_CONSOLE_CONTROL_DATABASE_URL",
      "NEON_GENERATION_DATABASE_URL",
      "PUBLIC_SOURCE_RATE_HMAC_SECRET",
      "CONSOLE_DATABASE_AUTHORITY_SECRET",
    ]) {
      expect(wizard).toContain(`set_secret ${secret}`);
    }
    expect(wizard).toContain("actions/workflows/deploy-student.yml");
  });

  it("replays only migration 19 and completes stages 4 through 7", () => {
    const root = mkdtempSync(join(tmpdir(), "review-neon-resume-"));
    const bin = join(root, "bin");
    const state = join(root, "state");
    mkdirSync(bin);
    mkdirSync(state);
    const install = (name: string, source: string): void => {
      const path = join(bin, name);
      writeFileSync(path, source, "utf8");
      chmodSync(path, 0o700);
    };
    install(
      "open",
      "#!/usr/bin/env bash\nexit 0\n",
    );
    install(
      "gh",
      `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  "auth status") exit 0 ;;
  "repo view --json nameWithOwner --jq .nameWithOwner") printf '%s\\n' 'asqatqazet/AI-Assisted-Review-Generation' ;;
  "secret set"*) cat >/dev/null; printf 'secret:%s\\n' "$*" >> "$MOCK_STATE_DIR/operations" ;;
  "secret list --repo"*) exit 0 ;;
  "variable list --repo"*) exit 0 ;;
  "secret list --env"*) exit 0 ;;
  "variable list --env"*) exit 0 ;;
  *) printf 'unexpected gh invocation: %s\\n' "$*" >&2; exit 1 ;;
esac
`,
    );
    install(
      "pnpm",
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"migrate deploy"* ]]; then
  if [[ ! -f "$MOCK_STATE_DIR/first-deploy" ]]; then
    touch "$MOCK_STATE_DIR/first-deploy"
    printf '%s\\n' 'Error: P3009' 'The 20260823000019_operator_capability_rls migration failed.' >&2
    exit 1
  fi
  printf '%s\\n' 'deploy:success' >> "$MOCK_STATE_DIR/operations"
elif [[ "$*" == *"migrate resolve"*"--rolled-back 20260823000019_operator_capability_rls"* ]]; then
  printf '%s\\n' 'resolve:20260823000019_operator_capability_rls' >> "$MOCK_STATE_DIR/operations"
elif [[ "$*" == *"prisma db execute"* ]]; then
  cat >/dev/null
  printf '%s\\n' 'db:execute' >> "$MOCK_STATE_DIR/operations"
else
  printf 'unexpected pnpm invocation: %s\\n' "$*" >&2
  exit 1
fi
`,
    );

    const directUrl =
      "postgresql://owner:rotated@ep-test.c-5.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    const result = spawnSync(
      "bash",
      ["scripts/resume-student-deployment-from-neon.sh"],
      {
        cwd: new URL("../..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          MOCK_STATE_DIR: state,
          PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
        },
        input: `\ny\n${directUrl}\ny\n`,
      },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(readFileSync(join(state, "operations"), "utf8")).toMatch(
      /resolve:20260823000019_operator_capability_rls[\s\S]*deploy:success/u,
    );
    expect(result.stdout).toContain("Stage 4/4");
    expect(result.stdout).not.toContain("Revoke the exposed AWS root key");
  });
});
