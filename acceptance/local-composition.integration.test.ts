import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetIntegrationDatabase } from "../packages/db/src/test-support/reset-integration-database.js";

const databaseUrl = process.env["DATABASE_URL"];
let localOrigin = "";

async function reserveLoopbackPorts(count: number): Promise<readonly number[]> {
  const servers = Array.from({ length: count }, () => createServer());
  try {
    await Promise.all(
      servers.map(
        async (server) =>
          await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
          }),
      ),
    );
    return servers.map((server) => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Could not reserve a loopback port");
      }
      return address.port;
    });
  } finally {
    await Promise.all(
      servers.map(
        async (server) =>
          await new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
  }
}

async function waitForHealth(
  process: ChildProcess,
  stderr: () => string,
  timeoutMs = 20_000,
): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `Local composition exited with code ${process.exitCode}: ${stderr().slice(-4_000)}`,
      );
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
  let composition: ChildProcess | undefined;
  let compositionStderr = "";

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error("DATABASE_URL is required for local composition acceptance");
    }

    await resetIntegrationDatabase({
      databaseUrl,
      psql: process.env["PSQL_BIN"] ?? "psql",
    });
    const [uiPort, bffPort, reviewerPort, consolePort, generationPort] =
      await reserveLoopbackPorts(5);
    localOrigin = `http://127.0.0.1:${uiPort}`;
    composition = spawn("pnpm", ["dev"], {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        REVIEW_LOCAL_SKIP_DATABASE_BOOTSTRAP: "1",
        REVIEW_LOCAL_HOST: "127.0.0.1",
        REVIEW_LOCAL_UI_PORT: String(uiPort),
        REVIEW_LOCAL_BFF_PORT: String(bffPort),
        REVIEW_LOCAL_CONTEXT_PORT: String(reviewerPort),
        REVIEW_LOCAL_CONTEXT_REVIEWER_PORT: String(reviewerPort),
        REVIEW_LOCAL_CONTEXT_CONSOLE_PORT: String(consolePort),
        REVIEW_LOCAL_GENERATION_PORT: String(generationPort),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    composition.stderr?.on("data", (chunk: Buffer) => {
      compositionStderr += chunk.toString("utf8");
    });
  });

  afterAll(async () => {
    const activeComposition = composition;
    if (
      activeComposition?.pid !== undefined &&
      activeComposition.exitCode === null
    ) {
      process.kill(-activeComposition.pid, "SIGTERM");
      await Promise.race([
        new Promise<void>((resolve) => {
          activeComposition.once("exit", () => resolve());
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
    }
  });

  it("exposes the BFF health endpoint through the browser origin", async () => {
    if (composition === undefined) {
      throw new Error("Local composition did not start");
    }
    const response = await waitForHealth(composition, () => compositionStderr);

    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "web-bff",
    });
  });
});
