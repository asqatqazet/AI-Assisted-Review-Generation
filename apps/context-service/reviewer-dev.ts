import { serve } from "@hono/node-server";
import { readAdmissionDatabaseCurrentUser } from "@review/db/admission";
import { Hono } from "hono";

import { createContextReviewerRuntime } from "./src/reviewer-runtime.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const databaseUrl = required("CONTEXT_RUNTIME_DATABASE_URL");
const invoke = createContextReviewerRuntime({
  runtimeDatabaseUrl: databaseUrl,
  contextPrivateKeyPem: required("CONTEXT_WORK_PRIVATE_KEY_PEM"),
  generationPublicKeyPem: required("GENERATION_WORK_PUBLIC_KEY_PEM"),
  publicSourceRateHmacSecret: required("PUBLIC_SOURCE_RATE_HMAC_SECRET"),
  providerMode:
    process.env["REVIEW_PROVIDER_MODE"] === "paid-enabled"
      ? "paid-enabled"
      : "fake-only",
});
const app = new Hono();
app.get("/health", (c) =>
  c.json({ status: "ok", service: "context-reviewer-service" }),
);
app.get("/__local/current-user", async (c) =>
  c.json({
    current_user: await readAdmissionDatabaseCurrentUser({ databaseUrl }),
  }),
);
app.post("/invoke", async (c) => c.json(await invoke(await c.req.json())));

const port = Number.parseInt(process.env["PORT"] ?? "3001", 10);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
