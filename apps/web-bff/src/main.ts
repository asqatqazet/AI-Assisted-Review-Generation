import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();
app.get("/health", (context) => context.json({ status: "ok", service: "web-bff" }));

const port = Number.parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port });
