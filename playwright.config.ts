import { defineConfig, devices } from "@playwright/test";

const remoteBaseUrl = process.env["REVIEW_BROWSER_BASE_URL"];
const databaseUrl = process.env["DATABASE_URL"];
if (remoteBaseUrl === undefined && databaseUrl === undefined) {
  throw new Error("DATABASE_URL is required for browser acceptance tests");
}

const localBaseUrl = "http://127.0.0.1:5173";

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
            REVIEW_LOCAL_GENERATION_PORT: "3002",
          },
        },
      }
    : {}),
});
