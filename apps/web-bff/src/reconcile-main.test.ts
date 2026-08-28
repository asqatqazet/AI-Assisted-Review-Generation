import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { handler } from "./reconcile-main.js";

describe("US-06.1 internal reconciliation Lambda", () => {
  it("exports a fixed-shape handler and is included in the Web+BFF artifact", () => {
    expect(handler).toBeTypeOf("function");
    const source = fs.readFileSync(
      new URL("./reconcile-main.ts", import.meta.url),
      "utf8",
    );
    const project = fs.readFileSync(
      new URL("../project.json", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/event\.|event\[/);
    expect(source).toContain("createStaleGenerationReconciler");
    expect(source).toContain('qualifiedAliasArn("CONTEXT_REVIEWER_FUNCTION_ALIAS_ARN")');
    expect(source).toContain(
      'qualifiedAliasArn("GENERATION_CANDIDATE_FUNCTION_ALIAS_ARN")',
    );
    expect(source).not.toContain(
      'qualifiedAliasArn("GENERATION_FUNCTION_ALIAS_ARN")',
    );
    expect(source).not.toContain("CONTEXT_CONSOLE_FUNCTION_ALIAS_ARN");
    expect(source).not.toContain('qualifiedAliasArn("CONTEXT_FUNCTION_ALIAS_ARN")');
    expect(project).toContain("apps/web-bff/src/reconcile-main.ts");
  });
});
