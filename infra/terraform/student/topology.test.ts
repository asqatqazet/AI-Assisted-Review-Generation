import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("student AWS topology invariants", () => {
  it("targets the accepted Frankfurt region and repository Node runtime", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const variables = fs.readFileSync(
      path.join(__dirname, "variables.tf"),
      "utf8",
    );

    expect(variables).toMatch(
      /variable\s+"aws_region"\s*\{[\s\S]*?default\s*=\s*"eu-central-1"/,
    );
    expect(terraform).not.toContain('runtime       = "nodejs20.x"');
    expect(terraform.match(/runtime\s*=\s*"nodejs24\.x"/g)).toHaveLength(8);
  });

  it("publishes immutable service artifacts behind qualified live aliases", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform).not.toContain("dummy-context.zip");
    expect(terraform).not.toContain("dummy-gen.zip");
    expect(terraform).not.toContain('function_version = "$LATEST"');
    expect(terraform.match(/publish\s*=\s*true/g)).toHaveLength(10);
    expect(terraform.match(/source_code_hash\s*=\s*filebase64sha256/g)).toHaveLength(8);
    expect(terraform).toContain(
      "function_version = aws_lambda_function.context_reviewer.version",
    );
    expect(terraform).toContain(
      "function_version = aws_lambda_function.context_console.version",
    );
    expect(terraform).toContain(
      "function_version = aws_lambda_function.generation_service.version",
    );
    expect(terraform).toContain(
      "function_version = aws_lambda_function.web_bff_stream.version",
    );
  });

  it("pins each BFF release to immutable service versions and promotes the BFF last", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const variables = fs.readFileSync(
      path.join(__dirname, "variables.tf"),
      "utf8",
    );
    const deploy = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );

    const environment = terraform.slice(
      terraform.indexOf("web_bff_environment"),
      terraform.indexOf('resource "aws_lambda_function" "web_bff_fast"'),
    );
    expect(environment).toContain(
      "aws_lambda_function.context_reviewer.qualified_arn",
    );
    expect(environment).toContain(
      "aws_lambda_function.context_console.qualified_arn",
    );
    expect(environment).toMatch(
      /GENERATION_FUNCTION_ALIAS_ARN\s*=\s*aws_lambda_function\.generation_service\.qualified_arn/u,
    );
    expect(environment).toMatch(
      /GENERATION_CANDIDATE_FUNCTION_ALIAS_ARN\s*=\s*\(\s*var\.deployment_profile == "student-low-quota"\s*\? aws_lambda_function\.generation_canary\.qualified_arn\s*:\s*aws_lambda_function\.generation_service\.qualified_arn/u,
    );
    expect(environment).toContain(
      "REVIEW_CONFIGURATION_RELEASE_ID",
    );
    expect(environment).not.toContain("context_reviewer_live.arn");
    expect(environment).not.toContain("context_console_live.arn");
    expect(environment).not.toContain("generation_service_live.arn");
    expect(variables).toContain(
      'variable "web_bff_rollback_service_version_arns"',
    );
    expect(variables).toMatch(
      /review-\(context-reviewer\|context-console\|generation-\(service\|canary\)\)-student/u,
    );
    expect(variables).toContain('variable "configuration_candidate_release_id"');
    expect(terraform).toContain(
      "var.web_bff_rollback_service_version_arns",
    );
    expect(terraform).toMatch(
      /resources\s*=\s*concat\([\s\S]*?aws_lambda_function\.context_reviewer\.qualified_arn[\s\S]*?aws_lambda_function\.context_console\.qualified_arn[\s\S]*?aws_lambda_function\.generation_service\.qualified_arn[\s\S]*?var\.web_bff_rollback_service_version_arns/u,
    );
    expect(terraform).toMatch(
      /resources\s*=\s*concat\([\s\S]*?aws_lambda_function\.generation_canary\.qualified_arn/u,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"generation_canary"[\s\S]*?publish\s*=\s*true/u,
    );
    expect(deploy).toContain("Capture rollback BFF service version pins");
    expect(deploy).toContain(
      '-var="web_bff_rollback_service_version_arns=$ROLLBACK_SERVICE_VERSION_ARNS"',
    );
    const servicePromotion = deploy.indexOf("Promote candidate services");
    const candidateBffFlow = deploy.indexOf(
      "Complete a reviewer Generation through the candidate UI and BFF",
    );
    const bffPromotion = deploy.indexOf("Promote the candidate BFF and UI");
    expect(servicePromotion).toBeGreaterThan(0);
    expect(candidateBffFlow).toBeGreaterThan(0);
    expect(servicePromotion).toBeGreaterThan(candidateBffFlow);
    expect(bffPromotion).toBeGreaterThan(servicePromotion);
  });

  it("smokes candidate aliases and staged UI before promotion and restores on failure", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const deploy = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );
    const rollback = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/rollback-student.yml"),
      "utf8",
    );

    expect(terraform.match(/resource\s+"aws_lambda_alias"\s+"[^"]+_candidate"/g)).toHaveLength(6);
    expect(terraform.match(/lifecycle\s*\{\s*ignore_changes\s*=\s*\[function_version\]/g)).toHaveLength(7);
    const deployCandidateAt = deploy.indexOf("Smoke candidate aliases and staged UI");
    const deployPromoteAt = deploy.indexOf("Promote the candidate BFF and UI");
    const rollbackCandidateAt = rollback.indexOf("Smoke candidate aliases and staged UI");
    const rollbackPromoteAt = rollback.indexOf(
      "Promote verified candidate BFF and UI",
    );
    expect(deployCandidateAt).toBeGreaterThan(0);
    expect(deployPromoteAt).toBeGreaterThan(deployCandidateAt);
    expect(rollbackCandidateAt).toBeGreaterThan(0);
    expect(rollbackPromoteAt).toBeGreaterThan(rollbackCandidateAt);
    for (const workflow of [deploy, rollback]) {
      expect(workflow).toContain("--qualifier candidate");
      expect(workflow).toContain("__candidate/$CANDIDATE_ID");
      expect(workflow).toContain("previous-alias-versions.json");
    }
    expect(rollback).toContain("steps.configuration_activate.outcome == 'success'");
    expect(rollback).toContain("steps.service_promote.outcome == 'failure'");
    expect(rollback).toContain("steps.promote.outcome == 'failure'");
    expect(deploy).toContain("steps.configuration_promote.outcome == 'success'");
    expect(deploy).toContain("steps.strict_zero_pre_unfreeze.outcome == 'failure'");
    expect(deploy).toContain("steps.service_promote.outcome == 'failure'");
    expect(deploy).toContain("steps.promote.outcome == 'failure'");
    expect(deploy).toContain("steps.assessment_smoke.outcome == 'failure'");
    expect(deploy).toContain("public.restore_configuration_release");
  });

  it("keeps the published combined Context version rollback-compatible through the expand release", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const deploy = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );
    const rollback = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/rollback-student.yml"),
      "utf8",
    );
    const migration19 = fs.readFileSync(
      path.join(
        __dirname,
        "../../../packages/db/prisma/migrations/20260823000019_operator_capability_rls/migration.sql",
      ),
      "utf8",
    );
    const migration25 = fs.readFileSync(
      path.join(
        __dirname,
        "../../../packages/db/prisma/migrations/20260824000025_console_database_authority/migration.sql",
      ),
      "utf8",
    );
    const contextProject = fs.readFileSync(
      path.join(__dirname, "../../../apps/context-service/project.json"),
      "utf8",
    );
    const candidateSmoke = fs.readFileSync(
      path.join(
        __dirname,
        "../../../scripts/smoke-candidate-reviewer-flow.sh",
      ),
      "utf8",
    );

    expect(terraform).toContain(
      'context_service    = "review-context-service-student"',
    );
    expect(terraform).toContain(
      'context_reviewer   = "review-context-reviewer-student"',
    );
    expect(terraform).toContain(
      'name                 = "review-context-service-student-role"',
    );
    expect(terraform).toContain(
      'name                 = "review-context-reviewer-student-role"',
    );
    for (const move of [
      "aws_iam_role.context_service",
      "aws_iam_role_policy.context_logs",
      "aws_iam_role_policy.context_parameters",
      "aws_cloudwatch_log_group.context_service",
      "aws_lambda_function.context_service",
      "aws_lambda_alias.context_service_live",
    ]) {
      expect(terraform).not.toContain(`from = ${move}`);
    }
    expect(terraform).toContain(
      'context_database_url_legacy       = "/review-gen/student/context-database-url"',
    );
    const reviewerParameters = terraform.slice(
      terraform.indexOf(
        'data "aws_iam_policy_document" "context_reviewer_parameters"',
      ),
      terraform.indexOf(
        'resource "aws_iam_role_policy" "context_reviewer_parameters"',
      ),
    );
    const legacyParameters = terraform.slice(
      terraform.indexOf('data "aws_iam_policy_document" "context_parameters"'),
      terraform.indexOf('resource "aws_iam_role_policy" "context_parameters"'),
    );
    expect(legacyParameters).toContain(
      "parameter${local.parameter_names.context_database_url_legacy}",
    );
    expect(reviewerParameters).not.toContain("context_database_url_legacy");
    expect(reviewerParameters).not.toContain("console_control_database_url");
    expect(reviewerParameters).not.toContain("console_authority_private_key");
    expect(reviewerParameters).not.toContain(
      "console_database_authority_secret",
    );
    const legacyFunction = terraform.slice(
      terraform.indexOf('resource "aws_lambda_function" "context_service"'),
      terraform.indexOf('resource "aws_lambda_alias" "context_service_live"'),
    );
    const reviewerFunction = terraform.slice(
      terraform.indexOf('resource "aws_lambda_function" "context_reviewer"'),
      terraform.indexOf('resource "aws_lambda_alias" "context_reviewer_live"'),
    );
    expect(legacyFunction).toContain(
      "role                           = aws_iam_role.context_service.arn",
    );
    expect(reviewerFunction).toContain(
      "role                           = aws_iam_role.context_reviewer.arn",
    );
    expect(reviewerFunction).not.toContain(
      "CONTEXT_DATABASE_URL_PARAMETER",
    );
    expect(terraform).not.toContain(
      'resource "aws_lambda_alias" "context_service_candidate"',
    );
    expect(terraform).not.toContain(
      'resource "aws_lambda_function_url" "context_service"',
    );
    expect(terraform).not.toMatch(
      /resource\s+"aws_cloudwatch_event_target"[\s\S]*?aws_lambda_alias\.context_service_live/u,
    );
    const newBffEnvironment = terraform.slice(
      terraform.indexOf('locals {\n  web_bff_environment = {'),
      terraform.indexOf('resource "aws_lambda_function" "web_bff_fast"'),
    );
    expect(newBffEnvironment).toContain(
      "aws_lambda_function.context_reviewer.qualified_arn",
    );
    expect(newBffEnvironment).not.toContain(
      "aws_lambda_alias.context_service_live.arn",
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"context_service"[\s\S]*?handler\s*=\s*"main\.handler"[\s\S]*?lifecycle\s*\{[\s\S]*?ignore_changes/u,
    );
    expect(contextProject).toContain("apps/context-service/src/main.ts");
    expect(candidateSmoke).toContain(
      'invoke_buffered "review-web-bff-fast-student"',
    );
    expect(candidateSmoke).not.toContain(
      'readonly REVIEWER_FUNCTION="review-context-service-student"',
    );
    for (const workflow of [deploy, rollback]) {
      expect(workflow).toContain("review-context-service-student");
      expect(workflow).toContain("review-context-reviewer-student");
      expect(workflow).toContain("dbCompatibility");
    }
    const beforeMigration = deploy.indexOf(
      "Probe the rollback Context before database expansion",
    );
    const migrate = deploy.indexOf(
      "Apply database migrations to the product database",
    );
    const afterMigration = deploy.indexOf(
      "Probe the rollback Context after database expansion",
    );
    expect(beforeMigration).toBeGreaterThan(0);
    expect(migrate).toBeGreaterThan(beforeMigration);
    expect(afterMigration).toBeGreaterThan(migrate);
    expect(deploy).toContain("--query Configuration.FunctionArn");
    expect(deploy).toContain(
      'echo "version_arn=$LEGACY_VERSION_ARN" >> "$GITHUB_OUTPUT"',
    );
    expect(deploy).toContain("scripts/probe-legacy-context-generation.sh");
    expect(rollback).toContain("Probe retained legacy Context version");
    expect(rollback).toContain(
      'LEGACY_VERSION="$(jq -r .dbCompatibility.legacyContextVersion release/release-manifest.json)"',
    );
    expect(rollback).toContain("scripts/probe-legacy-context-generation.sh");
    expect(rollback).toContain("scripts/smoke-candidate-reviewer-flow.sh");
    expect(rollback).toContain("public.activate_configuration_release");
    expect(rollback).toContain("public.restore_configuration_release");
    expect(migration19).toContain("ALTER ROLE context_svc LOGIN NOINHERIT;");
    expect(migration19).not.toMatch(
      /ALTER ROLE context_svc[^;]*(?:SUPERUSER|BYPASSRLS)/u,
    );
    expect(migration19).toContain("SERVICE_ROLE_SECURITY_ATTRIBUTES_INVALID");
    expect(migration19).not.toContain("ALTER ROLE context_svc NOLOGIN");
    expect(migration25).toContain("session_user = 'context_svc'");
    expect(migration25).toContain(
      "current_user NOT IN ('console_control_svc', 'context_svc')",
    );
  });

  it("never reports deployment or smoke evidence from placeholder commands", () => {
    const deployWorkflowPath = path.join(
      __dirname,
      "../../../.github/workflows/deploy-student.yml",
    );
    expect(fs.existsSync(deployWorkflowPath)).toBe(true);

    const workflow = fs.readFileSync(deployWorkflowPath, "utf8");

    expect(workflow).not.toMatch(/#\s*aws\s+lambda\s+update-function-code/);
    expect(workflow).not.toMatch(/echo\s+["']Smoke test passed/);
    expect(workflow).not.toMatch(/echo\s+["']Lambda alias shifted/);
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("aws-actions/configure-aws-credentials");
    expect(workflow).toContain("pnpm aws:preflight");
    expect(workflow).toContain("terraform plan");
    expect(workflow).toContain("terraform apply");
    expect(workflow).toContain("terraform init -backend-config");
    expect(workflow).toContain("prisma migrate deploy");
    expect(workflow).toContain("seed-student.sql");
    expect(workflow).toContain("aws ssm put-parameter");
    expect(workflow).toContain("aws s3 sync");
    expect(workflow).toContain("actions/upload-artifact");
    expect(workflow).toContain("aws cloudfront create-invalidation");
    expect(workflow).toContain("curl --fail-with-body");
    expect(workflow).toContain("/s/speicher-neun/hafencity");
    expect(workflow).toContain("shasum -a 256");
    expect(workflow).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
  });

  it("binds GitHub OIDC and IAM mutation to the protected student environment and exact bounded roles", () => {
    const deploy = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );
    const rollback = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/rollback-student.yml"),
      "utf8",
    );
    const setup = fs.readFileSync(
      path.join(__dirname, "../../../scripts/setup-student-deployment.sh"),
      "utf8",
    );
    const repair = fs.readFileSync(
      path.join(__dirname, "../../../scripts/repair-student-deploy-role.sh"),
      "utf8",
    );
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const exactRoleNames = [
      "review-web-bff-student-role",
      "review-context-service-student-role",
      "review-context-reviewer-student-role",
      "review-context-console-student-role",
      "review-generation-service-student-role",
    ];

    expect(deploy).toMatch(/jobs:\s*\n\s*deploy:[\s\S]*?environment:\s*student/);
    expect(rollback).toMatch(/jobs:\s*\n\s*rollback:[\s\S]*?environment:\s*student/);
    expect(`${setup}\n${repair}`).not.toContain("role/review-*-student-role");
    for (const roleName of exactRoleNames) {
      expect(setup).toContain(`role/${roleName}`);
      expect(repair).toContain(`role/${roleName}`);
    }
    expect(setup).toContain(":environment:student");
    expect(setup).not.toContain(":ref:refs/heads/main");
    expect(`${setup}\n${repair}`).toContain("iam:PermissionsBoundary");
    expect(`${setup}\n${repair}`).toContain("ReviewStudentLambdaBoundary");
    expect(terraform.match(/permissions_boundary\s*=\s*local\.service_role_permissions_boundary_arn/g)).toHaveLength(5);
  });

  it("packages ESM metadata and validates Lambda handlers before deployment", () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );

    expect(workflow).toContain(
      "pnpm exec tsx infra/aws/prepare-lambda-artifacts-command.ts",
    );
    expect(workflow).toContain(
      "node --no-experimental-detect-module --check dist/apps/web-bff/main.js",
    );
    expect(workflow).toContain(
      'unzip -p "$artifact" package.json',
    );
    expect(workflow).toContain(
      'unzip -l "$RELEASE_DIR/context-service.zip"',
    );
    expect(workflow).toContain(
      'unzip -l "$RELEASE_DIR/generation-service.zip"',
    );
    expect(workflow).toContain("libquery_engine-rhel-openssl-3.0.x.so.node");
  });

  it("deploys the reviewed low-quota profile explicitly from preflight through Terraform", () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );

    expect(workflow).toMatch(
      /deployment_profile:[\s\S]*?type:\s*choice[\s\S]*?default:\s*student-low-quota/,
    );
    expect(workflow).toContain(
      "REVIEW_DEPLOYMENT_PROFILE: ${{ inputs.deployment_profile }}",
    );
    expect(workflow).toContain(
      '-var="deployment_profile=${{ inputs.deployment_profile }}"',
    );

    const outputs = fs.readFileSync(
      path.join(__dirname, "outputs.tf"),
      "utf8",
    );
    expect(outputs).toMatch(
      /output\s+"deployment_profile"\s*\{[\s\S]*?value\s*=\s*var\.deployment_profile/,
    );
  });

  it("ships the prototype-aligned Speicher Neun fixture on FakeProvider", () => {
    const seed = fs.readFileSync(
      path.join(__dirname, "../../aws/seed-student.sql"),
      "utf8",
    );

    expect(seed).toContain("speicher-neun");
    expect(seed).toContain("hafencity");
    expect(seed).toContain("Frischer Fisch");
    expect(seed).toContain("fake-v1");
    expect(seed).toContain('"minimumFactSelections":1');
    expect(seed).not.toContain('"minimumFactSelections":2');
    expect(seed).not.toContain("tripadvisor.com/Search");
    expect(seed).toMatch(
      /'00000000-0000-4000-8000-000000000143',[\s\S]*?'https:\/\/www\.tripadvisor\.com\/',[\s\S]*?false\s*\)/,
    );
    // A live provider may be catalogued so an operator can see and route it,
    // but the shipped fixture carries no credential for one: the deploy
    // installs that separately, and only when a key was actually supplied.
    expect(seed).toMatch(/'Google Gemini',\n\s*'',/);
    expect(seed).not.toMatch(/AIza[\w-]{10,}|sk-[\w-]{10,}/);
  });

  it("deletes an unreferenced garbage Location and archives it when history exists", () => {
    const seed = fs.readFileSync(
      path.join(__dirname, "../../aws/seed-student.sql"),
      "utf8",
    );

    expect(seed).toMatch(/DELETE FROM locations[\s\S]*?slug = 'fsdfdsfsdfsd'/u);
    expect(seed).toMatch(
      /WHEN foreign_key_violation THEN[\s\S]*?UPDATE locations[\s\S]*?SET status = 'INACTIVE'/u,
    );
    expect(seed).toContain("name = 'Archived test Location'");
    expect(seed).toContain("slug = 'archived-' || replace(id::text, '-', '')");
    expect(seed).not.toMatch(
      /INSERT INTO locations[\s\S]{0,500}fsdfdsfsdfsd/,
    );
  });

  it("ships an executable rollback workflow that moves only qualified aliases", () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/rollback-student.yml"),
      "utf8",
    );

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("aws lambda update-alias");
    expect(workflow).toContain("gh run download");
    expect(workflow).toContain("aws s3 sync");
    expect(workflow).toContain("aws cloudfront create-invalidation");
    expect(workflow).not.toContain("$LATEST");
    expect(workflow).toContain("curl --fail-with-body");
  });

  it("accepts rollback artifacts only from a successful main deploy and derives targets from current state", () => {
    const deploy = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );
    const rollback = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/rollback-student.yml"),
      "utf8",
    );

    expect(rollback).toContain(
      'gh api "repos/$GITHUB_REPOSITORY/actions/runs/$RELEASE_RUN_ID"',
    );
    for (const binding of [
      '.name == "deploy-student"',
      '.head_branch == "main"',
      '.status == "completed"',
      '.conclusion == "success"',
    ]) {
      expect(rollback).toContain(binding);
    }
    expect(rollback).toMatch(
      /HEAD_SHA=.*run-metadata\.json[\s\S]*?\.releaseId == \$headSha/,
    );
    expect(deploy).toContain("canonical-ui.sha256");
    expect(deploy).toContain("deploymentProfile:$deploymentProfile");
    expect(rollback).toContain("canonical-ui.sha256");
    for (const [manifestKey, artifact] of [
      ["webBff", "web-bff.zip"],
      ["context", "context-service.zip"],
      ["generation", "generation-service.zip"],
    ]) {
      expect(rollback).toContain(`.sha256.${manifestKey}`);
      expect(rollback).toContain(`${manifestKey} ${artifact}`);
    }
    expect(rollback).toMatch(
      /shasum -a 256 "release\/\$artifact"[\s\S]*?\.sha256\[\$manifestKey\]/,
    );
    expect(rollback).toContain("TARGET_DEPLOYMENT_PROFILE");
    expect(rollback).toContain(
      'terraform -chdir="$TF_DIR" output -raw deployment_profile',
    );
    expect(rollback).toContain("ROLLBACK_PROFILE_MISMATCH");
    expect(rollback).toMatch(
      /get-function-configuration[\s\S]*?--qualifier candidate[\s\S]*?REVIEW_PROVIDER_MODE/,
    );
    expect(rollback).toContain('terraform -chdir="$TF_DIR" init');
    expect(rollback).toContain('-backend-config="key=student/terraform.tfstate"');
    expect(rollback).toContain(
      'terraform -chdir="$TF_DIR" output -raw ui_bucket_name',
    );
    expect(rollback).toContain(
      'terraform -chdir="$TF_DIR" output -raw cloudfront_distribution_id',
    );
    expect(rollback).not.toContain("deployment-outputs.json");
  });

  it("stores non-secret Terraform state remotely and routes the real health probe", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform).toMatch(/backend\s+"s3"\s*\{\s*\}/);
    expect(terraform).toMatch(/path_pattern\s*=\s*"\/health"/);
    expect(terraform).toMatch(/target_origin_id\s*=\s*"web-bff-fast"/);
  });

  it("does not create Function URLs for private Context or Generation services", () => {
    const terraform = fs.readFileSync(
      path.join(__dirname, "main.tf"),
      "utf8",
    );

    expect(terraform).not.toMatch(
      /resource\s+"aws_lambda_function_url"\s+"(?:context|generation)_service_url"/,
    );
  });

  it("does not put placeholder or provider secret values into Terraform state", () => {
    const terraform = fs.readFileSync(
      path.join(__dirname, "main.tf"),
      "utf8",
    );
    const variables = fs.readFileSync(
      path.join(__dirname, "variables.tf"),
      "utf8",
    );

    expect(terraform).not.toContain("dummy-key-to-be-overridden");
    expect(terraform).not.toMatch(
      /resource\s+"aws_ssm_parameter"\s+"(?:openai|gemini|anthropic)_api_key"/,
    );
    expect(terraform).not.toContain("parameter/review-gen/student/providers/*");
    expect(terraform).not.toMatch(/PROVIDER_API_KEY/);
    // Terraform may name the parameter that holds a provider key; it must
    // never carry the key itself, or the value lands in remote state.
    expect(terraform).not.toMatch(/(?:OPENAI|GEMINI|ANTHROPIC)_API_KEY\s*=/);
    expect(terraform).toMatch(
      /GEMINI_API_KEY_PARAMETER\s*=\s*local\.parameter_names\.gemini_api_key/,
    );
    expect(terraform).toContain("CONTEXT_RUNTIME_DATABASE_URL_PARAMETER");
    expect(terraform).toContain("CONSOLE_CONTROL_DATABASE_URL_PARAMETER");
    expect(terraform).toContain("GENERATION_DATABASE_URL_PARAMETER");
    expect(terraform).not.toMatch(/\bDATABASE_URL_PARAMETER\s*=/);
    expect(terraform).toContain("REVIEW_CSRF_SECRET_PARAMETER");
    expect(terraform).toContain('actions = ["ssm:GetParameter"]');
    expect(terraform).not.toMatch(/DATABASE_URL\s*=\s*var\./);
    expect(terraform).not.toMatch(/PRIVATE_KEY_B64\s*=\s*var\./);
    expect(terraform).not.toMatch(/REVIEW_CSRF_SECRET\s*=\s*var\./);
    expect(variables).not.toMatch(/variable\s+"(?:database_url|review_csrf_secret|.*private_key_b64)"/);
  });

  it("deploys sealed reviewer-runtime and Console-control database connections", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const workflow = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );
    const setup = fs.readFileSync(
      path.join(__dirname, "../../../scripts/setup-student-deployment.sh"),
      "utf8",
    );

    for (const parameter of [
      "/review-gen/student/context-runtime-database-url",
      "/review-gen/student/console-control-database-url",
    ]) {
      expect(terraform).toContain(parameter);
      expect(workflow).toContain(parameter);
    }
    expect(terraform).toContain("CONTEXT_RUNTIME_DATABASE_URL_PARAMETER");
    expect(terraform).toContain("CONSOLE_CONTROL_DATABASE_URL_PARAMETER");
    expect(workflow).toContain("NEON_CONTEXT_RUNTIME_DATABASE_URL");
    expect(workflow).toContain("NEON_CONSOLE_CONTROL_DATABASE_URL");
    expect(setup).toContain("context_runtime_svc");
    expect(setup).toContain("console_control_svc");
    expect(`${terraform}\n${workflow}\n${setup}`).not.toContain(
      "NEON_CONTEXT_DATABASE_URL",
    );
  });

  it("derives the trusted public origin at the CloudFront viewer boundary without a bootstrap cycle", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const variables = fs.readFileSync(
      path.join(__dirname, "variables.tf"),
      "utf8",
    );
    const originFunction = fs.readFileSync(
      path.join(__dirname, "api-origin.js"),
      "utf8",
    );

    expect(variables).not.toMatch(/variable\s+"review_public_origin"/);
    expect(terraform).not.toContain("REVIEW_PUBLIC_ORIGIN");
    expect(terraform).toContain("aws_cloudfront_function.api_origin.arn");
    expect(originFunction).toContain('request.headers["x-review-public-origin"]');
    expect(originFunction).toContain('"https://" + request.headers.host.value');
  });

  it("allows the Generation Lambda to outlive the bounded 60-second provider call", () => {
    const terraform = fs.readFileSync(
      path.join(__dirname, "main.tf"),
      "utf8",
    );

    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"generation_service"\s*\{[\s\S]*?timeout\s*=\s*75/,
    );
  });

  it("exposes only the fast and streaming BFF aliases through IAM Function URLs", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform.match(/resource\s+"aws_lambda_function_url"/g)).toHaveLength(
      2,
    );
    expect(terraform.match(/authorization_type\s*=\s*"AWS_IAM"/g)).toHaveLength(
      2,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function_url"\s+"web_bff_stream"[\s\S]*?invoke_mode\s*=\s*"RESPONSE_STREAM"/,
    );
    expect(terraform).not.toMatch(
      /resource\s+"aws_lambda_function_url"\s+"(?:context|generation)/,
    );
  });

  it("uses private S3 and Lambda OAC origins behind one default-domain CloudFront distribution", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform).toMatch(
      /origin_access_control_origin_type\s*=\s*"s3"/,
    );
    expect(terraform.match(/origin_access_control_origin_type\s*=\s*"lambda"/g)).toHaveLength(
      2,
    );
    expect(terraform).toContain('resource "aws_cloudfront_distribution" "student"');
    expect(terraform).toMatch(/target_origin_id\s*=\s*"web-bff-stream"/);
    expect(terraform).toMatch(
      /path_pattern\s*=\s*"\/api\/v1\/review-sessions\/\*\/generations"/,
    );
    expect(terraform).toContain("response_completion_timeout = 95");
    expect(terraform).toMatch(/origin_read_timeout\s*=\s*30/);
    expect(terraform).toContain("cloudfront_default_certificate = true");
    expect(terraform).not.toMatch(/aliases\s*=/);
    expect(terraform).not.toMatch(/aws_route53|aws_acm_certificate|aws_wafv2/);
  });

  it("redirects every viewer to HTTPS and applies browser security headers", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(
      terraform.match(/viewer_protocol_policy\s*=\s*"redirect-to-https"/g),
    ).toHaveLength(6);
    expect(
      terraform.match(
        /response_headers_policy_id\s*=\s*aws_cloudfront_response_headers_policy\.browser_security\.id/g,
      ),
    ).toHaveLength(6);
    expect(terraform).toContain(
      'content_security_policy = "default-src \'self\'; base-uri \'self\'; connect-src \'self\'; font-src \'self\'; frame-ancestors \'none\'; img-src \'self\' data:; object-src \'none\'; script-src \'self\'; style-src \'self\'; form-action \'self\'"',
    );
    expect(terraform).toContain('header   = "Permissions-Policy"');
    expect(terraform).toContain('header   = "X-Robots-Tag"');
    expect(terraform).toMatch(/content_type_options\s*\{[\s\S]*?override\s*=\s*true/);
    expect(terraform).toMatch(/strict_transport_security\s*\{[\s\S]*?include_subdomains\s*=\s*true/);
    expect(terraform).toMatch(/referrer_policy\s*\{[\s\S]*?strict-origin-when-cross-origin/);
  });

  it("publishes the mutable shell separately from immutable hashed assets", () => {
    for (const workflowName of ["deploy-student.yml", "rollback-student.yml"]) {
      const workflow = fs.readFileSync(
        path.join(__dirname, `../../../.github/workflows/${workflowName}`),
        "utf8",
      );
      expect(workflow).toContain(
        '--cache-control "public,max-age=31536000,immutable"',
      );
      expect(workflow).toContain(
        '--cache-control "no-cache,no-store,must-revalidate"',
      );
      expect(workflow).toContain('--exclude "index.html"');
      expect(workflow).toContain('aws s3 cp');
    }
  });

  it("publishes and verifies release identity from the Git commit SHA", () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );
    const rollback = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/rollback-student.yml"),
      "utf8",
    );

    expect(workflow).toMatch(
      /name:\s*Verify and build exactly once[\s\S]*?REVIEW_RELEASE_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/,
    );
    expect(workflow).toMatch(
      /--arg releaseSha "\$GITHUB_SHA"[\s\S]*?> "\$RELEASE_DIR\/ui\/release\.json"/,
    );
    expect(workflow).toMatch(
      /aws s3 cp "\$RELEASE_DIR\/ui\/release\.json"[\s\S]*?--cache-control "no-cache,no-store,must-revalidate"/,
    );
    expect(workflow).toMatch(
      /curl[\s\S]*?"https:\/\/\$DOMAIN\/release\.json"[\s\S]*?jq -r \.releaseSha[\s\S]*?= "\$GITHUB_SHA"/,
    );
    expect(rollback).toContain('--exclude "release.json"');
    expect(rollback).toMatch(
      /aws s3 cp release\/ui\/release\.json[\s\S]*?--cache-control "no-cache,no-store,must-revalidate"/,
    );
    expect(rollback).toMatch(
      /release\/ui\/release\.json[\s\S]*?"https:\/\/\$DOMAIN\/release\.json"/,
    );
  });

  it("provisions Cognito Authorization Code + PKCE login and routes auth only through the BFF", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const variables = fs.readFileSync(
      path.join(__dirname, "variables.tf"),
      "utf8",
    );
    const outputs = fs.readFileSync(path.join(__dirname, "outputs.tf"), "utf8");
    const workflow = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );

    expect(terraform).toContain('resource "aws_cognito_user_pool" "operators"');
    expect(terraform).toMatch(/user_pool_tier\s*=\s*"LITE"/);
    expect(terraform).toMatch(/managed_login_version\s*=\s*1/);
    expect(terraform).not.toMatch(/managed_login_version\s*=\s*2/);
    expect(terraform).toContain(
      'resource "aws_cognito_user_pool_client" "operator_console"',
    );
    expect(terraform).toMatch(/allowed_oauth_flows\s*=\s*\["code"\]/);
    expect(terraform).toMatch(
      /allowed_oauth_flows_user_pool_client\s*=\s*true/,
    );
    expect(terraform).toMatch(/generate_secret\s*=\s*false/);
    expect(terraform).not.toContain("refresh_token_rotation");
    expect(terraform).toMatch(/enable_token_revocation\s*=\s*true/);
    expect(terraform).toMatch(/refresh_token_validity\s*=\s*1/);
    expect(terraform).toMatch(/path_pattern\s*=\s*"\/auth\/\*"/);
    expect(terraform).toContain("OPERATOR_SESSION_SECRET_PARAMETER");
    expect(terraform).toContain("OPERATOR_OIDC_CONFIG_PARAMETER");
    expect(variables).toMatch(/variable\s+"operator_email"/);
    expect(outputs).toContain('output "operator_oidc_issuer"');
    expect(outputs).toContain('output "operator_subject"');
    expect(workflow).toContain("TF_VAR_operator_email");
    expect(workflow).not.toContain('-var="operator_email=${{');
    expect(workflow).toContain("seed-operator-access.sql");
    expect(workflow).toContain("/api/v1/console/session");
    expect(workflow).not.toMatch(/OPERATOR_(?:PASSWORD|ACCESS_TOKEN|ID_TOKEN)/);
  });

  it("keeps initial Operator bootstrap out of routine deployments", () => {
    const workflow = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );

    expect(workflow).toMatch(
      /bootstrap_initial_operator:[\s\S]*?type:\s*boolean[\s\S]*?default:\s*false/,
    );
    expect(workflow).toMatch(
      /name:\s*Authorize Operator bootstrap state[\s\S]*?id:\s*operator_state[\s\S]*?authorize-student-operator-state\.sh/,
    );
    expect(workflow).toMatch(
      /name:\s*Bootstrap the initial Operator Access Grants[\s\S]*?if:\s*\$\{\{\s*steps\.operator_state\.outputs\.platform_bootstrap\s*==\s*'true'\s*\}\}/,
    );
    expect(workflow).toMatch(
      /name:\s*Bootstrap the Tenant-only Operator Access Grant[\s\S]*?if:\s*\$\{\{\s*steps\.operator_state\.outputs\.tenant_bootstrap\s*==\s*'true'\s*\}\}/,
    );
    expect(workflow).toMatch(
      /name:\s*Verify assessment Operator authorities[\s\S]*?REQUESTED_BOOTSTRAP:\s*false[\s\S]*?authorize-student-operator-state\.sh/,
    );
    const guide = fs.readFileSync(
      path.join(__dirname, "../../../docs/STUDENT-DEPLOYMENT-GUIDE.md"),
      "utf8",
    );
    expect(guide).toMatch(
      /`bootstrap_initial_operator`[\s\S]*?默认保持 `false`[\s\S]*?才设置 `true`/u,
    );
    expect(guide).toContain("bootstrap_initial_operator = false");
  });

  it("keeps the IAM repair wizard dispatch inputs aligned with the deployment workflow", () => {
    const wizard = fs.readFileSync(
      path.join(__dirname, "../../../scripts/repair-student-deploy-role.sh"),
      "utf8",
    );

    expect(wizard).toContain('-f "operator_email=$REVIEW_OPERATOR_EMAIL"');
    expect(wizard).toContain(
      '-f "bootstrap_initial_operator=$REVIEW_BOOTSTRAP_INITIAL_OPERATOR"',
    );
    expect(wizard).toContain('-f "acknowledge_provider_cost=false"');
    expect(wizard).not.toContain("acknowledge_fake_provider_only");
  });

  it("can invite a Tenant-only Operator without handling a password", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const variables = fs.readFileSync(
      path.join(__dirname, "variables.tf"),
      "utf8",
    );
    const outputs = fs.readFileSync(path.join(__dirname, "outputs.tf"), "utf8");
    const workflow = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );

    expect(variables).toMatch(
      /variable\s+"tenant_operator_email"[\s\S]*?default\s*=\s*""/,
    );
    const tenantOperatorResource = terraform.match(
      /resource\s+"aws_cognito_user"\s+"tenant_operator"\s*\{[\s\S]*?\n\}/,
    )?.[0];
    expect(tenantOperatorResource).toMatch(
      /count\s*=\s*var\.tenant_operator_email\s*==\s*""\s*\?\s*0\s*:\s*1/,
    );
    expect(outputs).toContain('output "tenant_operator_subject"');
    expect(workflow).toContain("TF_VAR_tenant_operator_email");
    expect(workflow).toContain("seed-tenant-operator-access.sql");
    expect(`${tenantOperatorResource}\n${workflow}`).not.toMatch(
      /TENANT_OPERATOR_(?:PASSWORD|ACCESS_TOKEN|ID_TOKEN)|\btemporary_password\s*=/,
    );
  });

  it("makes the student-low-quota profile incapable of selecting a paid provider", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const workflow = fs.readFileSync(
      path.join(__dirname, "../../../.github/workflows/deploy-student.yml"),
      "utf8",
    );

    expect(terraform).toMatch(
      /data\s+"aws_iam_policy_document"\s+"generation_parameters"[\s\S]*?resources\s*=\s*concat\([\s\S]*?var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?[\s\S]*?gemini_api_key[\s\S]*?:\s*\[\]/,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"generation_service"[\s\S]*?variables\s*=\s*merge\([\s\S]*?var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*\{[\s\S]*?GEMINI_API_KEY_PARAMETER[\s\S]*?:\s*\{\}/,
    );
    expect(workflow).toMatch(
      /name:\s*Require the provider cost acknowledgement[\s\S]*?if:\s*\$\{\{\s*inputs\.deployment_profile\s*==\s*'reserved-concurrency'\s*&&\s*!inputs\.acknowledge_provider_cost\s*\}\}/,
    );
    expect(workflow).toMatch(
      /REVIEW_DEPLOYMENT_PROFILE:\s*\$\{\{\s*inputs\.deployment_profile\s*\}\}[\s\S]*?if \[ "\$REVIEW_DEPLOYMENT_PROFILE" = "reserved-concurrency" \] && \[ -n "\$\{GEMINI_API_KEY:-\}" \]/,
    );
    expect(workflow).toMatch(
      /UPDATE providers[\s\S]*?status\s*=\s*CASE[\s\S]*?WHEN '\$REVIEW_DEPLOYMENT_PROFILE' = 'student-low-quota'[\s\S]*?THEN 'RETIRED'::catalog_status/,
    );
    expect(terraform.match(/REVIEW_PROVIDER_MODE\s*=\s*var\.deployment_profile\s*==\s*"student-low-quota"\s*\?\s*"fake-only"\s*:\s*"paid-enabled"/g)).toHaveLength(4);

    const freezeAt = workflow.indexOf(
      "Freeze Generation before low-quota mutation",
    );
    const mutationAt = workflow.indexOf(
      "Store operational secrets outside Terraform state",
    );
    const candidateAt = workflow.indexOf(
      "Smoke candidate aliases and staged UI",
    );
    const promoteAt = workflow.indexOf("Promote candidate services");
    expect(freezeAt).toBeGreaterThan(0);
    expect(freezeAt).toBeLessThan(mutationAt);
    expect(candidateAt).toBeGreaterThan(mutationAt);
    expect(promoteAt).toBeGreaterThan(candidateAt);
    expect(workflow).toContain("generation-concurrency-before-low.json");
    expect(workflow).toContain(
      "aws lambda put-function-concurrency --function-name review-generation-service-student --reserved-concurrent-executions 0",
    );
    expect(workflow).toMatch(
      /Smoke candidate aliases and staged UI[\s\S]*?fake-only[\s\S]*?get-function-configuration[\s\S]*?--qualifier candidate[\s\S]*?REVIEW_PROVIDER_MODE/,
    );
    expect(workflow).toMatch(
      /Promote candidate services[\s\S]*?update-alias --function-name review-generation-service-student[\s\S]*?delete-function-concurrency/,
    );
    expect(workflow).toMatch(
      /Restore only a previously safe Generation concurrency[\s\S]*?restore-generation-concurrency\.sh/,
    );
    expect(workflow).toContain("providerMode:$providerMode");
  });

  it("omits function reservations only for the explicit low-quota profile", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const variables = fs.readFileSync(
      path.join(__dirname, "variables.tf"),
      "utf8",
    );

    expect(variables).toMatch(/variable\s+"deployment_profile"/);
    expect(variables).toContain('"student-low-quota"');
    expect(variables).toContain('"reserved-concurrency"');
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"web_bff_fast"[\s\S]*?reserved_concurrent_executions\s*=\s*var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*5\s*:\s*null[\s\S]*?timeout\s*=\s*25/,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"web_bff_stream"[\s\S]*?reserved_concurrent_executions\s*=\s*var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*2\s*:\s*null[\s\S]*?timeout\s*=\s*85/,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"context_reviewer"[\s\S]*?reserved_concurrent_executions\s*=\s*var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*4\s*:\s*null[\s\S]*?timeout\s*=\s*7/,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"context_console"[\s\S]*?reserved_concurrent_executions\s*=\s*var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*1\s*:\s*null[\s\S]*?timeout\s*=\s*22/,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"generation_service"[\s\S]*?reserved_concurrent_executions\s*=\s*var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*1\s*:\s*null[\s\S]*?timeout\s*=\s*75/,
    );
    expect(terraform).not.toContain("provisioned_concurrent_executions");
  });

  it("lets only BFF roles invoke qualified service aliases and EventBridge invoke reconciliation", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform).toContain("aws_lambda_alias.context_reviewer_live.arn");
    expect(terraform).toContain("aws_lambda_alias.context_service_live.arn");
    expect(terraform).toContain("aws_lambda_alias.context_console_live.arn");
    expect(terraform).toContain("aws_lambda_alias.generation_service_live.arn");
    expect(terraform).toContain('principal     = "events.amazonaws.com"');
    expect(terraform).toContain("aws_cloudwatch_event_rule.reconcile.arn");
    expect(terraform).not.toMatch(/aws_apigateway|aws_api_gateway|aws_nat_gateway/);
  });

  it("seals reviewer and Console Context Lambdas behind disjoint roles and parameters", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");
    const outputs = fs.readFileSync(path.join(__dirname, "outputs.tf"), "utf8");

    expect(terraform).toMatch(
      /resource\s+"aws_iam_role"\s+"context_reviewer"[\s\S]*?name\s*=\s*"review-context-reviewer-student-role"/u,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_iam_role"\s+"context_console"[\s\S]*?name\s*=\s*"review-context-console-student-role"/u,
    );
    expect(terraform).toMatch(
      /data\s+"aws_iam_policy_document"\s+"context_reviewer_parameters"[\s\S]*?context_runtime_database_url[\s\S]*?context_work_private_key[\s\S]*?generation_work_public_key/u,
    );
    expect(terraform).toMatch(
      /data\s+"aws_iam_policy_document"\s+"context_console_parameters"[\s\S]*?console_control_database_url[\s\S]*?context_work_private_key/u,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"context_reviewer"[\s\S]*?handler\s*=\s*"reviewer-main\.handler"[\s\S]*?CONTEXT_RUNTIME_DATABASE_URL_PARAMETER/u,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"context_console"[\s\S]*?handler\s*=\s*"console-main\.handler"[\s\S]*?CONSOLE_CONTROL_DATABASE_URL_PARAMETER/u,
    );
    expect(terraform).toContain(
      "CONTEXT_REVIEWER_FUNCTION_ALIAS_ARN = aws_lambda_function.context_reviewer.qualified_arn",
    );
    expect(terraform).toContain(
      "CONTEXT_CONSOLE_FUNCTION_ALIAS_ARN  = aws_lambda_function.context_console.qualified_arn",
    );
    expect(outputs).toContain('output "context_reviewer_alias_arn"');
    expect(outputs).toContain('output "context_console_alias_arn"');
  });

  it("expires every Lambda log group after three days", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform.match(/retention_in_days\s*=\s*3/g)).toHaveLength(8);
  });
});
