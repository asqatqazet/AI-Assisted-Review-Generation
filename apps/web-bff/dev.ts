import { serve } from "@hono/node-server";

import {
  createInvokedContextPort,
  createInvokedReviewerGenerationContextPort,
} from "./src/adapters/context-function.port.js";
import { createInvokedReviewerGenerationExecutionPort } from "./src/adapters/generation-function.port.js";
import { createHttpJsonInvoker } from "./src/adapters/http-json-invoker.js";
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

const contextOrigin = process.env["CONTEXT_SERVICE_ORIGIN"];
if (contextOrigin === undefined) {
  throw new Error("CONTEXT_SERVICE_ORIGIN is required");
}
const generationOrigin = process.env["GENERATION_SERVICE_ORIGIN"];
if (generationOrigin === undefined) {
  throw new Error("GENERATION_SERVICE_ORIGIN is required");
}

const contextInvoker = createHttpJsonInvoker(contextOrigin);
const generationInvoker = createHttpJsonInvoker(generationOrigin);

const app = createWebBffApp({
  contextPort: createInvokedContextPort(contextInvoker),
  reviewerGenerationContextPort:
    createInvokedReviewerGenerationContextPort(contextInvoker),
  reviewerGenerationExecutionPort:
    createInvokedReviewerGenerationExecutionPort(generationInvoker),
  csrfProtector: createHmacCsrfProtector(csrfSecret),
  publicOrigin,
});
const port = Number.parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, port });
