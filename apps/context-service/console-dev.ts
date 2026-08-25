import { serve } from "@hono/node-server";
import { readControlPlaneDatabaseCurrentUser } from "@review/db/control-plane";
import { Hono } from "hono";

import { createContextConsoleRuntime } from "./src/console-runtime.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const databaseUrl = required("CONSOLE_CONTROL_DATABASE_URL");
const invoke = createContextConsoleRuntime({
  consoleControlDatabaseUrl: databaseUrl,
  consoleAuthorityPrivateKeyPem: required(
    "CONSOLE_AUTHORITY_PRIVATE_KEY_PEM",
  ),
  consoleDatabaseAuthoritySecret: required(
    "CONSOLE_DATABASE_AUTHORITY_SECRET",
  ),
  providerMode:
    process.env["REVIEW_PROVIDER_MODE"] === "paid-enabled"
      ? "paid-enabled"
      : "fake-only",
});
const app = new Hono();
app.get("/health", (c) =>
  c.json({ status: "ok", service: "context-console-service" }),
);
app.get("/__local/current-user", async (c) =>
  c.json({
    current_user: await readControlPlaneDatabaseCurrentUser({ databaseUrl }),
  }),
);
app.post("/invoke", async (c) => c.json(await invoke(await c.req.json())));

const port = Number.parseInt(process.env["PORT"] ?? "3003", 10);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
