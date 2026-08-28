import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

describe("local composition isolation", () => {
  it("bootstraps with the owner URL but passes only exact service-role URLs", () => {
    const start = read("infra/local/start.ts");
    const promptFixture = read("infra/local/static-prompt-release-fixture.ts");
    const exampleEnvironment = read(".env.example");
    expect(start).toContain("context_runtime_svc");
    expect(start).toContain("console_control_svc");
    expect(start).toContain("generation_svc");
    expect(start).toContain('delete childEnvironment["DATABASE_URL"]');
    expect(start).toContain("CONTEXT_RUNTIME_DATABASE_URL: contextRuntimeDatabaseUrl");
    expect(start).toContain("CONSOLE_CONTROL_DATABASE_URL: consoleControlDatabaseUrl");
    expect(start).toContain("GENERATION_DATABASE_URL: generationDatabaseUrl");
    expect(start).toContain("INSERT INTO console_database_authority_keys");
    expect(start).toContain("decode('${consoleDatabaseAuthoritySecret}', 'hex')");
    expect(start.indexOf("console_database_authority_keys")).toBeLessThan(
      start.indexOf("apps/context-service/console-dev.ts"),
    );
    expect(start).not.toContain("CONTEXT_RUNTIME_DATABASE_URL: databaseUrl");
    expect(start).not.toContain("GENERATION_DATABASE_URL: databaseUrl");
    expect(exampleEnvironment).not.toMatch(
      /^(?:CONTEXT_RUNTIME_DATABASE_URL|CONSOLE_CONTROL_DATABASE_URL|GENERATION_DATABASE_URL)=.*review_owner/mu,
    );
    expect(start).toContain("qualifyLocalStaticPromptFixture");
    expect(start.indexOf("qualifyLocalStaticPromptFixture({")).toBeLessThan(
      start.indexOf("const children"),
    );
    expect(promptFixture).toContain("LOCAL_STATIC_EVALUATOR_RELEASE_SHA");
    expect(promptFixture).toContain("providerBehaviorMeasured=false");
    expect(promptFixture).toContain("ingestPromptEvaluation");
    expect(promptFixture).toContain("qualifyStudentRelease");
    expect(promptFixture).not.toContain("seed-student.sql");
  });

  it("runs the two Context authorities separately and binds every dev server to loopback", () => {
    const start = read("infra/local/start.ts");
    const reviewer = read("apps/context-service/reviewer-dev.ts");
    const console = read("apps/context-service/console-dev.ts");
    const generation = read("apps/generation-service/dev.ts");
    const bff = read("apps/web-bff/dev.ts");

    expect(start).toContain("apps/context-service/reviewer-dev.ts");
    expect(start).toContain("apps/context-service/console-dev.ts");
    expect(reviewer).not.toContain("CONSOLE_CONTROL_DATABASE_URL");
    expect(console).not.toContain("CONTEXT_RUNTIME_DATABASE_URL");
    expect(reviewer).toContain("CONTEXT_WORK_PRIVATE_KEY_PEM");
    expect(reviewer).not.toContain("CONSOLE_AUTHORITY_PRIVATE_KEY_PEM");
    expect(console).toContain("CONSOLE_AUTHORITY_PRIVATE_KEY_PEM");
    expect(console).toContain("CONSOLE_DATABASE_AUTHORITY_SECRET");
    expect(console).not.toContain("CONTEXT_WORK_PRIVATE_KEY_PEM");
    expect(reviewer).not.toContain("CONSOLE_DATABASE_AUTHORITY_SECRET");
    expect(generation).toContain("CONTEXT_WORK_PUBLIC_KEY_PEM");
    expect(generation).toContain("CONSOLE_AUTHORITY_PUBLIC_KEY_PEM");
    for (const source of [reviewer, console, generation, bff]) {
      expect(source).toContain('hostname: "127.0.0.1"');
    }
    expect(bff).toContain("CONTEXT_REVIEWER_ORIGIN");
    expect(bff).toContain("CONTEXT_CONSOLE_ORIGIN");
  });

  it("wires the complete reviewer write path through the local BFF", () => {
    const bff = read("apps/web-bff/dev.ts");

    expect(bff).toContain("createInvokedReviewerDispositionContextPort");
    expect(bff).toContain("createInvokedReviewerDispositionExecutionPort");
    expect(bff).toContain("createInvokedReviewerDraftRevisionContextPort");
    expect(bff).toContain("createInvokedReviewerDraftRevisionExecutionPort");
    expect(bff).toMatch(
      /reviewerDispositionContextPort:\s*createInvokedReviewerDispositionContextPort\(contextReviewerInvoker\)/u,
    );
    expect(bff).toMatch(
      /reviewerDispositionExecutionPort:\s*createInvokedReviewerDispositionExecutionPort\(generationInvoker\)/u,
    );
    expect(bff).toMatch(
      /reviewerDraftRevisionContextPort:\s*createInvokedReviewerDraftRevisionContextPort\(contextReviewerInvoker\)/u,
    );
    expect(bff).toMatch(
      /reviewerDraftRevisionExecutionPort:\s*createInvokedReviewerDraftRevisionExecutionPort\(generationInvoker\)/u,
    );
  });

  it("gives the public-source rate secret only to the reviewer authority", () => {
    const start = read("infra/local/start.ts");
    const reviewerStart = start.slice(
      start.indexOf('apps/context-service/reviewer-dev.ts'),
      start.indexOf('apps/context-service/console-dev.ts'),
    );
    const consoleAndDownstreamStarts = start.slice(
      start.indexOf('apps/context-service/console-dev.ts'),
    );

    expect(start).toMatch(
      /const publicSourceRateHmacSecret =\s*process\.env\["PUBLIC_SOURCE_RATE_HMAC_SECRET"\] \?\?\s*randomBytes\(32\)\.toString\("base64url"\)/u,
    );
    expect(start).toContain(
      'delete childEnvironment["PUBLIC_SOURCE_RATE_HMAC_SECRET"]',
    );
    expect(reviewerStart).toContain(
      "PUBLIC_SOURCE_RATE_HMAC_SECRET: publicSourceRateHmacSecret",
    );
    expect(consoleAndDownstreamStarts).not.toContain(
      "PUBLIC_SOURCE_RATE_HMAC_SECRET: publicSourceRateHmacSecret",
    );
  });

  it("gives the BFF one explicit loopback source without trusting inherited input", () => {
    const start = read("infra/local/start.ts");
    const beforeBffStart = start.slice(
      0,
      start.indexOf('apps/web-bff/dev.ts'),
    );
    const bffStart = start.slice(
      start.indexOf('apps/web-bff/dev.ts'),
      start.indexOf("Local tenant Console sign-in"),
    );

    expect(start).toContain('const localSourceAddress = "127.0.0.1"');
    expect(start).toContain(
      'delete childEnvironment["REVIEW_LOCAL_SOURCE_ADDRESS"]',
    );
    expect(beforeBffStart).not.toContain(
      "REVIEW_LOCAL_SOURCE_ADDRESS: localSourceAddress",
    );
    expect(bffStart).toContain(
      "REVIEW_LOCAL_SOURCE_ADDRESS: localSourceAddress",
    );
  });

  it("uses per-run opaque local credentials instead of a known persona selector", () => {
    const start = read("infra/local/start.ts");
    const auth = read("apps/web-bff/dev/development-operator-auth.ts");
    const browser = read("acceptance/browser/operator-console.spec.ts");

    expect(start).toContain("randomBytes(32).toString(\"base64url\")");
    expect(auth).toContain("localCredential");
    expect(auth).not.toContain('get("devOperator")');
    expect(browser).not.toContain("devOperator=");
    expect(browser).toContain("REVIEW_LOCAL_TENANT_CREDENTIAL");
    expect(browser).toContain("current_user");
    expect(browser).toMatch(/metrics\.generations\)\.toBeGreaterThan\(0\)/u);
  });

  it("reuses one local authentication identity across Playwright config evaluations", () => {
    const playwright = read("playwright.config.ts");

    expect(playwright).toMatch(
      /process\.env\["REVIEW_LOCAL_RUN_ID"\] \?\?\s*randomBytes\(16\)\.toString\("hex"\)/u,
    );
    expect(playwright).toContain("REVIEW_LOCAL_RUN_ID: localRunId");
    for (const name of [
      "REVIEW_LOCAL_OPERATOR_AUTH_SECRET",
      "REVIEW_LOCAL_PLATFORM_CREDENTIAL",
      "REVIEW_LOCAL_TENANT_CREDENTIAL",
      "REVIEW_LOCAL_OPERATOR_ISSUER",
      "REVIEW_LOCAL_PLATFORM_SUBJECT",
      "REVIEW_LOCAL_TENANT_SUBJECT",
    ]) {
      expect(playwright).toMatch(
        new RegExp(`${name}:\\s*process\\.env\\["${name}"\\] \\?\\?`, "u"),
      );
    }
  });

  it("resets only an explicitly isolated loopback database before local browser acceptance", () => {
    const playwright = read("playwright.config.ts");
    const reset = read("infra/local/reset-browser-database.ts");

    expect(playwright).toContain(
      "./node_modules/.bin/tsx infra/local/reset-browser-database.ts && pnpm dev",
    );
    expect(playwright).toContain('REVIEW_LOCAL_RESET_DATABASE: "1"');
    expect(reset).toContain('process.env["REVIEW_LOCAL_RESET_DATABASE"] !== "1"');
    expect(reset).toContain("resetIntegrationDatabase");
    expect(reset).toContain('new Set(["127.0.0.1", "localhost", "[::1]"])');
  });
});
