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
    expect(terraform.match(/runtime\s*=\s*"nodejs24\.x"/g)).toHaveLength(2);
  });

  it("never reports deployment or smoke evidence from placeholder commands", () => {
    const deployWorkflowPath = path.join(
      __dirname,
      "../../../.github/workflows/deploy.yml",
    );
    if (!fs.existsSync(deployWorkflowPath)) {
      return;
    }

    const workflow = fs.readFileSync(deployWorkflowPath, "utf8");

    expect(workflow).not.toMatch(/#\s*aws\s+lambda\s+update-function-code/);
    expect(workflow).not.toMatch(/echo\s+["']Smoke test passed/);
    expect(workflow).not.toMatch(/echo\s+["']Lambda alias shifted/);
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

    expect(terraform).not.toContain("dummy-key-to-be-overridden");
    expect(terraform).not.toMatch(
      /resource\s+"aws_ssm_parameter"\s+"(?:openai|gemini|anthropic)_api_key"/,
    );
    expect(terraform).toContain("parameter/review-gen/student/providers/*");
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
});
