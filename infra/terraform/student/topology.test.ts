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
    expect(terraform.match(/runtime\s*=\s*"nodejs24\.x"/g)).toHaveLength(5);
  });

  it("publishes immutable service artifacts behind qualified live aliases", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform).not.toContain("dummy-context.zip");
    expect(terraform).not.toContain("dummy-gen.zip");
    expect(terraform).not.toContain('function_version = "$LATEST"');
    expect(terraform.match(/publish\s*=\s*true/g)).toHaveLength(7);
    expect(terraform.match(/source_code_hash\s*=\s*filebase64sha256/g)).toHaveLength(5);
    expect(terraform).toContain(
      "function_version = aws_lambda_function.context_service.version",
    );
    expect(terraform).toContain(
      "function_version = aws_lambda_function.generation_service.version",
    );
    expect(terraform).toContain(
      "function_version = aws_lambda_function.web_bff_stream.version",
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
    // A live provider may be catalogued so an operator can see and route it,
    // but the shipped fixture carries no credential for one: the deploy
    // installs that separately, and only when a key was actually supplied.
    expect(seed).toMatch(/'Google Gemini',\n\s*'',/);
    expect(seed).not.toMatch(/AIza[\w-]{10,}|sk-[\w-]{10,}/);
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

  it("stores non-secret Terraform state remotely and routes the real health probe", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform).toMatch(/backend\s+"s3"\s*\{\s*\}/);
    expect(terraform).toMatch(/path_pattern\s*=\s*"\/health"/);
    expect(terraform).toContain('target_origin_id         = "web-bff-fast"');
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
    expect(terraform).toContain("CONTEXT_DATABASE_URL_PARAMETER");
    expect(terraform).toContain("GENERATION_DATABASE_URL_PARAMETER");
    expect(terraform).not.toMatch(/\bDATABASE_URL_PARAMETER\s*=/);
    expect(terraform).toContain("REVIEW_CSRF_SECRET_PARAMETER");
    expect(terraform).toContain('actions = ["ssm:GetParameter"]');
    expect(terraform).not.toMatch(/DATABASE_URL\s*=\s*var\./);
    expect(terraform).not.toMatch(/PRIVATE_KEY_B64\s*=\s*var\./);
    expect(terraform).not.toMatch(/REVIEW_CSRF_SECRET\s*=\s*var\./);
    expect(variables).not.toMatch(/variable\s+"(?:database_url|review_csrf_secret|.*private_key_b64)"/);
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
      /resource\s+"aws_lambda_function"\s+"web_bff_fast"[\s\S]*?reserved_concurrent_executions\s*=\s*var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*5\s*:\s*null[\s\S]*?timeout\s*=\s*10/,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"web_bff_stream"[\s\S]*?reserved_concurrent_executions\s*=\s*var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*2\s*:\s*null[\s\S]*?timeout\s*=\s*85/,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"context_service"[\s\S]*?reserved_concurrent_executions\s*=\s*var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*5\s*:\s*null[\s\S]*?timeout\s*=\s*7/,
    );
    expect(terraform).toMatch(
      /resource\s+"aws_lambda_function"\s+"generation_service"[\s\S]*?reserved_concurrent_executions\s*=\s*var\.deployment_profile\s*==\s*"reserved-concurrency"\s*\?\s*1\s*:\s*null[\s\S]*?timeout\s*=\s*75/,
    );
    expect(terraform).not.toContain("provisioned_concurrent_executions");
  });

  it("lets only BFF roles invoke qualified service aliases and EventBridge invoke reconciliation", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform).toContain("aws_lambda_alias.context_service_live.arn");
    expect(terraform).toContain("aws_lambda_alias.generation_service_live.arn");
    expect(terraform).toContain('principal     = "events.amazonaws.com"');
    expect(terraform).toContain("aws_cloudwatch_event_rule.reconcile.arn");
    expect(terraform).not.toMatch(/aws_apigateway|aws_api_gateway|aws_nat_gateway/);
  });

  it("expires every Lambda log group after three days", () => {
    const terraform = fs.readFileSync(path.join(__dirname, "main.tf"), "utf8");

    expect(terraform.match(/retention_in_days\s*=\s*3/g)).toHaveLength(5);
  });
});
