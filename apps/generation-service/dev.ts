import { serve } from "@hono/node-server";

import { app } from "./src/main.js";

const port = Number.parseInt(process.env["PORT"] ?? "3002", 10);
serve({ fetch: app.fetch, port });
