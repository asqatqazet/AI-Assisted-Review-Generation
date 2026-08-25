import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("public source rate-limit secret topology", () => {
  it("gives the daily-HMAC secret only to reviewer Context", () => {
    const terraform = read("infra/terraform/student/main.tf");
    const reviewerPolicy = terraform.match(
      /data "aws_iam_policy_document" "context_reviewer_parameters" \{[\s\S]*?\n\}/u,
    )?.[0];
    const webPolicy = terraform.match(
      /data "aws_iam_policy_document" "web_bff_parameters" \{[\s\S]*?\n\}/u,
    )?.[0];
    const consolePolicy = terraform.match(
      /data "aws_iam_policy_document" "context_console_parameters" \{[\s\S]*?\n\}/u,
    )?.[0];
    const generationPolicy = terraform.match(
      /data "aws_iam_policy_document" "generation_parameters" \{[\s\S]*?\n\}/u,
    )?.[0];

    expect(terraform).toMatch(
      /public_source_rate_hmac_secret\s*=\s*"\/review-gen\/student\/public-source-rate-hmac-secret"/u,
    );
    expect(reviewerPolicy).toContain("public_source_rate_hmac_secret");
    expect(webPolicy).not.toContain("public_source_rate_hmac_secret");
    expect(consolePolicy).not.toContain("public_source_rate_hmac_secret");
    expect(generationPolicy).not.toContain("public_source_rate_hmac_secret");
    expect(terraform).toMatch(
      /resource "aws_lambda_function" "context_reviewer"[\s\S]*?PUBLIC_SOURCE_RATE_HMAC_SECRET_PARAMETER\s*=\s*local\.parameter_names\.public_source_rate_hmac_secret/u,
    );
  });

  it("creates and uploads a separate GitHub/SSM secret", () => {
    const deploy = read(".github/workflows/deploy-student.yml");
    const setup = read("scripts/setup-student-deployment.sh");

    expect(deploy).toContain(
      "PUBLIC_SOURCE_RATE_HMAC_SECRET: ${{ secrets.PUBLIC_SOURCE_RATE_HMAC_SECRET }}",
    );
    expect(deploy).toContain('test -n "$PUBLIC_SOURCE_RATE_HMAC_SECRET"');
    expect(deploy).toContain(
      "aws ssm put-parameter --name /review-gen/student/public-source-rate-hmac-secret --type SecureString --value \"$PUBLIC_SOURCE_RATE_HMAC_SECRET\" --overwrite",
    );
    expect(setup).toContain(
      'set_secret PUBLIC_SOURCE_RATE_HMAC_SECRET "$(openssl rand -hex 32)"',
    );
  });

  it("uses an ephemeral Context HMAC secret and deterministic local source", () => {
    const start = read("infra/local/start.ts");
    const reviewer = read("apps/context-service/reviewer-dev.ts");
    const bff = read("apps/web-bff/dev.ts");

    expect(start).toContain(
      "PUBLIC_SOURCE_RATE_HMAC_SECRET: publicSourceRateHmacSecret",
    );
    expect(start).toContain('const localSourceAddress = "127.0.0.1"');
    expect(start).toContain("REVIEW_LOCAL_SOURCE_ADDRESS: localSourceAddress");
    expect(reviewer).toContain('required("PUBLIC_SOURCE_RATE_HMAC_SECRET")');
    expect(bff).toContain('required("REVIEW_LOCAL_SOURCE_ADDRESS")');
    expect(bff).toContain("createInvokedPublicSourceRateLimitPort");
  });
});
