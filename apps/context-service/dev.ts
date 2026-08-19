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
  databaseUrl: required("CONTEXT_DATABASE_URL"),
  contextPrivateKeyPem: required("CONTEXT_WORK_PRIVATE_KEY_PEM"),
  generationPublicKeyPem: required("GENERATION_WORK_PUBLIC_KEY_PEM"),
});
const app = new Hono();
app.get("/health", (c) => c.json({ status: "ok", service: "context-service" }));
app.post("/invoke", async (c) => c.json(await invoke(await c.req.json())));
const port = Number.parseInt(process.env["PORT"] ?? "3001", 10);
serve({ fetch: app.fetch, port });
