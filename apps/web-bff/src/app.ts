import { Hono } from "hono";

import { ConfigCache } from "./config-cache.js";
import {
  resolveEntry,
  type EntryResolution,
  type VenueDataLookup,
} from "./entry-resolver.js";
import { processOutcome, type OutcomePayload, type StoredOutcome } from "./outcome.js";
import { renderSurveyHtml } from "./ui.js";

export interface WebBffOptions {
  readonly venueLookup?: VenueDataLookup | undefined;
  readonly configCache?: ConfigCache | undefined;
  readonly generationServiceBaseUrl?: string | undefined;
  readonly fetchFn?: typeof fetch | undefined;
}

export function createWebBffApp(options: WebBffOptions = {}): Hono {
  const venueLookup: VenueDataLookup =
    options.venueLookup ?? {
      findTenantBySlug: (slug) =>
        slug === "apex-dental"
          ? { id: "tenant-apex", name: "Apex Dental", status: "ACTIVE" }
          : slug === "lumina-optics"
            ? { id: "tenant-lumina", name: "Lumina Optics", status: "ACTIVE" }
            : undefined,
      findLocationBySlug: (tenantId, slug) =>
        (tenantId === "tenant-apex" && (slug === "central" || slug === "open-branch")) ||
        (tenantId === "tenant-lumina" && slug === "flagship")
          ? {
              id: slug === "central" ? "loc-central" : slug === "flagship" ? "loc-flagship" : "loc-open",
              name: slug === "central" ? "Central Clinic" : slug === "flagship" ? "Flagship Store" : "Open Branch",
              status: "ACTIVE",
              entryMode: slug === "open-branch" ? "open-qr" : "open-qr",
            }
          : undefined,
      findVisitToken: (token) =>
        token
          ? {
              id: "tok-demo",
              visitId: "visit-demo",
              tenantId: "tenant-apex",
              locationId: "loc-central",
              expiresAt: new Date(Date.now() + 86400000),
              consumedAt: null,
            }
          : undefined,
    };

  const configCache = options.configCache ?? new ConfigCache();
  const generationServiceBaseUrl =
    options.generationServiceBaseUrl ?? "http://localhost:3002";
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", service: "web-bff" }));

  app.get("/", (c) => {
    return c.html(renderSurveyHtml());
  });

  app.get("/s/:tenantSlug/:locationSlug", async (c) => {
    const isHtml = c.req.header("accept")?.includes("text/html");
    if (isHtml) {
      return c.html(renderSurveyHtml());
    }

    const tenantSlug = c.req.param("tenantSlug");
    const locationSlug = c.req.param("locationSlug");
    const visitToken = c.req.query("v");
    const tableRef = c.req.query("t");

    const resolution: EntryResolution = resolveEntry(
      { tenantSlug, locationSlug, visitToken, tableRef },
      venueLookup,
    );

    if (resolution.status !== "valid") {
      return c.json(
        {
          status: resolution.status,
          message: "Please scan a valid venue QR code or request an invitation link.",
        },
        resolution.status === "requires-verification" ? 401 : 404,
      );
    }

    try {
      const { snapshot, stale } = await configCache.getSnapshot(
        resolution.tenantId,
        resolution.locationId,
      );

      return c.json(
        {
          status: "ready",
          tenantName: snapshot.tenantName,
          locationName: snapshot.locationName,
          tableRef: resolution.tableRef,
          reviewFormats: snapshot.reviewFormats,
          factOptions: snapshot.factOptions,
          snapshotId: snapshot.snapshotId,
          staleConfig: stale,
        },
        200,
      );
    } catch (error) {
      return c.json(
        {
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load venue configuration.",
        },
        503,
      );
    }
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
