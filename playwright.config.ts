import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined) {
  throw new Error("DATABASE_URL is required for browser acceptance tests");
}

export default defineConfig({
  testDir: "acceptance/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5173/health",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: databaseUrl,
      REVIEW_LOCAL_SKIP_DATABASE_BOOTSTRAP: "1",
      REVIEW_LOCAL_HOST: "127.0.0.1",
      REVIEW_LOCAL_UI_PORT: "5173",
      REVIEW_LOCAL_BFF_PORT: "3000",
      REVIEW_LOCAL_CONTEXT_PORT: "3001",
      REVIEW_LOCAL_GENERATION_PORT: "3002",
    },
  },
});
