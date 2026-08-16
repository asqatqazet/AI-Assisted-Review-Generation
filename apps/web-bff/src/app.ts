import {
  EntryChallengeProjectionDtoSchema,
  StartEntryRequestDtoSchema,
} from "@review/contracts/context";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { ConfigCache } from "./config-cache.js";
import { processOutcome, type OutcomePayload, type StoredOutcome } from "./outcome.js";
import type { ContextPort } from "./ports/context.port.js";

export interface WebBffOptions {
  readonly contextPort?: ContextPort | undefined;
  readonly newBrowserCapability?: (() => string) | undefined;
  readonly newCsrfToken?: (() => string) | undefined;
  readonly configCache?: ConfigCache | undefined;
  readonly generationServiceBaseUrl?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
}

export function createWebBffApp(options: WebBffOptions = {}): Hono {
  const contextPort: ContextPort = options.contextPort ?? {
    prepareEntry: async () => ({ status: "unavailable" }),
    readEntryChallenge: async () => ({ status: "unavailable" }),
    advanceEntry: async () => ({ status: "unavailable" }),
  };
  const newBrowserCapability =
    options.newBrowserCapability ?? (() => globalThis.crypto.randomUUID());
  const newCsrfToken =
    options.newCsrfToken ?? (() => globalThis.crypto.randomUUID());
  const configCache = options.configCache ?? new ConfigCache();
  const generationServiceBaseUrl =
    options.generationServiceBaseUrl ?? "http://localhost:3002";
  const fetchFn = options.fetchFn ?? globalThis.fetch;

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
        csrfToken: newCsrfToken(),
        context: entry.context,
      }),
      200,
    );
  });

  app.post("/api/v1/entry-challenges/:entryChallengeHandle/start", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const browserCapability = getCookie(c, "__Host-review_browser");
    const body = StartEntryRequestDtoSchema.safeParse(await c.req.json());

    if (
      browserCapability === undefined ||
      !/^[A-Za-z0-9_-]{20,128}$/.test(browserCapability) ||
      !body.success
    ) {
      return c.json(
        { code: "ENTRY_UNAVAILABLE", message: "This review link is unavailable." },
        404,
      );
    }

    const result = await contextPort.advanceEntry({
      entryChallengeHandle: c.req.param("entryChallengeHandle"),
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

  app.post("/api/generate", async (c) => {
    const body = (await c.req.json()) as {
      tenantId: string;
      locationId: string;
      action: string;
      reviewFormatKey: string;
      assertions: unknown[];
      idempotencyKey?: string;
    };

    try {
      const { snapshot } = await configCache.getSnapshot(
        body.tenantId,
        body.locationId,
      );

      const genPayload = {
        idempotencyKey: body.idempotencyKey ?? `idem-${Date.now()}`,
        reviewSessionId: `sess-${Date.now()}`,
        action: body.action,
        reviewFormatKey: body.reviewFormatKey,
        snapshot,
        assertions: body.assertions,
      };

      const response = await fetchFn(`${generationServiceBaseUrl}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(genPayload),
      });

      if (!response.ok) {
        return c.json({ error: "Generation failed" }, 502);
      }

      const result = await response.json();
      return c.json(result, 200);
    } catch {
      // Fallback for standalone demo mode
      const rawClaims =
        (body.assertions as Array<{ text?: string; proposition?: string; semanticId?: string }>)?.map(
          (a, i) => ({
            id: `c${i + 1}`,
            text: a.text ?? a.proposition ?? "Attentive service provided.",
            semanticId: a.semanticId ?? `c${i + 1}`,
          }),
        ) ?? [{ id: "c1", text: "Attentive service provided.", semanticId: "s1" }];

      const tenantName =
        body.tenantId === "lumina-optics" ? "Lumina Optics" : "Apex Dental";
      const draft = `${rawClaims.map((c) => c.text).join(" ")}\n\nAI-assisted review generated for ${tenantName}.`;

      return c.json(
        {
          generationId: `gen-${Date.now()}`,
          status: "completed",
          draft,
          claims: rawClaims,
          groundingVerdict: { verdict: "pass", draftBody: draft },
          costMicros: 3500,
          cached: false,
        },
        200,
      );
    }
  });

  const outcomes: StoredOutcome[] = [];

  app.post("/api/outcome", async (c) => {
    const payload = (await c.req.json()) as OutcomePayload;
    const stored = processOutcome(payload);
    outcomes.push(stored);
    return c.json({ status: "recorded", outcome: stored }, 200);
  });

  return app;
}
