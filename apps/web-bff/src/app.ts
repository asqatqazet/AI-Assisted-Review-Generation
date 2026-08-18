import {
  EntryChallengeProjectionDtoSchema,
  OperatorAccessProjectionDtoSchema,
  ReviewSessionProjectionDtoSchema,
  StartEntryRequestDtoSchema,
} from "@review/contracts/context";
import { ReviewerGenerationCommandDtoSchema } from "@review/contracts/generation";
import { ReviewerDispositionCommandDtoSchema } from "@review/contracts/generation";
import { BffErrorDtoSchema } from "@review/contracts/shared";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";

import type { ContextPort } from "./ports/context.port.js";
import type {
  ReviewerGenerationContextPort,
  ReviewerGenerationExecutionPort,
} from "./ports/reviewer-generation.port.js";
import type {
  ReviewerDispositionContextPort,
  ReviewerDispositionExecutionPort,
} from "./ports/reviewer-disposition.port.js";
import type { ConsolePort } from "./ports/console.port.js";
import type { OperatorAuthPort } from "./ports/operator-auth.port.js";
import type { OperatorContextPort } from "./ports/operator-context.port.js";
import { registerConsoleRoutes } from "./console-routes.js";
import { createReviewerGenerationCoordinator } from "./reviewer-generation.js";
import {
  type CsrfProtector,
  unavailableCsrfProtector,
} from "./security/csrf-protector.js";

export interface WebBffOptions {
  readonly contextPort?: ContextPort | undefined;
  readonly newBrowserCapability?: (() => string) | undefined;
  readonly csrfProtector?: CsrfProtector | undefined;
  readonly publicOrigin?: string | undefined;
  readonly trustedPublicOriginHeader?: string | undefined;
  readonly newRequestId?: (() => string) | undefined;
  readonly reviewerGenerationContextPort?:
    | ReviewerGenerationContextPort
    | undefined;
  readonly reviewerGenerationExecutionPort?:
    | ReviewerGenerationExecutionPort
    | undefined;
  readonly reviewerDispositionContextPort?:
    | ReviewerDispositionContextPort
    | undefined;
  readonly reviewerDispositionExecutionPort?:
    | ReviewerDispositionExecutionPort
    | undefined;
  readonly operatorAuth?: OperatorAuthPort | undefined;
  readonly operatorContextPort?: OperatorContextPort | undefined;
  readonly consolePort?: ConsolePort | undefined;
}

