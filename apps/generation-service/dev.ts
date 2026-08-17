import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { createGenerationRuntime } from "./src/runtime.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const invoke = createGenerationRuntime({
  databaseUrl: required("GENERATION_DATABASE_URL"),
  contextPublicKeyPem: required("CONTEXT_WORK_PUBLIC_KEY_PEM"),
  generationPrivateKeyPem: required("GENERATION_WORK_PRIVATE_KEY_PEM"),
  fakeDelayMs: Number.parseInt(process.env["REVIEW_FAKE_DELAY_MS"] ?? "0", 10),
});
const app = new Hono();
app.get("/health", (c) => c.json({ status: "ok", service: "generation-service" }));
app.post("/invoke", async (c) => c.json(await invoke(await c.req.json())));

const port = Number.parseInt(process.env["PORT"] ?? "3002", 10);
serve({ fetch: app.fetch, port });
