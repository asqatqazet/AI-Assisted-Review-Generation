import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("student AWS topology invariants", () => {
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
});
