import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { handler } from "./reconcile-main.js";

describe("US-06.1 internal reconciliation Lambda", () => {
  it("selects the candidate Generation only for the explicit deployment probe", () => {
    expect(handler).toBeTypeOf("function");
    const source = fs.readFileSync(
      new URL("./reconcile-main.ts", import.meta.url),
      "utf8",
    );
    const project = fs.readFileSync(
      new URL("../project.json", import.meta.url),
      "utf8",
    );

    expect(source).toContain("createStaleGenerationReconciler");
    expect(source).toContain('qualifiedAliasArn("CONTEXT_REVIEWER_FUNCTION_ALIAS_ARN")');
    expect(source).toContain(
      'qualifiedAliasArn("GENERATION_CANDIDATE_FUNCTION_ALIAS_ARN")',
    );
    expect(source).toContain(
      'qualifiedAliasArn("GENERATION_FUNCTION_ALIAS_ARN")',
    );
    expect(source).toMatch(
      /candidateInvocation\s*\?\s*qualifiedAliasArn\("GENERATION_CANDIDATE_FUNCTION_ALIAS_ARN"\)\s*:\s*qualifiedAliasArn\("GENERATION_FUNCTION_ALIAS_ARN"\)/u,
    );
    expect(source).toContain(
      "const candidateInvocation = event.candidateInvocation === true",
    );
    expect(source).not.toContain("CONTEXT_CONSOLE_FUNCTION_ALIAS_ARN");
    expect(source).not.toContain('qualifiedAliasArn("CONTEXT_FUNCTION_ALIAS_ARN")');
    expect(project).toContain("apps/web-bff/src/reconcile-main.ts");
  });
});
