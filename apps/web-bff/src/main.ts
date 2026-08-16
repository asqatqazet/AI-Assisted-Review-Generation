import { serve } from "@hono/node-server";

import { createWebBffApp } from "./app.js";
import { createHmacCsrfProtector } from "./security/csrf-protector.js";

const csrfSecret = process.env["REVIEW_CSRF_SECRET"];
if (csrfSecret === undefined) {
  throw new Error("REVIEW_CSRF_SECRET is required");
}

export const app = createWebBffApp({
  csrfProtector: createHmacCsrfProtector(csrfSecret),
});

const port = Number.parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port });

export { createWebBffApp };
