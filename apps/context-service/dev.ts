import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { createContextRuntime } from "./src/runtime.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const invoke = createContextRuntime({
  runtimeDatabaseUrl: required("CONTEXT_RUNTIME_DATABASE_URL"),
  consoleControlDatabaseUrl: required("CONSOLE_CONTROL_DATABASE_URL"),
  contextPrivateKeyPem: required("CONTEXT_WORK_PRIVATE_KEY_PEM"),
  consoleAuthorityPrivateKeyPem: required(
    "CONSOLE_AUTHORITY_PRIVATE_KEY_PEM",
  ),
  consoleDatabaseAuthoritySecret: required(
    "CONSOLE_DATABASE_AUTHORITY_SECRET",
  ),
  generationPublicKeyPem: required("GENERATION_WORK_PUBLIC_KEY_PEM"),
  publicSourceRateHmacSecret: required("PUBLIC_SOURCE_RATE_HMAC_SECRET"),
  providerMode:
    process.env["REVIEW_PROVIDER_MODE"] === "paid-enabled"
      ? "paid-enabled"
      : "fake-only",
});
const app = new Hono();
app.get("/health", (c) => c.json({ status: "ok", service: "context-service" }));
app.post("/invoke", async (c) => c.json(await invoke(await c.req.json())));
const port = Number.parseInt(process.env["PORT"] ?? "3001", 10);
serve({ fetch: app.fetch, port });