const encoder = new TextEncoder();

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createWebBffApp(options: WebBffOptions = {}): Hono {
  const contextPort: ContextPort = options.contextPort ?? {
    prepareEntry: async () => ({ status: "unavailable" }),
    readEntryChallenge: async () => ({ status: "unavailable" }),
    advanceEntry: async () => ({ status: "unavailable" }),
    readReviewSession: async () => ({ status: "unavailable" }),
  };
  const newBrowserCapability =
    options.newBrowserCapability ?? (() => globalThis.crypto.randomUUID());
  const csrfProtector = options.csrfProtector ?? unavailableCsrfProtector;
  const publicOrigin =
    options.publicOrigin === undefined
      ? undefined
      : new URL(options.publicOrigin).origin;
  const trustedPublicOriginHeader = options.trustedPublicOriginHeader;
  const newRequestId = options.newRequestId ?? (() => globalThis.crypto.randomUUID());
  const errorBody = (
    code: string,
    message: string,
    retryable: boolean,
  ) =>
    BffErrorDtoSchema.parse({
      code,
      message,
      retryable,
      requestId: newRequestId(),
    });
  const reviewerGeneration =
    options.reviewerGenerationContextPort === undefined ||
    options.reviewerGenerationExecutionPort === undefined
      ? undefined
      : createReviewerGenerationCoordinator(
          options.reviewerGenerationContextPort,
          options.reviewerGenerationExecutionPort,
        );
  const app = new Hono();

  const expectedPublicOrigin = (headers: Headers): string | undefined => {
    if (publicOrigin !== undefined) {
      return publicOrigin;
    }
    if (trustedPublicOriginHeader === undefined) {
      return undefined;
    }
    const value = headers.get(trustedPublicOriginHeader);
    if (
      value === null ||
      !/^https:\/\/[a-z0-9-]+\.cloudfront\.net$/.test(value)
    ) {
      return undefined;
    }
    return value;
  };

  app.get("/health", (c) => c.json({ status: "ok", service: "web-bff" }));

  registerConsoleRoutes(app, {
    operatorAuth: options.operatorAuth,
    consolePort: options.consolePort,
    errorBody,
    expectedPublicOrigin,
  });

  app.get("/auth/login", async (c) => {
    if (options.operatorAuth === undefined) {
      return c.json(
        errorBody("OPERATOR_AUTH_UNAVAILABLE", "Sign in is unavailable.", true),
        503,
      );
    }
    const requestedReturnTo = c.req.query("returnTo");
    const returnTo =
      requestedReturnTo !== undefined &&
      requestedReturnTo.startsWith("/console") &&
      !requestedReturnTo.startsWith("//")
        ? requestedReturnTo
        : "/console";
    const login = await options.operatorAuth.begin({ returnTo });
    c.header(
      "Set-Cookie",
      `__Host-operator_oidc=${login.transactionCookie}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`,
    );
    c.header("Cache-Control", "private, no-store");
    return c.redirect(login.authorizationUrl, 303);
  });

  app.get("/auth/callback", async (c) => {
    const transactionCookie = getCookie(c, "__Host-operator_oidc");
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (
      options.operatorAuth === undefined ||
      transactionCookie === undefined ||
      code === undefined ||
      state === undefined
    ) {
      return c.json(
        errorBody("OPERATOR_AUTH_FAILED", "Sign in could not be completed.", false),
        400,
      );
    }
    let result;
    try {
      result = await options.operatorAuth.complete({
        code,
        state,
        transactionCookie,
      });
    } catch {
      c.header(
        "Set-Cookie",
        "__Host-operator_oidc=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
      );
      c.header("Cache-Control", "private, no-store");
      return c.json(
        errorBody(
          "OPERATOR_AUTH_FAILED",
          "Sign in could not be completed.",
          false,
        ),
        400,
      );
    }
    c.header(
      "Set-Cookie",
      `__Host-operator_session=${result.sessionCookie}; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax`,
      { append: true },
    );
    c.header(
      "Set-Cookie",
      "__Host-operator_oidc=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
      { append: true },
    );
    c.header("Cache-Control", "private, no-store");
    return c.redirect(result.returnTo, 303);
  });

  app.get("/api/v1/console/session", async (c) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie");
    const sessionCookie = getCookie(c, "__Host-operator_session");
    if (
      options.operatorAuth === undefined ||
      options.operatorContextPort === undefined ||
      sessionCookie === undefined
    ) {
      return c.json(
        errorBody("OPERATOR_UNAUTHENTICATED", "Sign in is required.", false),
        401,
      );
    }
    const identity = await options.operatorAuth.readSession({ sessionCookie });
    if (identity === null) {
      return c.json(
        errorBody("OPERATOR_UNAUTHENTICATED", "Sign in is required.", false),
        401,
      );
    }
    const access = await options.operatorContextPort.resolveAccess(identity);
    if (access.status !== "authorized") {
      return c.json(
        errorBody("OPERATOR_FORBIDDEN", "Console access is unavailable.", false),
        403,
      );
    }
    return c.json(OperatorAccessProjectionDtoSchema.parse(access), 200);
  });

  app.post("/auth/logout", (c) => {
    const origin = c.req.header("Origin");
    const expectedOrigin = expectedPublicOrigin(c.req.raw.headers);
    if (expectedOrigin === undefined || origin !== expectedOrigin) {
      return c.json(
        errorBody("NOT_FOUND", "This resource is unavailable.", false),
        404,
      );
    }
    c.header(
      "Set-Cookie",
      "__Host-operator_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    c.header("Cache-Control", "private, no-store");
    return c.body(null, 204);
  });

  app.get("/s/:tenantSlug/:locationSlug", async (c) => {
    const existingBrowserCapability = getCookie(c, "__Host-review_browser");
    const reuseBrowserCapability =
      existingBrowserCapability !== undefined &&
      /^[A-Za-z0-9_-]{20,128}$/.test(existingBrowserCapability);
    const browserCapability = reuseBrowserCapability
      ? existingBrowserCapability
      : newBrowserCapability();
    const preparation = await contextPort.prepareEntry({
      tenantSlug: c.req.param("tenantSlug"),
      locationSlug: c.req.param("locationSlug"),
      invitationToken: c.req.query("v"),
      tableRef: c.req.query("t"),
      browserCapability,
    });

    c.header("Cache-Control", "private, no-store");

    if (preparation.status !== "prepared") {
      return c.json(
        errorBody(
          "ENTRY_UNAVAILABLE",
          "This review link is unavailable.",
          false,
        ),
        404,
      );
    }

    if (!reuseBrowserCapability) {
      c.header(
        "Set-Cookie",
        `__Host-review_browser=${browserCapability}; Max-Age=86400; Path=/; HttpOnly; Secure; SameSite=Lax`,
      );
    }
    return c.redirect(`/start/${preparation.entryChallengeHandle}`, 303);
  });

  app.get("/api/v1/entry-challenges/:entryChallengeHandle", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const browserCapability = getCookie(c, "__Host-review_browser");

    if (
      browserCapability === undefined ||
      !/^[A-Za-z0-9_-]{20,128}$/.test(browserCapability)
    ) {
      return c.json(
        errorBody(
          "ENTRY_UNAVAILABLE",
          "This review link is unavailable.",
          false,
        ),
        404,
      );
    }

    const entryChallengeHandle = c.req.param("entryChallengeHandle");
    const entry = await contextPort.readEntryChallenge({
      entryChallengeHandle,
      browserCapability,
    });

    if (entry.status !== "ready") {
      return c.json(
        errorBody(
          "ENTRY_UNAVAILABLE",
          "This review link is unavailable.",
          false,
        ),
        404,
      );
    }

    return c.json(
      EntryChallengeProjectionDtoSchema.parse({
        status: "ready",
        entryChallengeHandle,
        csrfToken: await csrfProtector.issue({
          entryChallengeHandle,
          browserCapability,
        }),
        context: entry.context,
      }),
      200,
    );
  });

  app.post("/api/v1/entry-challenges/:entryChallengeHandle/start", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const browserCapability = getCookie(c, "__Host-review_browser");
    const entryChallengeHandle = c.req.param("entryChallengeHandle");
    const origin = c.req.header("Origin");
    const expectedOrigin = expectedPublicOrigin(c.req.raw.headers);

    if (
      expectedOrigin === undefined ||
      origin !== expectedOrigin ||
      browserCapability === undefined ||
      !/^[A-Za-z0-9_-]{20,128}$/.test(browserCapability)
    ) {
      return c.json(
        errorBody(
          "ENTRY_UNAVAILABLE",
          "This review link is unavailable.",
          false,
        ),
        404,
      );
    }

    let rawBody: unknown;
    try {
      if (
        c.req.header("Content-Type")?.startsWith(
          "application/x-www-form-urlencoded",
        ) === true
      ) {
        const fields = new URLSearchParams(await c.req.text());
        const entries = Array.from(fields.entries());
        const expectedNames = new Set(["rating", "action", "csrfToken"]);
        rawBody =
          entries.length === expectedNames.size &&
          entries.every(([name]) => expectedNames.has(name))
            ? {
                rating: Number(fields.get("rating")),
                action: fields.get("action"),
                csrfToken: fields.get("csrfToken"),
              }
            : undefined;
      } else {
        rawBody = await c.req.json();
      }
    } catch {
      rawBody = undefined;
    }

    const body = StartEntryRequestDtoSchema.safeParse(rawBody);
    if (
      !body.success ||
      !(await csrfProtector.verify({
        entryChallengeHandle,
        browserCapability,
        token: body.data.csrfToken,
      }))
    ) {
      return c.json(
        errorBody(
          "ENTRY_UNAVAILABLE",
          "This review link is unavailable.",
          false,
        ),
        404,
      );
    }

    const result = await contextPort.advanceEntry({
      entryChallengeHandle,
      browserCapability,
      rating: body.data.rating,
      action: body.data.action,
    });

    if (result.status !== "admitted") {
      return c.json(
        errorBody(
          "ENTRY_UNAVAILABLE",
          "This review link is unavailable.",
          false,
        ),
        404,
      );
    }

    return c.redirect(`/review/${result.reviewSessionHandle}`, 303);
  });

  app.get("/api/v1/review-sessions/:reviewSessionHandle", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const browserCapability = getCookie(c, "__Host-review_browser");
    if (
      browserCapability === undefined ||
      !/^[A-Za-z0-9_-]{20,128}$/.test(browserCapability)
    ) {
      return c.json(
        errorBody(
          "REVIEW_SESSION_UNAVAILABLE",
          "This review is unavailable.",
          false,
        ),
        404,
      );
    }

    const result = await contextPort.readReviewSession({
      reviewSessionHandle: c.req.param("reviewSessionHandle"),
      browserCapability,
    });
    if (result.status !== "ready") {
      return c.json(
        errorBody(
          "REVIEW_SESSION_UNAVAILABLE",
          "This review is unavailable.",
          false,
        ),
        404,
      );
    }

    return c.json(ReviewSessionProjectionDtoSchema.parse(result), 200);
  });

  app.post(
    "/api/v1/review-sessions/:reviewSessionHandle/generations",
    async (c) => {
      c.header("Cache-Control", "private, no-store");
      const browserCapability = getCookie(c, "__Host-review_browser");
      const idempotencyKey = c.req.header("Idempotency-Key");
      const claimedBodyHash = c.req.header("x-amz-content-sha256");
      const origin = c.req.header("Origin");
      const expectedOrigin = expectedPublicOrigin(c.req.raw.headers);
      const rawBody = await c.req.text();

      if (
        reviewerGeneration === undefined ||
        expectedOrigin === undefined ||
        origin !== expectedOrigin ||
        browserCapability === undefined ||
        !/^[A-Za-z0-9_-]{20,128}$/.test(browserCapability) ||
        idempotencyKey === undefined ||
        idempotencyKey.length < 1 ||
        idempotencyKey.length > 200 ||
        claimedBodyHash === undefined ||
        claimedBodyHash !== (await sha256Hex(rawBody))
      ) {
        return c.json(
          errorBody(
            "GENERATION_UNAVAILABLE",
            "Assistance is unavailable.",
            true,
          ),
          404,
        );
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody) as unknown;
      } catch {
        parsedBody = undefined;
      }
      const command = ReviewerGenerationCommandDtoSchema.safeParse(parsedBody);
      if (!command.success) {
        return c.json(
          errorBody(
            "GENERATION_UNAVAILABLE",
            "Assistance is unavailable.",
            false,
          ),
          404,
        );
      }

      const abortController = new AbortController();
      const response = streamSSE(c, async (stream) => {
        try {
          for await (const event of reviewerGeneration.start({
            reviewSessionHandle: c.req.param("reviewSessionHandle"),
            browserCapability,
            idempotencyKey,
            command: command.data,
            signal: abortController.signal,
          })) {
            await stream.writeSSE({ data: JSON.stringify(event) });
          }
        } finally {
          abortController.abort();
        }
      });
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  );

  app.post(
    "/api/v1/review-sessions/:reviewSessionHandle/dispositions",
    async (c) => {
      c.header("Cache-Control", "private, no-store");
      const browserCapability = getCookie(c, "__Host-review_browser");
      const idempotencyKey = c.req.header("Idempotency-Key");
      const claimedBodyHash = c.req.header("x-amz-content-sha256");
      const origin = c.req.header("Origin");
      const expectedOrigin = expectedPublicOrigin(c.req.raw.headers);
      const rawBody = await c.req.text();

      if (
        options.reviewerDispositionContextPort === undefined ||
        options.reviewerDispositionExecutionPort === undefined ||
        expectedOrigin === undefined ||
        origin !== expectedOrigin ||
        browserCapability === undefined ||
        !/^[A-Za-z0-9_-]{20,128}$/.test(browserCapability) ||
        idempotencyKey === undefined ||
        idempotencyKey.length < 1 ||
        idempotencyKey.length > 200 ||
        claimedBodyHash === undefined ||
        claimedBodyHash !== (await sha256Hex(rawBody))
      ) {
        return c.json(
          errorBody(
            "DISPOSITION_UNAVAILABLE",
            "The final review could not be recorded.",
            true,
          ),
          404,
        );
      }

      let rawCommand: unknown;
      try {
        rawCommand = JSON.parse(rawBody) as unknown;
      } catch {
        rawCommand = undefined;
      }
      const command = ReviewerDispositionCommandDtoSchema.safeParse(rawCommand);
      if (!command.success) {
        return c.json(
          errorBody(
            "DISPOSITION_UNAVAILABLE",
            "The final review could not be recorded.",
            false,
          ),
          404,
        );
      }

      const authorization =
        await options.reviewerDispositionContextPort.authorize({
          reviewSessionHandle: c.req.param("reviewSessionHandle"),
          browserCapability,
          idempotencyKey,
          draftId: command.data.draftId,
          generationId: command.data.generationId,
          finalTextHash: `sha256:${await sha256Hex(command.data.finalText)}`,
        });
      if (authorization.status !== "authorized") {
        return c.json(
          errorBody(
            "DISPOSITION_UNAVAILABLE",
            "The final review could not be recorded.",
            false,
          ),
          404,
        );
      }

      return c.json(
        await options.reviewerDispositionExecutionPort.record({
          permit: authorization.permit,
          scope: authorization.scope,
          finalText: command.data.finalText,
        }),
        200,
      );
    },
  );

  app.notFound((c) =>
    c.json(
      errorBody("NOT_FOUND", "This resource is unavailable.", false),
      404,
    ),
  );

  app.onError((_error, c) =>
    c.json(
      errorBody(
        "INTERNAL_ERROR",
        "The request could not be completed.",
        true,
      ),
      500,
    ),
  );

  return app;
}
