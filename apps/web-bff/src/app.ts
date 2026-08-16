import {
  EntryChallengeProjectionDtoSchema,
  StartEntryRequestDtoSchema,
} from "@review/contracts/context";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import type { ContextPort } from "./ports/context.port.js";
import {
  type CsrfProtector,
  unavailableCsrfProtector,
} from "./security/csrf-protector.js";

export interface WebBffOptions {
  readonly contextPort?: ContextPort | undefined;
  readonly newBrowserCapability?: (() => string) | undefined;
  readonly csrfProtector?: CsrfProtector | undefined;
  readonly publicOrigin?: string | undefined;
}

export function createWebBffApp(options: WebBffOptions = {}): Hono {
  const contextPort: ContextPort = options.contextPort ?? {
    prepareEntry: async () => ({ status: "unavailable" }),
    readEntryChallenge: async () => ({ status: "unavailable" }),
    advanceEntry: async () => ({ status: "unavailable" }),
  };
  const newBrowserCapability =
    options.newBrowserCapability ?? (() => globalThis.crypto.randomUUID());
  const csrfProtector = options.csrfProtector ?? unavailableCsrfProtector;
  const publicOrigin =
    options.publicOrigin === undefined
      ? undefined
      : new URL(options.publicOrigin).origin;
  const app = new Hono();

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

    if (
      publicOrigin === undefined ||
      origin !== publicOrigin ||
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

  return app;
}
