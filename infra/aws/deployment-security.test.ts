import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = path.join(__dirname, "../..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const between = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing end marker: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe("student deployment security", () => {
  it("keeps Console publications inside the database-authority and HTTP timeout envelope", () => {
    const consoleTransactionOptions = read(
      "packages/db/src/control-plane/console-transaction-options.ts",
    );
    const terraform = read("infra/terraform/student/main.tf");

    expect(consoleTransactionOptions).toContain("maxWait: 2_000");
    expect(consoleTransactionOptions).toContain("timeout: 20_000");
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"context_console"[\s\S]*?timeout\s*=\s*22/u,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"web_bff_fast"[\s\S]*?timeout\s*=\s*25/u,
    );
    expect(terraform).toMatch(
      /origin_id\s*=\s*"web-bff-fast"[\s\S]*?origin_read_timeout\s*=\s*30/u,
    );
  });

  it("authenticates disposable CI service roles without changing production role provisioning", () => {
    const verify = read(".github/workflows/verify.yml");
    const deploy = read(".github/workflows/deploy-student.yml");
    const rolePasswords = read(
      "infra/local/integration-service-role-passwords.sql",
    );

    for (const workflow of [verify, deploy]) {
      expect(workflow).toContain(
        "Provision disposable integration service-role passwords",
      );
      expect(workflow).toContain(
        "../../infra/local/integration-service-role-passwords.sql",
      );
      expect(workflow).toContain(
        "TEST_SERVICE_ROLE_PASSWORD: local_only_change_me",
      );
    }
    for (const role of [
      "context_svc",
      "context_runtime_svc",
      "console_control_svc",
      "generation_svc",
    ]) {
      expect(rolePasswords).toContain(`ALTER ROLE ${role} PASSWORD`);
    }
    expect(rolePasswords).toContain("local_only_change_me");
  });

  it("stores deployment variables and secrets only in the protected student environment", () => {
    const setup = read("scripts/setup-student-deployment.sh");
    const repair = read("scripts/repair-student-deploy-role.sh");

    expect(setup).toContain('GITHUB_ENVIRONMENT="student"');
    expect(setup).toMatch(
      /gh secret delete "\$name" --repo "\$REPO_SLUG"[\s\S]*?gh secret set "\$name" --env "\$GITHUB_ENVIRONMENT"/,
    );
    expect(setup).toMatch(
      /gh variable delete "\$name" --repo "\$REPO_SLUG"[\s\S]*?gh variable set "\$name" --env "\$GITHUB_ENVIRONMENT"/,
    );
    expect(setup.indexOf("Is the student environment restricted to main?")).toBeLessThan(
      setup.indexOf('set_var AWS_DEPLOY_ROLE_ARN'),
    );
    expect(setup).toContain('gh variable list --env "$GITHUB_ENVIRONMENT"');
    expect(setup).toContain('gh secret list --env "$GITHUB_ENVIRONMENT"');
    for (const script of [setup, repair]) {
      expect(script).toContain("REPOSITORY_SECRET_COPY_STILL_PRESENT");
      expect(script).toContain("REPOSITORY_VARIABLE_COPY_STILL_PRESENT");
      expect(script).not.toContain(
        'gh secret delete "$name" --repo "$REPO_SLUG" >/dev/null 2>&1 || true',
      );
      expect(script).not.toContain(
        'gh variable delete "$name" --repo "$REPO_SLUG" >/dev/null 2>&1 || true',
      );
    }
    expect(setup).toContain("remove_repo_secret_copy GEMINI_API_KEY");
    expect(repair).toContain("REPOSITORY_SCOPED_DEPLOYMENT_VALUE_FOUND");
    expect(repair).toContain(
      'gh variable get AWS_DEPLOY_ROLE_ARN --env student --repo "$REPO_SLUG"',
    );
    const scopedAccesses = `${setup}\n${repair}`
      .split("\n")
      .filter((line) =>
        /^\s*(?:if\s+)?(?:printf[^|]*\|\s*)?gh (?:secret|variable) (?:get|set) /.test(
          line,
        ),
      );
    expect(scopedAccesses).not.toHaveLength(0);
    for (const access of scopedAccesses) {
      expect(access).toContain("--env");
    }
  });

  it("pins every GitHub Action in every workflow to a reviewed commit", () => {
    const workflows = fs
      .readdirSync(path.join(root, ".github/workflows"))
      .filter((name) => name.endsWith(".yml"))
      .map((name) => read(`.github/workflows/${name}`));
    const actionReferences = workflows.flatMap((workflow) =>
      [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]!),
    );

    expect(actionReferences).not.toHaveLength(0);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
    for (const reviewed of [
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
      "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      "pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1",
      "hashicorp/setup-terraform@b9cd54a3c349d3f38e8881555d616ced269862dd",
      "aws-actions/configure-aws-credentials@61815dcd50bd041e203e49132bacad1fd04d2708",
    ]) {
      expect(actionReferences).toContain(reviewed);
    }
  });

  it("isolates Console read and Bench authority from paid-work signing", () => {
    const setup = read("scripts/setup-student-deployment.sh");
    const repair = read("scripts/repair-student-deploy-role.sh");
    const deploy = read(".github/workflows/deploy-student.yml");
    const terraform = read("infra/terraform/student/main.tf");
    const reviewerPolicy = between(
      terraform,
      'data "aws_iam_policy_document" "context_reviewer_parameters"',
      'resource "aws_iam_role_policy" "context_reviewer_parameters"',
    );
    const consolePolicy = between(
      terraform,
      'data "aws_iam_policy_document" "context_console_parameters"',
      'resource "aws_iam_role_policy" "context_console_parameters"',
    );
    const generationPolicy = between(
      terraform,
      'data "aws_iam_policy_document" "generation_parameters"',
      'resource "aws_iam_role_policy" "generation_parameters"',
    );
    const reviewerFunction = between(
      terraform,
      'resource "aws_lambda_function" "context_reviewer"',
      'resource "aws_lambda_alias" "context_reviewer_live"',
    );
    const consoleFunction = between(
      terraform,
      'resource "aws_lambda_function" "context_console"',
      'resource "aws_lambda_alias" "context_console_live"',
    );
    const generationFunction = between(
      terraform,
      'resource "aws_lambda_function" "generation_service"',
      'resource "aws_lambda_alias" "generation_service_live"',
    );
    const canaryFunction = between(
      terraform,
      'resource "aws_lambda_function" "generation_canary"',
      "locals {\n  web_bff_environment",
    );

    expect(setup).toContain(
      'openssl genpkey -algorithm ED25519 -out "$KEY_DIRECTORY/console-authority-private.pem"',
    );
    expect(setup).toContain(
      'set_secret CONSOLE_AUTHORITY_PRIVATE_KEY_PEM "$(<"$KEY_DIRECTORY/console-authority-private.pem")"',
    );
    expect(setup).toContain(
      'set_secret CONSOLE_AUTHORITY_PUBLIC_KEY_PEM "$(<"$KEY_DIRECTORY/console-authority-public.pem")"',
    );
    for (const name of [
      "CONSOLE_AUTHORITY_PRIVATE_KEY_PEM",
      "CONSOLE_AUTHORITY_PUBLIC_KEY_PEM",
    ]) {
      expect(repair).toContain(name);
      expect(deploy).toContain(`secrets.${name}`);
      expect(setup).toContain(name);
    }
    expect(repair).toContain(
      'gh secret list --env "$GITHUB_ENVIRONMENT" --repo "$REPO_SLUG"',
    );
    expect(repair).toContain("MISSING_STUDENT_ENVIRONMENT_SECRET");
    expect(setup).toContain(
      'set_secret CONSOLE_DATABASE_AUTHORITY_SECRET "$(openssl rand -hex 32)"',
    );
    expect(repair).toContain("CONSOLE_DATABASE_AUTHORITY_SECRET");
    expect(deploy).toContain(
      "secrets.CONSOLE_DATABASE_AUTHORITY_SECRET",
    );
    expect(deploy).toContain(
      "aws ssm put-parameter --name /review-gen/student/console-authority-private-key",
    );
    expect(deploy).toContain(
      "aws ssm put-parameter --name /review-gen/student/console-authority-public-key",
    );
    expect(terraform).toMatch(
      /console_authority_private_key\s*=\s*"\/review-gen\/student\/console-authority-private-key"/,
    );
    expect(terraform).toMatch(
      /console_authority_public_key\s*=\s*"\/review-gen\/student\/console-authority-public-key"/,
    );
    expect(terraform).toMatch(
      /console_database_authority_secret\s*=\s*"\/review-gen\/student\/console-database-authority-secret"/,
    );

    expect(consolePolicy).toContain("local.parameter_names.console_authority_private_key");
    expect(consolePolicy).not.toContain("context_work_private_key");
    expect(consolePolicy).toContain(
      "local.parameter_names.console_database_authority_secret",
    );
    expect(reviewerPolicy).not.toContain("console_authority");
    expect(reviewerPolicy).not.toContain("console_database_authority");
    expect(generationPolicy).toContain("local.parameter_names.console_authority_public_key");
    expect(generationPolicy).not.toContain("console_authority_private_key");

    expect(consoleFunction).toContain(
      "CONSOLE_AUTHORITY_PRIVATE_KEY_PEM_PARAMETER = local.parameter_names.console_authority_private_key",
    );
    expect(consoleFunction).not.toContain("CONTEXT_WORK_PRIVATE_KEY_PARAMETER");
    expect(consoleFunction).toContain(
      "CONSOLE_DATABASE_AUTHORITY_SECRET_PARAMETER = local.parameter_names.console_database_authority_secret",
    );
    expect(reviewerFunction).not.toContain("CONSOLE_AUTHORITY");
    expect(reviewerFunction).not.toContain("CONSOLE_DATABASE_AUTHORITY");
    for (const generation of [generationFunction, canaryFunction]) {
      expect(generation).toContain(
        "CONSOLE_AUTHORITY_PUBLIC_KEY_PEM_PARAMETER = local.parameter_names.console_authority_public_key",
      );
      expect(generation).not.toContain("CONSOLE_AUTHORITY_PRIVATE_KEY");
      expect(generation).not.toContain("CONSOLE_DATABASE_AUTHORITY");
    }
  });

  it("verifies each sealed runtime database connection before deployment", () => {
    const verifier = read("scripts/verify-runtime-database-roles.sh");
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "review-role-check-"));
    const calls = path.join(fakeBin, "calls");
    const fakePsql = path.join(fakeBin, "psql");
    fs.writeFileSync(
      fakePsql,
      `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' "$1" >> "$PSQL_CALLS"\nprintf 'ok\\n'\n`,
      { mode: 0o700 },
    );

    try {
      const result = spawnSync(
        "bash",
        [path.join(root, "scripts/verify-runtime-database-roles.sh")],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
            PSQL_CALLS: calls,
            CONTEXT_RUNTIME_DATABASE_URL: "postgresql://context-runtime.invalid/review",
            CONSOLE_CONTROL_DATABASE_URL: "postgresql://console-control.invalid/review",
            GENERATION_DATABASE_URL: "postgresql://generation.invalid/review",
          },
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(calls, "utf8").trim().split("\n")).toEqual([
        "postgresql://context-runtime.invalid/review",
        "postgresql://console-control.invalid/review",
        "postgresql://generation.invalid/review",
      ]);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("postgresql://");
      expect(verifier).not.toContain(":'expected_role'");
      expect(verifier).toContain(
        'role_contract_sql="${ROLE_CONTRACT_SQL//__EXPECTED_ROLE__/$expected_role}"',
      );
      expect(verifier).toContain(
        "NOT has_table_privilege(current_user, 'public.operators', 'SELECT,INSERT,UPDATE,DELETE')",
      );
      expect(verifier).toContain(
        "NOT has_table_privilege(current_user, 'public.console_database_authority_keys', 'SELECT,INSERT,UPDATE,DELETE')",
      );
      expect(verifier).toContain(
        "has_function_privilege(current_user, 'public.console_resolve_operator_identity(text,text,text,bigint,uuid,text)', 'EXECUTE')",
      );
      expect(verifier).toContain(
        "has_function_privilege(current_user, 'public.console_bind_operator_authorization(uuid,bigint,uuid,text)', 'EXECUTE')",
      );
    } finally {
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("runs the sealed-role check after migrations but before publishing runtime secrets", () => {
    const workflow = read(".github/workflows/deploy-student.yml");
    const migration = workflow.indexOf(
      "Apply database migrations to the product database",
    );
    const verification = workflow.indexOf(
      "Verify sealed runtime database roles before deployment",
    );
    const secretPublication = workflow.indexOf(
      "Store operational secrets outside Terraform state",
    );

    expect(migration).toBeGreaterThan(-1);
    expect(verification).toBeGreaterThan(migration);
    expect(secretPublication).toBeGreaterThan(verification);
    expect(workflow).toMatch(
      /Verify sealed runtime database roles before deployment[\s\S]*?CONTEXT_RUNTIME_DATABASE_URL: \$\{\{ secrets\.NEON_CONTEXT_RUNTIME_DATABASE_URL \}\}[\s\S]*?CONSOLE_CONTROL_DATABASE_URL: \$\{\{ secrets\.NEON_CONSOLE_CONTROL_DATABASE_URL \}\}[\s\S]*?GENERATION_DATABASE_URL: \$\{\{ secrets\.NEON_GENERATION_DATABASE_URL \}\}[\s\S]*?scripts\/verify-runtime-database-roles\.sh/,
    );
  });

  it("provisions a hidden Console database authority after migrations", () => {
    const provisionerPath = path.join(
      root,
      "scripts/provision-console-database-authority.sh",
    );
    const workflow = read(".github/workflows/deploy-student.yml");
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "review-authority-"));
    const fakePsql = path.join(fakeBin, "psql");
    const stdinCapture = path.join(fakeBin, "stdin");
    const secret = "ab".repeat(32);
    fs.writeFileSync(
      fakePsql,
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" "$@" > "$PSQL_ARGS"\ntee "$PSQL_STDIN" >/dev/null\n',
      { mode: 0o700 },
    );

    try {
      const result = spawnSync("bash", [provisionerPath], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
          DATABASE_URL: "postgresql://migration.invalid/review",
          CONSOLE_DATABASE_AUTHORITY_SECRET: secret,
          PSQL_BIN: fakePsql,
          PSQL_ARGS: path.join(fakeBin, "args"),
          PSQL_STDIN: stdinCapture,
        },
      });

      expect(result.status, result.stderr).toBe(0);
      const provisionSql = fs.readFileSync(stdinCapture, "utf8");
      expect(provisionSql).toContain(
        "\\getenv authority_secret_hex CONSOLE_DATABASE_AUTHORITY_SECRET",
      );
      expect(provisionSql).toContain("DELETE FROM console_operator_authorizations;");
      expect(provisionSql).toContain("DELETE FROM console_operator_authority_nonces;");
      expect(provisionSql).not.toContain(secret);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(secret);
      expect(workflow.indexOf("Apply database migrations")).toBeLessThan(
        workflow.indexOf("Provision Console database authority"),
      );
      expect(workflow).toMatch(
        /Provision Console database authority[\s\S]*?CONSOLE_DATABASE_AUTHORITY_SECRET: \$\{\{ secrets\.CONSOLE_DATABASE_AUTHORITY_SECRET \}\}[\s\S]*?scripts\/provision-console-database-authority\.sh/,
      );
    } finally {
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("refuses bootstrap when any Operator already exists globally", () => {
    const authorizer = read("scripts/authorize-student-operator-state.sh");
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "review-bootstrap-"));
    const fakePsql = path.join(fakeBin, "psql");
    fs.writeFileSync(
      fakePsql,
      "#!/usr/bin/env bash\nprintf '1|0|0|0|0|0|0|0\\n'\n",
      { mode: 0o700 },
    );

    try {
      const result = spawnSync(
        "bash",
        [path.join(root, "scripts/authorize-student-operator-state.sh")],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
            DATABASE_URL: "postgresql://migration.invalid/review",
            OPERATOR_EMAIL: "platform@example.invalid",
            TENANT_OPERATOR_EMAIL: "tenant@example.invalid",
            REQUESTED_BOOTSTRAP: "true",
            GITHUB_OUTPUT: path.join(fakeBin, "outputs"),
          },
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("BOOTSTRAP_REQUIRES_EMPTY_DATABASE");
      expect(authorizer).toContain("<<'SQL'");
      expect(authorizer).not.toContain('-c "');
    } finally {
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("derives a missing Tenant-only identity independently of Platform bootstrap", () => {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "review-bootstrap-"));
    const outputs = path.join(fakeBin, "outputs");
    fs.writeFileSync(
      path.join(fakeBin, "psql"),
      "#!/usr/bin/env bash\nprintf '1|1|1|1|0|0|0|0\\n'\n",
      { mode: 0o700 },
    );

    try {
      const result = spawnSync(
        "bash",
        [path.join(root, "scripts/authorize-student-operator-state.sh")],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
            DATABASE_URL: "postgresql://migration.invalid/review",
            OPERATOR_EMAIL: "platform@example.invalid",
            TENANT_OPERATOR_EMAIL: "tenant@example.invalid",
            REQUESTED_BOOTSTRAP: "false",
            GITHUB_OUTPUT: outputs,
          },
        },
      );

      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(outputs, "utf8")).toBe(
        "platform_bootstrap=false\ntenant_bootstrap=true\n",
      );
    } finally {
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("requires distinct Platform and Tenant assessment identities without reactivating either", () => {
    const workflow = read(".github/workflows/deploy-student.yml");

    expect(workflow).toMatch(
      /tenant_operator_email:[\s\S]*?required: true[\s\S]*?bootstrap_initial_operator:/,
    );
    expect(workflow.indexOf("Apply database migrations to the product database")).toBeLessThan(
      workflow.indexOf("Authorize Operator bootstrap state"),
    );
    expect(workflow).toMatch(
      /Authorize Operator bootstrap state[\s\S]*?OPERATOR_EMAIL: \$\{\{ inputs\.operator_email \}\}[\s\S]*?TENANT_OPERATOR_EMAIL: \$\{\{ inputs\.tenant_operator_email \}\}[\s\S]*?scripts\/authorize-student-operator-state\.sh/,
    );
    expect(workflow).toContain(
      "if: ${{ steps.operator_state.outputs.platform_bootstrap == 'true' }}",
    );
    expect(workflow).toContain(
      "if: ${{ steps.operator_state.outputs.tenant_bootstrap == 'true' }}",
    );
    expect(workflow).toMatch(
      /Verify assessment Operator authorities[\s\S]*?REQUESTED_BOOTSTRAP: false[\s\S]*?scripts\/authorize-student-operator-state\.sh/,
    );
  });

  it("makes the repair wizard ask for bootstrap state and both assessment identities", () => {
    const repair = read("scripts/repair-student-deploy-role.sh");

    expect(repair).toContain(
      'ask REVIEW_TENANT_OPERATOR_EMAIL "Enter the distinct Tenant-only Console operator email:"',
    );
    expect(repair).toContain(
      'if [ "$REVIEW_OPERATOR_EMAIL" = "$REVIEW_TENANT_OPERATOR_EMAIL" ]',
    );
    expect(repair).toContain(
      'ask REVIEW_BOOTSTRAP_INITIAL_OPERATOR "Is this the first global Operator bootstrap? [false]:"',
    );
    expect(repair).toContain(
      '-f "tenant_operator_email=$REVIEW_TENANT_OPERATOR_EMAIL"',
    );
    expect(repair).toContain(
      '-f "bootstrap_initial_operator=$REVIEW_BOOTSTRAP_INITIAL_OPERATOR"',
    );
    expect(repair).toContain('-f "acknowledge_database_cutover=false"');
    expect(repair).toContain('-f "acknowledge_provider_cost=false"');
    expect(repair).not.toContain('-f "bootstrap_initial_operator=true"');
    expect(repair).not.toContain('-f "acknowledge_provider_cost=true"');
  });

  it("can repair only the deploy-role policy without dispatching a deployment", () => {
    const repair = read("scripts/repair-student-deploy-role.sh");
    const policyOnlyExit = repair.indexOf(
      'if [ "$REPAIR_POLICY_ONLY" = "true" ]; then',
    );
    const resumeStage = repair.indexOf(
      'stage "Resume and monitor the low-quota deployment"',
    );

    expect(repair).toContain("--policy-only");
    expect(repair).toContain(
      "If $POLICY_NAME already exists, expand it and choose Edit",
    );
    expect(repair).toContain(
      "If $POLICY_NAME is absent, choose Add permissions",
    );
    expect(policyOnlyExit).toBeGreaterThanOrEqual(0);
    expect(resumeStage).toBeGreaterThan(policyOnlyExit);
    expect(
      repair.slice(policyOnlyExit, resumeStage),
    ).toContain("finish");
    expect(
      repair.slice(policyOnlyExit, resumeStage),
    ).toContain("exit 0");
  });

  it("uses a separately invokable FakeProvider-only Generation canary for low quota", () => {
    const terraform = read("infra/terraform/student/main.tf");
    const canary = terraform.match(
      /resource "aws_lambda_function" "generation_canary" \{([\s\S]*?)\n\}/,
    )?.[1];
    const deploy = read(".github/workflows/deploy-student.yml");
    const rollback = read(".github/workflows/rollback-student.yml");

    expect(canary).toBeDefined();
    expect(canary).toContain("review-generation-canary-student");
    expect(canary).toMatch(/REVIEW_PROVIDER_MODE\s*= "fake-only"/);
    expect(canary).not.toContain("GEMINI_API_KEY_PARAMETER");
    expect(deploy).toMatch(
      /student-low-quota[\s\S]*?aws lambda invoke[\s\S]*?review-generation-canary-student/,
    );
    expect(rollback).not.toContain(
      "aws lambda update-function-code --function-name review-generation-canary-student",
    );
    expect(rollback).toContain("scripts/smoke-candidate-reviewer-flow.sh");
    expect(rollback).toContain('echo "frozen=false" >> "$GITHUB_OUTPUT"');
    expect(rollback).toContain('echo "frozen=true" >> "$GITHUB_OUTPUT"');
    expect(rollback).toContain(
      "if: ${{ failure() && steps.low_quota_freeze.outputs.frozen == 'true' }}",
    );
    expect(rollback).not.toContain(
      "if: ${{ env.TARGET_DEPLOYMENT_PROFILE == 'student-low-quota' }}",
    );
  });

  it("restores concurrency only when the previous live Generation was fake-only", () => {
    const restorePath = path.join(
      root,
      "scripts/restore-generation-concurrency.sh",
    );
    const workflow = read(".github/workflows/deploy-student.yml");
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "review-concurrency-"));
    const calls = path.join(fakeBin, "calls");
    fs.writeFileSync(
      path.join(fakeBin, "aws"),
      '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" "$*" >> "$AWS_CALLS"\n',
      { mode: 0o700 },
    );

    const restore = (name: string, snapshot: unknown): string => {
      const snapshotPath = path.join(fakeBin, `${name}.json`);
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
      fs.writeFileSync(calls, "");
      const result = spawnSync("bash", [restorePath], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env["PATH"] ?? ""}`,
          AWS_CALLS: calls,
          GENERATION_CONCURRENCY_SNAPSHOT: snapshotPath,
          GENERATION_FUNCTION_NAME: "review-generation-service-student",
        },
      });
      expect(result.status, result.stderr).toBe(0);
      return fs.readFileSync(calls, "utf8").trim();
    };

    try {
      expect(
        restore("fake-unreserved", {
          functionExisted: true,
          providerMode: "fake-only",
          reservedConcurrentExecutions: null,
        }),
      ).toBe(
        "lambda delete-function-concurrency --function-name review-generation-service-student",
      );
      expect(
        restore("fake-reserved", {
          functionExisted: true,
          providerMode: "fake-only",
          reservedConcurrentExecutions: 3,
        }),
      ).toBe(
        "lambda put-function-concurrency --function-name review-generation-service-student --reserved-concurrent-executions 3",
      );
      expect(
        restore("paid-reserved", {
          functionExisted: true,
          providerMode: "paid-enabled",
          reservedConcurrentExecutions: 3,
        }),
      ).toBe(
        "lambda put-function-concurrency --function-name review-generation-service-student --reserved-concurrent-executions 0",
      );
      expect(
        restore("first-deploy", {
          functionExisted: false,
          providerMode: null,
          reservedConcurrentExecutions: null,
        }),
      ).toBe("");
      expect(workflow).toContain("providerMode:$providerMode");
      expect(workflow).toContain("scripts/restore-generation-concurrency.sh");
    } finally {
      fs.rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it("persists the teardown date and schedules a fail-safe service cutoff", () => {
    const deploy = read(".github/workflows/deploy-student.yml");
    const cutoff = read(".github/workflows/student-cutoff.yml");
    const terraform = read("infra/terraform/student/main.tf");
    const outputs = read("infra/terraform/student/outputs.tf");

    expect(deploy).toContain('-var="teardown_date=${{ inputs.teardown_date }}"');
    expect(deploy).toContain("--arg teardownDate \"$REVIEW_TEARDOWN_DATE\"");
    expect(terraform).toContain('name  = "/review-gen/student/teardown-date"');
    expect(outputs).toContain('output "cutoff_lambda_function_names"');
    expect(outputs).toContain('output "reconcile_event_rule_name"');
    expect(cutoff).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(cutoff).toContain("environment: student");
    expect(cutoff).toContain(
      "aws ssm get-parameter --name /review-gen/student/teardown-date",
    );
    expect(cutoff).toContain("aws cloudfront update-distribution");
    expect(cutoff).toContain("aws events disable-rule");
    expect(cutoff).toContain("--reserved-concurrent-executions 0");
    expect(cutoff).toContain("SELECT public.purge_public_source_rate_limits();");
    expect(cutoff.indexOf("purge_public_source_rate_limits")).toBeLessThan(
      cutoff.indexOf("aws cloudfront update-distribution"),
    );
  });

  it("runs synthetic reviewer, role-isolation, release and non-billing Bench evidence after promotion", () => {
    const smokePath = path.join(root, "scripts/post-deploy-assessment-smoke.sh");
    const smoke = fs.readFileSync(smokePath, "utf8");
    const workflow = read(".github/workflows/deploy-student.yml");
    const syntax = spawnSync("bash", ["-n", smokePath], {
      cwd: root,
      encoding: "utf8",
    });

    expect(syntax.status, syntax.stderr).toBe(0);
    expect(smoke).not.toContain("set -x");
    expect(smoke).toContain('operation:"resolve-operator-access"');
    expect(smoke).toContain('view:"platform-tenants"');
    expect(smoke).toContain('status == "not-found"');
    expect(smoke).toContain('operation:"authorize-console-bench"');
    expect(smoke).toContain('operation:"console-bench"');
    expect(smoke).toMatch(
      /BENCH_FORM_EVENT="\$\(jq -cn --argjson identity "\$PLATFORM_IDENTITY"/,
    );
    expect(smoke).toMatch(
      /AUTHORIZE_BENCH_EVENT="\$\(jq -cn[\s\S]*?--argjson identity "\$PLATFORM_IDENTITY"/,
    );
    expect(smoke).toContain("BENCH_GENERATIONS_BEFORE");
    expect(smoke).toContain("BENCH_GENERATIONS_AFTER");
    expect(smoke).toContain("/api/v1/entry-challenges/");
    expect(smoke).toContain("/api/v1/review-sessions/");
    expect(smoke).toContain('"status":"completed"');
    expect(workflow.indexOf("Promote verified candidates and probe live")).toBeLessThan(
      workflow.indexOf("Run post-deploy assessment evidence"),
    );
    expect(workflow).toContain("scripts/post-deploy-assessment-smoke.sh");
  });

  it("completes a zero-cost reviewer Generation through the candidate UI and version-pinned BFF before BFF promotion", () => {
    const smokePath = path.join(root, "scripts/smoke-candidate-reviewer-flow.sh");
    const smoke = fs.readFileSync(smokePath, "utf8");
    const workflow = read(".github/workflows/deploy-student.yml");
    const syntax = spawnSync("bash", ["-n", smokePath], {
      cwd: root,
      encoding: "utf8",
    });

    expect(syntax.status, syntax.stderr).toBe(0);
    for (const route of [
      "/s/speicher-neun/hafencity",
      "/api/v1/entry-challenges/",
      "/api/v1/review-sessions/",
      "/generations",
    ]) {
      expect(smoke).toContain(route);
    }
    expect(smoke).toContain("invoke-with-response-stream");
    expect(smoke).toContain(
      'invoke_buffered "review-web-bff-fast-student"',
    );
    expect(smoke).toContain("review-web-bff-stream-student");
    expect(smoke).toContain("__candidate/${CANDIDATE_ID}/release.json");
    expect(smoke).toContain("candidateBffReviewerGenerationCompleted:true");
    expect(smoke).toContain("CANDIDATE_REVIEWER_SMOKE_FAILED:${SMOKE_STAGE}");
    expect(smoke).toContain('SMOKE_STAGE="generation-stream"');
    expect(smoke).toContain('"x-forwarded-for":"127.0.0.1"');
    expect(smoke).toContain('"x-review-public-origin":$publicOrigin');
    expect(workflow).toContain('PUBLIC_ORIGIN="https://$DOMAIN"');
    expect(smoke).not.toContain("set -x");
    expect(smoke).toContain("configuration_release_snapshots");
    expect(smoke).toContain("OBSERVED_CONFIGURATION_RELEASE_ID");
    expect(smoke).toContain("OBSERVED_CONFIGURATION_SNAPSHOT_ID");
    expect(workflow).toMatch(
      /Complete a reviewer Generation through the candidate UI and BFF[\s\S]*?DATABASE_URL:\s*\$\{\{ secrets\.NEON_MIGRATION_DATABASE_URL \}\}/u,
    );
    expect(smoke).not.toContain("review-context-reviewer-student");
    expect(smoke).not.toContain("review-generation-service-student");
    const candidateFlow = workflow.indexOf(
      "Complete a reviewer Generation through the candidate UI and BFF",
    );
    const servicePromotion = workflow.indexOf("Promote candidate services");
    const bffPromotion = workflow.indexOf("Promote the candidate BFF and UI");
    expect(candidateFlow).toBeGreaterThan(-1);
    expect(servicePromotion).toBeGreaterThan(candidateFlow);
    expect(servicePromotion).toBeLessThan(bffPromotion);
    expect(workflow).toContain("scripts/smoke-candidate-reviewer-flow.sh");
    const rollback = read(".github/workflows/rollback-student.yml");
    expect(rollback).toContain("scripts/smoke-candidate-reviewer-flow.sh");
    expect(rollback).toMatch(
      /Complete a reviewer Generation through the candidate UI and BFF[\s\S]*?DATABASE_URL:\s*\$\{\{ secrets\.NEON_MIGRATION_DATABASE_URL \}\}/u,
    );
    expect(rollback.indexOf("scripts/smoke-candidate-reviewer-flow.sh")).toBeLessThan(
      rollback.indexOf("Activate the target Configuration Release"),
    );
  });

  it("compensates Configuration pointer promotion and never reopens low-quota Generation after a rejected migration", () => {
    const deploy = read(".github/workflows/deploy-student.yml");
    const rollback = read(".github/workflows/rollback-student.yml");

    expect(deploy).toContain("id: product_migration");
    expect(deploy).toContain("id: configuration_promote");
    expect(deploy).toContain("public.promote_configuration_release");
    expect(deploy).toContain("public.restore_configuration_release");
    expect(deploy).toContain("steps.configuration_promote.outcome == 'success'");
    expect(deploy).toContain("steps.product_migration.outcome == 'success'");
    const servicePromote = deploy.slice(
      deploy.indexOf("- name: Promote candidate services"),
      deploy.indexOf("- name: Promote the candidate BFF and UI"),
    );
    expect(servicePromote).toMatch(
      /assert_strict_zero_prompt_executable_state[\s\S]*?(delete-function-concurrency|put-function-concurrency)/u,
    );

    expect(rollback).toContain("configurationCandidateReleaseId");
    expect(rollback).toContain("public.activate_configuration_release");
    expect(rollback).toContain("public.restore_configuration_release");
    expect(rollback).toContain("id: activation_identity");
    expect(rollback.indexOf("id: activation_identity")).toBeLessThan(
      rollback.indexOf("id: configuration_activate"),
    );
    expect(rollback).toContain(
      "ACTIVATION_RELEASE_ID: ${{ steps.activation_identity.outputs.id }}",
    );
    expect(rollback).toContain(
      "steps.configuration_activate.outcome == 'success'",
    );

    const deployConcurrencyRestore = deploy.slice(
      deploy.indexOf("- name: Restore only a previously safe Generation concurrency"),
      deploy.indexOf("- uses: actions/upload-artifact"),
    );
    expect(deployConcurrencyRestore).toMatch(
      /assert_strict_zero_prompt_executable_state[\s\S]*?restore-generation-concurrency\.sh/u,
    );
    const rollbackConcurrencyRestore = rollback.slice(
      rollback.indexOf("- name: Restore prior low-quota concurrency after rollback failure"),
    );
    expect(rollbackConcurrencyRestore).toMatch(
      /assert_strict_zero_prompt_executable_state[\s\S]*?(delete-function-concurrency|put-function-concurrency)/u,
    );
  });

  it("retains low-quota canary pins needed by the immediately previous BFF release", () => {
    const deploy = read(".github/workflows/deploy-student.yml");
    expect(deploy).toContain(
      "generation-(service|canary))-student:[1-9][0-9]*$",
    );
  });

  it("writes release checksums with relocatable artifact basenames", () => {
    const deploy = read(".github/workflows/deploy-student.yml");
    const rollback = read(".github/workflows/rollback-student.yml");

    expect(deploy).toContain(
      '(cd "$RELEASE_DIR" && shasum -a 256 *.zip > checksums.sha256)',
    );
    expect(deploy).not.toContain(
      'shasum -a 256 "$RELEASE_DIR"/*.zip > "$RELEASE_DIR/checksums.sha256"',
    );
    expect(rollback).toContain(
      "(cd release && shasum -a 256 -c checksums.sha256)",
    );
    expect(rollback).not.toContain(
      "shasum -a 256 -c release/checksums.sha256",
    );
    expect(deploy).toContain(".sha256.aliasVersions = $aliasVersions");
    expect(rollback).toContain(".sha256.aliasVersions");
    expect(rollback).toContain('release/alias-versions.json" | cut -d \' \' -f 1');
  });

  it("limits deploy-role management and PassRole to the five bounded runtime roles", () => {
    const guides = `${read("scripts/setup-student-deployment.sh")}\n${read("scripts/repair-student-deploy-role.sh")}`;

    for (const role of [
      "review-web-bff-student-role",
      "review-context-service-student-role",
      "review-context-reviewer-student-role",
      "review-context-console-student-role",
      "review-generation-service-student-role",
    ]) {
      expect(guides).toContain(`role/${role}`);
    }
    expect(guides).toContain('"iam:PassedToService": "lambda.amazonaws.com"');
    expect(guides).toContain('"iam:PermissionsBoundary"');
  });
});
