import { serve } from "@hono/node-server";

import { createGenerationApp } from "./src/transport/http/routes.js";

const app = createGenerationApp();

const port = Number.parseInt(process.env["PORT"] ?? "3002", 10);
serve({ fetch: app.fetch, port });
