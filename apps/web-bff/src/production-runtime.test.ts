import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handler as fastHandler } from "./main.js";
import { configurationReleaseIdForInvocation } from "./runtime.js";
import { handler as streamHandler } from "./stream-main.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("US-01.3 BFF production composition", () => {
  it("exports lazy buffered and response-streaming Lambda handlers", () => {
    expect(fastHandler).toBeTypeOf("function");
    expect(streamHandler).toBeTypeOf("function");

    const fastSource = fs.readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const streamSource = fs.readFileSync(
      new URL("./stream-main.ts", import.meta.url),
      "utf8",
    );
    const runtimeSource = fs.readFileSync(
      new URL("./runtime.ts", import.meta.url),
      "utf8",
    );

    expect(fastSource).toContain("handle(");
    expect(streamSource).toContain("streamHandle(");
    expect(fastSource).not.toContain("serve(");
    expect(streamSource).not.toContain("serve(");
    expect(runtimeSource).not.toContain("@review/db");
  });

  it("marks the streaming handler for the Node 24 response-streaming runtime", () => {
    const streamSource = fs.readFileSync(
      new URL("./stream-main.ts", import.meta.url),
      "utf8",
    );

    expect(streamSource).toContain("awslambda?.streamifyResponse");
    expect(streamSource).not.toMatch(/\(event,\s*context,\s*callback\)/);
    expect(streamSource).not.toContain("callback(");
  });

  it("allows only public-operational settings and qualified service aliases", () => {
    const source = fs.readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");
    const environmentKeys = [
      ...source.matchAll(
        /(?:required\(|requiredParameter\([^,]+,\s*|qualifiedAliasArn\(|process\.env\[)["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);

    expect(new Set(environmentKeys)).toEqual(
      new Set([
        "CONTEXT_REVIEWER_FUNCTION_ALIAS_ARN",
        "CONTEXT_CONSOLE_FUNCTION_ALIAS_ARN",
        "GENERATION_CANDIDATE_FUNCTION_ALIAS_ARN",
        "GENERATION_FUNCTION_ALIAS_ARN",
        "OPERATOR_OIDC_CONFIG_PARAMETER",
        "OPERATOR_SESSION_SECRET_PARAMETER",
        "REVIEW_CONFIGURATION_RELEASE_ID",
        "REVIEW_CSRF_SECRET_PARAMETER",
      ]),
    );
    expect(source).toContain("GetParameterCommand");
    expect(source).toContain("WithDecryption: true");
    expect(source).toContain('trustedPublicOriginHeader: "x-review-public-origin"');
    expect(source).not.toContain('required("REVIEW_PUBLIC_ORIGIN")');
    expect(source).toContain("createCognitoOperatorAuth");
    expect(source).toContain("createInvokedOperatorContextPort");
    expect(source).toMatch(
      /createInvokedOperatorContextPort\(consoleInvoker\)/u,
    );
    expect(source).toMatch(/createInvokedConsolePort\(consoleInvoker\)/u);
    expect(source).toMatch(
      /createInvokedContextPort\(reviewerInvoker,\s*\{\s*configurationReleaseId,?\s*\}\)/u,
    );
    expect(source).toMatch(
      /options\.candidateInvocation\s*===\s*true\s*\?\s*qualifiedAliasArn\("GENERATION_CANDIDATE_FUNCTION_ALIAS_ARN"\)\s*:\s*qualifiedAliasArn\("GENERATION_FUNCTION_ALIAS_ARN"\)/u,
    );
    expect(source).toMatch(
      /createInvokedReviewerGenerationContextPort\(reviewerInvoker\)/u,
    );
    expect(source).toMatch(
      /createInvokedPublicSourceRateLimitPort\(reviewerInvoker\)/u,
    );
    expect(source).toContain(
      "resolveTrustedViewerSource: cloudFrontViewerSource",
    );
  });

  it("pins only candidate-alias traffic and lets promoted live traffic follow the live pointer", () => {
    vi.stubEnv(
      "REVIEW_CONFIGURATION_RELEASE_ID",
      "018fd2d8-7f24-4d21-8b10-7dd983cfc487",
    );

    expect(
      configurationReleaseIdForInvocation(
        "arn:aws:lambda:eu-central-1:123456789012:function:review-web-bff-fast-student:candidate",
      ),
    ).toBe("018fd2d8-7f24-4d21-8b10-7dd983cfc487");
    expect(
      configurationReleaseIdForInvocation(
        "arn:aws:lambda:eu-central-1:123456789012:function:review-web-bff-fast-student:live",
      ),
    ).toBeUndefined();

    vi.stubEnv("REVIEW_CONFIGURATION_RELEASE_ID", "live");
    expect(() =>
      configurationReleaseIdForInvocation(
        "arn:aws:lambda:eu-central-1:123456789012:function:review-web-bff-fast-student:candidate",
      ),
    ).toThrow("REVIEW_CONFIGURATION_RELEASE_ID must be a canonical UUID");
  });
});
