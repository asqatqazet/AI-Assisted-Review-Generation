import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { handler as consoleHandler } from "./console-main.js";
import { handler as reviewerHandler } from "./reviewer-main.js";
import { createDatabaseFailureSanitizingHandler } from "./runtime-failure.js";

describe("US-01.3 Context production composition", () => {
  it("publishes only structured database categories from private Lambda handlers", async () => {
    const prismaFailure = Object.assign(
      new Error("Raw query failed against a private relation"),
      {
        name: "PrismaClientKnownRequestError",
        code: "P2010",
        meta: { code: "42501", message: "private database detail" },
      },
    );
    const sanitized = createDatabaseFailureSanitizingHandler(async () => {
      throw prismaFailure;
    });

    await expect(sanitized({ operation: "list-reconciliation-candidates" })).rejects.toThrow(
      "DATABASE_P2010_SQLSTATE_42501",
    );
    await expect(sanitized({ operation: "list-reconciliation-candidates" })).rejects.not.toThrow(
      /private relation|private database detail/u,
    );
  });

  it("exports separate lazy reviewer and Console Lambda handlers", () => {
    expect(reviewerHandler).toBeTypeOf("function");
    expect(consoleHandler).toBeTypeOf("function");
    const project = fs.readFileSync(new URL("../project.json", import.meta.url), "utf8");
    expect(project).toContain("apps/context-service/src/reviewer-main.ts");
    expect(project).toContain("apps/context-service/src/console-main.ts");
    expect(project).not.toContain("apps/context-service/src/main.ts --format");
  });

  it("gives the reviewer Lambda only reviewer-runtime secrets", () => {
    const source = fs.readFileSync(
      new URL("./reviewer-main.ts", import.meta.url),
      "utf8",
    );
    const environmentKeys = [
      ...source.matchAll(
        /(?:required\(|requiredParameter\(|process\.env\[)["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);

    expect(new Set(environmentKeys)).toEqual(
      new Set([
        "CONTEXT_RUNTIME_DATABASE_URL_PARAMETER",
        "CONTEXT_WORK_PRIVATE_KEY_PARAMETER",
        "GENERATION_WORK_PUBLIC_KEY_PARAMETER",
        "PUBLIC_SOURCE_RATE_HMAC_SECRET_PARAMETER",
        "REVIEW_PROVIDER_MODE",
      ]),
    );
    expect(source).not.toContain("CONSOLE_CONTROL_DATABASE_URL_PARAMETER");
    expect(source).not.toContain("serve(");
  });

  it("gives the Console Lambda only Console-control secrets", () => {
    const source = fs.readFileSync(
      new URL("./console-main.ts", import.meta.url),
      "utf8",
    );
    const environmentKeys = [
      ...source.matchAll(
        /(?:required\(|requiredParameter\(|process\.env\[)["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);

    expect(new Set(environmentKeys)).toEqual(
      new Set([
        "CONSOLE_CONTROL_DATABASE_URL_PARAMETER",
        "CONSOLE_AUTHORITY_PRIVATE_KEY_PEM_PARAMETER",
        "CONSOLE_DATABASE_AUTHORITY_SECRET_PARAMETER",
        "REVIEW_PROVIDER_MODE",
      ]),
    );
    expect(source).not.toContain("CONTEXT_RUNTIME_DATABASE_URL_PARAMETER");
    expect(source).not.toContain("GENERATION_WORK_PUBLIC_KEY_PARAMETER");
    expect(source).not.toContain("CONTEXT_WORK_PRIVATE_KEY_PARAMETER");
    expect(source).not.toContain("PUBLIC_SOURCE_RATE_HMAC_SECRET_PARAMETER");
    expect(source).toContain("consoleDatabaseAuthoritySecret");
    expect(source).not.toContain("serve(");
  });

  it("keeps reviewer and Console database adapters in disjoint runtime modules", () => {
    const reviewer = fs.readFileSync(
      new URL("./reviewer-runtime.ts", import.meta.url),
      "utf8",
    );
    const console = fs.readFileSync(
      new URL("./console-runtime.ts", import.meta.url),
      "utf8",
    );

    expect(reviewer).toContain('@review/db/admission');
    expect(reviewer).toContain("createReviewerContextFunctionHandler");
    expect(reviewer).not.toContain("createContextFunctionHandler");
    expect(reviewer).not.toContain('@review/db/control-plane');
    expect(reviewer).not.toContain("consoleControlDatabaseUrl");
    expect(console).toContain('@review/db/control-plane');
    expect(console).not.toContain('@review/db/admission');
    expect(console).not.toContain("runtimeDatabaseUrl");
    expect(console).toContain("consoleAuthorityPrivateKeyPem");
    expect(console).not.toContain("contextPrivateKeyPem");
  });
});
