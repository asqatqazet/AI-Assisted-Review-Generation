import {
  EntryChallengeProjectionDtoSchema,
  ReviewSessionProjectionDtoSchema,
  StartEntryRequestDtoSchema,
} from "@review/contracts/context";
import { ReviewerGenerationCommandDtoSchema } from "@review/contracts/generation";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";

import type { ContextPort } from "./ports/context.port.js";
import type {
  ReviewerGenerationContextPort,
  ReviewerGenerationExecutionPort,
} from "./ports/reviewer-generation.port.js";
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
  readonly reviewerGenerationContextPort?:
    | ReviewerGenerationContextPort
    | undefined;
  readonly reviewerGenerationExecutionPort?:
    | ReviewerGenerationExecutionPort
    | undefined;
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
        {
          code: "ENTRY_UNAVAILABLE",
          message: "This review link is unavailable.",
        },
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
        { code: "ENTRY_UNAVAILABLE", message: "This review link is unavailable." },
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
        { code: "ENTRY_UNAVAILABLE", message: "This review link is unavailable." },
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
        { code: "ENTRY_UNAVAILABLE", message: "This review link is unavailable." },
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
        { code: "ENTRY_UNAVAILABLE", message: "This review link is unavailable." },
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
        { code: "ENTRY_UNAVAILABLE", message: "This review link is unavailable." },
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
        { code: "REVIEW_SESSION_UNAVAILABLE", message: "This review is unavailable." },
        404,
      );
    }

    const result = await contextPort.readReviewSession({
      reviewSessionHandle: c.req.param("reviewSessionHandle"),
      browserCapability,
    });
    if (result.status !== "ready") {
      return c.json(
        { code: "REVIEW_SESSION_UNAVAILABLE", message: "This review is unavailable." },
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
          { code: "GENERATION_UNAVAILABLE", message: "Assistance is unavailable." },
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
          { code: "GENERATION_UNAVAILABLE", message: "Assistance is unavailable." },
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

  return app;
}
