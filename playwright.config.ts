import { randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

const remoteBaseUrl = process.env["REVIEW_BROWSER_BASE_URL"];
const databaseUrl = process.env["DATABASE_URL"];
if (remoteBaseUrl === undefined && databaseUrl === undefined) {
  throw new Error("DATABASE_URL is required for browser acceptance tests");
}

const localBaseUrl = "http://127.0.0.1:5173";
const localRunId =
  process.env["REVIEW_LOCAL_RUN_ID"] ?? randomBytes(16).toString("hex");
const localAuthEnvironment =
  remoteBaseUrl === undefined
    ? {
        REVIEW_LOCAL_RUN_ID: localRunId,
        REVIEW_LOCAL_OPERATOR_AUTH_SECRET:
          process.env["REVIEW_LOCAL_OPERATOR_AUTH_SECRET"] ??
          randomBytes(32).toString("base64url"),
        REVIEW_LOCAL_PLATFORM_CREDENTIAL:
          process.env["REVIEW_LOCAL_PLATFORM_CREDENTIAL"] ??
          randomBytes(32).toString("base64url"),
        REVIEW_LOCAL_TENANT_CREDENTIAL:
          process.env["REVIEW_LOCAL_TENANT_CREDENTIAL"] ??
          randomBytes(32).toString("base64url"),
        REVIEW_LOCAL_OPERATOR_ISSUER:
          process.env["REVIEW_LOCAL_OPERATOR_ISSUER"] ??
          `https://local.review.invalid/${localRunId}`,
        REVIEW_LOCAL_PLATFORM_SUBJECT:
          process.env["REVIEW_LOCAL_PLATFORM_SUBJECT"] ??
          `platform-${localRunId}`,
        REVIEW_LOCAL_TENANT_SUBJECT:
          process.env["REVIEW_LOCAL_TENANT_SUBJECT"] ?? `tenant-${localRunId}`,
        REVIEW_LOCAL_PLATFORM_EMAIL:
          process.env["REVIEW_LOCAL_PLATFORM_EMAIL"] ??
          "platform@local.review.invalid",
        REVIEW_LOCAL_TENANT_EMAIL:
          process.env["REVIEW_LOCAL_TENANT_EMAIL"] ??
          "tenant@local.review.invalid",
        REVIEW_LOCAL_LOGOUT_FAILURE:
          process.env["REVIEW_LOCAL_LOGOUT_FAILURE"] ?? "1",
      }
    : {};
Object.assign(process.env, localAuthEnvironment);

export default defineConfig({
  testDir: "acceptance/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: remoteBaseUrl ?? localBaseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  ...(remoteBaseUrl === undefined
    ? {
        webServer: {
          command: "pnpm dev",
          url: `${localBaseUrl}/health`,
          timeout: 120_000,
          reuseExistingServer: false,
          env: {
            DATABASE_URL: databaseUrl!,
            REVIEW_LOCAL_SKIP_DATABASE_BOOTSTRAP: "1",
            REVIEW_LOCAL_HOST: "127.0.0.1",
            REVIEW_LOCAL_UI_PORT: "5173",
            REVIEW_LOCAL_BFF_PORT: "3000",
            REVIEW_LOCAL_CONTEXT_PORT: "3001",
            REVIEW_LOCAL_CONTEXT_REVIEWER_PORT: "3001",
            REVIEW_LOCAL_CONTEXT_CONSOLE_PORT: "3003",
            REVIEW_LOCAL_GENERATION_PORT: "3002",
            REVIEW_RELEASE_SHA: "local-e2e",
            ...localAuthEnvironment,
          },
        },
      }
    : {}),
});
