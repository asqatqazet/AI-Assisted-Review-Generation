import { serve } from "@hono/node-server";

import { createContextServiceApp } from "./app.js";

const app = createContextServiceApp();

const port = Number.parseInt(process.env["PORT"] ?? "3001", 10);
serve({ fetch: app.fetch, port });

export { app };
