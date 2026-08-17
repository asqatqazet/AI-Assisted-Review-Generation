import { serve } from "@hono/node-server";

import { createWebBffApp } from "./src/app.js";
import { createHmacCsrfProtector } from "./src/security/csrf-protector.js";

const csrfSecret = process.env["REVIEW_CSRF_SECRET"];
if (csrfSecret === undefined) {
  throw new Error("REVIEW_CSRF_SECRET is required");
}
const publicOrigin = process.env["REVIEW_PUBLIC_ORIGIN"];
if (publicOrigin === undefined) {
  throw new Error("REVIEW_PUBLIC_ORIGIN is required");
}

const app = createWebBffApp({
  csrfProtector: createHmacCsrfProtector(csrfSecret),
  publicOrigin,
});
const port = Number.parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port });
