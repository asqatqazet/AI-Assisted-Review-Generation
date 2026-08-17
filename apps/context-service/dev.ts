import { serve } from "@hono/node-server";

import { createContextServiceApp } from "./src/app.js";

const app = createContextServiceApp();
const port = Number.parseInt(process.env["PORT"] ?? "3001", 10);
serve({ fetch: app.fetch, port });
