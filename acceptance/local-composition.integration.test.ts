import { spawn, type ChildProcess } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL"];
const localOrigin = "http://127.0.0.1:5173";

async function waitForHealth(
  process: ChildProcess,
  timeoutMs = 20_000,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Local composition exited with code ${process.exitCode}`);
    }
    try {
      const response = await fetch(`${localOrigin}/health`);
      if (response.ok) {
        return response;
      }
      lastError = new Error(`Health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Local composition did not become healthy");
}

describe("local three-deployable composition", () => {
  let composition: ChildProcess;

  beforeAll(() => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for local composition acceptance");
    }

    composition = spawn("pnpm", ["dev"], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        REVIEW_LOCAL_SKIP_DATABASE_BOOTSTRAP: "1",
        REVIEW_LOCAL_HOST: "127.0.0.1",
        REVIEW_LOCAL_UI_PORT: "5173",
        REVIEW_LOCAL_BFF_PORT: "3000",
        REVIEW_LOCAL_CONTEXT_PORT: "3001",
        REVIEW_LOCAL_GENERATION_PORT: "3002",
      },
      stdio: "ignore",
    });
  });

  afterAll(() => {
    if (composition.pid !== undefined && composition.exitCode === null) {
      process.kill(-composition.pid, "SIGTERM");
    }
  });

  it("exposes the BFF health endpoint through the browser origin", async () => {
    const response = await waitForHealth(composition);

    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "web-bff",
    });
  });
});
