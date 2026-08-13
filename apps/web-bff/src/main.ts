import { serve } from "@hono/node-server";

import { createWebBffApp } from "./app.js";

export const app = createWebBffApp();

const port = Number.parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port });

export { createWebBffApp };
