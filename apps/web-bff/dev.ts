import { serve } from "@hono/node-server";

import {
  createInvokedConsoleExecutionAuthorizationPort,
  createInvokedConsolePort,
  createInvokedContextPort,
  createInvokedOperatorContextPort,
  createInvokedPublicSourceRateLimitPort,
  createInvokedReviewerDispositionContextPort,
  createInvokedReviewerGenerationContextPort,
} from "./src/adapters/context-function.port.js";
import {
  createInvokedConsoleExecutionReadPort,
  createInvokedReviewerDispositionExecutionPort,
  createInvokedReviewerGenerationExecutionPort,
} from "./src/adapters/generation-function.port.js";
import { createHttpJsonInvoker } from "./src/adapters/http-json-invoker.js";
import {
  createInvokedReviewerDraftRevisionContextPort,
  createInvokedReviewerDraftRevisionExecutionPort,
} from "./src/adapters/reviewer-draft-revision-function.ports.js";
import { createWebBffApp } from "./src/app.js";
import { createHmacCsrfProtector } from "./src/security/csrf-protector.js";
import { createDevelopmentOperatorAuth } from "./dev/development-operator-auth.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const csrfSecret = process.env["REVIEW_CSRF_SECRET"];
if (csrfSecret === undefined) {
  throw new Error("REVIEW_CSRF_SECRET is required");
}
const publicOrigin = process.env["REVIEW_PUBLIC_ORIGIN"];
if (publicOrigin === undefined) {
  throw new Error("REVIEW_PUBLIC_ORIGIN is required");
}

const contextReviewerOrigin = required("CONTEXT_REVIEWER_ORIGIN");
const contextConsoleOrigin = required("CONTEXT_CONSOLE_ORIGIN");
const generationOrigin = process.env["GENERATION_SERVICE_ORIGIN"];
if (generationOrigin === undefined) {
  throw new Error("GENERATION_SERVICE_ORIGIN is required");
}

const contextReviewerInvoker = createHttpJsonInvoker(contextReviewerOrigin);
const contextConsoleInvoker = createHttpJsonInvoker(contextConsoleOrigin);
const generationInvoker = createHttpJsonInvoker(generationOrigin);

const app = createWebBffApp({
  operatorAuth: createDevelopmentOperatorAuth({
    publicOrigin,
    signingSecret: required("REVIEW_LOCAL_OPERATOR_AUTH_SECRET"),
    credentials: {
      platform: required("REVIEW_LOCAL_PLATFORM_CREDENTIAL"),
      tenant: required("REVIEW_LOCAL_TENANT_CREDENTIAL"),
    },
    operators: {
      platform: {
        issuer: required("REVIEW_LOCAL_OPERATOR_ISSUER"),
        subject: required("REVIEW_LOCAL_PLATFORM_SUBJECT"),
        email: required("REVIEW_LOCAL_PLATFORM_EMAIL"),
      },
      tenant: {
        issuer: required("REVIEW_LOCAL_OPERATOR_ISSUER"),
        subject: required("REVIEW_LOCAL_TENANT_SUBJECT"),
        email: required("REVIEW_LOCAL_TENANT_EMAIL"),
      },
    },
    failLogout: process.env["REVIEW_LOCAL_LOGOUT_FAILURE"] === "1",
  }),
  contextPort: createInvokedContextPort(contextReviewerInvoker),
  sourceRateLimitPort:
    createInvokedPublicSourceRateLimitPort(contextReviewerInvoker),
  resolveTrustedViewerSource: () => required("REVIEW_LOCAL_SOURCE_ADDRESS"),
  operatorContextPort: createInvokedOperatorContextPort(contextConsoleInvoker),
  consolePort: createInvokedConsolePort(contextConsoleInvoker),
  consoleExecutionAuthorizationPort:
    createInvokedConsoleExecutionAuthorizationPort(contextConsoleInvoker),
  consoleExecutionReadPort:
    createInvokedConsoleExecutionReadPort(generationInvoker),
  reviewerGenerationContextPort:
    createInvokedReviewerGenerationContextPort(contextReviewerInvoker),
  reviewerGenerationExecutionPort:
    createInvokedReviewerGenerationExecutionPort(generationInvoker),
  reviewerDispositionContextPort:
    createInvokedReviewerDispositionContextPort(contextReviewerInvoker),
  reviewerDispositionExecutionPort:
    createInvokedReviewerDispositionExecutionPort(generationInvoker),
  reviewerDraftRevisionContextPort:
    createInvokedReviewerDraftRevisionContextPort(contextReviewerInvoker),
  reviewerDraftRevisionExecutionPort:
    createInvokedReviewerDraftRevisionExecutionPort(generationInvoker),
  csrfProtector: createHmacCsrfProtector(csrfSecret),
  publicOrigin,
});
const port = Number.parseInt(process.env["PORT"] ?? "3000", 10);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
