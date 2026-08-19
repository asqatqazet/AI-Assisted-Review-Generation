import type {
  ConsoleRequestInvocationDto,
  ConsoleRequestInvocationResultDto,
} from "@review/contracts/console";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createWebBffApp } from "./app.js";

const publicOrigin = "https://console.example.test";

const identity = {
  issuer: "https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_test",
  subject: "operator-subject",
  email: "operator@example.test",
};

const operatorAuth = {
  begin: async () => ({
    authorizationUrl: "https://example.invalid/oauth2/authorize",
    transactionCookie: "unused",
  }),
  complete: async () => ({ sessionCookie: "unused", returnTo: "/console" }),
  readSession: async ({ sessionCookie }: { readonly sessionCookie: string }) =>
    sessionCookie === "valid-operator-session" ? identity : null,
};

function appWithConsole(
  handler: (
    input: ConsoleRequestInvocationDto["input"],
  ) => ConsoleRequestInvocationResultDto["result"],
): { readonly app: ReturnType<typeof createWebBffApp>; readonly seen: ConsoleRequestInvocationDto["input"][] } {
  const seen: ConsoleRequestInvocationDto["input"][] = [];
  const app = createWebBffApp({
    publicOrigin,
    operatorAuth,
    consolePort: {
      request: async (input) => {
        seen.push(input);
        return handler(input);
      },
    },
  });
  return { app, seen };
}

const signedIn = { Cookie: "__Host-operator_session=valid-operator-session" };

/** Mirrors what the browser sends so CloudFront can sign the body. */
function payloadBound(body: string): Record<string, string> {
  return { "x-amz-content-sha256": createHash("sha256").update(body).digest("hex") };
}

const overviewView = {
  view: "overview" as const,
  data: {
    scope: {
      type: "tenant" as const,
      tenant: { id: "tenant-a", slug: "brightsmile", name: "BrightSmile" },
    },
    window: {
      from: "2026-07-19T00:00:00.000Z",
      to: "2026-08-18T00:00:00.000Z",
    },
    metrics: {
      generations: 12,
      accepted: 9,
      acceptanceRate: 0.75,
      totalCost: { amountMicros: 1200, currency: "EUR" },
      costPerAccepted: { amountMicros: 133, currency: "EUR" },
    },
    byAction: [],
    byLocation: [],
    byTenant: [],
    experiment: null,
    providerHealth: [],
    alerts: [],
  },
};

describe("ADM-AUTH-01/02 Console transport", () => {
  it("refuses a Console view without an operator session", async () => {
    const { app, seen } = appWithConsole(() => ({
      status: "view",
      view: overviewView,
    }));

    const response = await app.request("/api/v1/console/views/overview");

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "OPERATOR_UNAUTHENTICATED",
    });
    expect(seen).toEqual([]);
  });

  it("refuses an expired operator session rather than serving stale scope", async () => {
    const { app } = appWithConsole(() => ({
      status: "view",
      view: overviewView,
    }));

    const response = await app.request("/api/v1/console/views/overview", {
      headers: { Cookie: "__Host-operator_session=expired" },
    });

    expect(response.status).toBe(401);
  });

  it("passes the requested scope to Context without trusting it", async () => {
    const { app, seen } = appWithConsole(() => ({
      status: "view",
      view: overviewView,
    }));

    const response = await app.request(
      "/api/v1/console/views/overview?tenantId=tenant-a&locationId=location-1",
      { headers: signedIn },
    );

    expect(response.status).toBe(200);
    expect(seen[0]).toEqual({
      identity,
      scope: { tenantId: "tenant-a", locationId: "location-1" },
      // Taken from the edge, not from anything the browser can set.
      publicOrigin,
      request: { mode: "query", query: { view: "overview" } },
    });
    expect(await response.json()).toEqual(overviewView);
  });

  it("answers a cross-Tenant resource exactly like an unknown one", async () => {
    const { app } = appWithConsole(() => ({ status: "not-found" }));

    const unknown = await app.request(
      "/api/v1/console/views/generation-detail?tenantId=tenant-a&generationId=gen-999",
      { headers: signedIn },
    );
    const otherTenant = await app.request(
      "/api/v1/console/views/generation-detail?tenantId=tenant-a&generationId=gen-of-other-tenant",
      { headers: signedIn },
    );

    expect(unknown.status).toBe(404);
    expect(otherTenant.status).toBe(404);
    const unknownBody = (await unknown.json()) as Record<string, unknown>;
    const otherBody = (await otherTenant.json()) as Record<string, unknown>;
    expect({ ...unknownBody, requestId: null }).toEqual({
      ...otherBody,
      requestId: null,
    });
    expect(JSON.stringify(otherBody)).not.toContain("tenant");
  });

  it("rejects an unknown view name without reaching Context", async () => {
    const { app, seen } = appWithConsole(() => ({
      status: "view",
      view: overviewView,
    }));

    const response = await app.request(
      "/api/v1/console/views/secret-platform-thing?tenantId=tenant-a",
      { headers: signedIn },
    );

    expect(response.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it("carries an analytics query through the URL so a view is reproducible", async () => {
    const { app, seen } = appWithConsole((input) => {
      const request = input.request;
      if (
        request.mode !== "query" ||
        request.query.view !== "analytics"
      ) {
        return { status: "not-found" };
      }
      return {
        status: "view",
        view: {
          view: "analytics",
          data: {
            scope: {
              type: "tenant",
              tenant: { id: "tenant-a", slug: "brightsmile", name: "BrightSmile" },
            },
            query: request.query.query,
            rows: [],
          },
        },
      };
    });

    const response = await app.request(
      "/api/v1/console/views/analytics?tenantId=tenant-a" +
        "&from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z" +
        "&sortKey=totalCost&sortDirection=desc",
      { headers: signedIn },
    );

    expect(response.status).toBe(200);
    expect(seen[0]?.request).toEqual({
      mode: "query",
      query: {
        view: "analytics",
        query: {
          from: "2026-07-01T00:00:00.000Z",
          to: "2026-08-01T00:00:00.000Z",
          sortKey: "totalCost",
          sortDirection: "desc",
        },
      },
    });
  });

  it("does not let a Platform view through when Context denies the scope", async () => {
    const { app } = appWithConsole(() => ({ status: "not-found" }));

    const response = await app.request(
      "/api/v1/console/views/platform-tenants",
      { headers: signedIn },
    );

    expect(response.status).toBe(404);
  });
});

describe("Console commands", () => {
  it("requires a same-origin submission", async () => {
    const { app, seen } = appWithConsole(() => ({
      status: "command",
      result: { outcome: "accepted" },
    }));

    const response = await app.request("/api/v1/console/commands?tenantId=tenant-a", {
      method: "POST",
      headers: { ...signedIn, Origin: "https://attacker.example" },
      body: JSON.stringify({
        command: "reset-location-override",
        key: "requireDisclosure",
      }),
    });

    expect(response.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it("requires an operator session even from the right origin", async () => {
    const { app, seen } = appWithConsole(() => ({
      status: "command",
      result: { outcome: "accepted" },
    }));

    const response = await app.request("/api/v1/console/commands?tenantId=tenant-a", {
      method: "POST",
      headers: { Origin: publicOrigin },
      body: JSON.stringify({
        command: "reset-location-override",
        key: "requireDisclosure",
      }),
    });

    expect(response.status).toBe(401);
    expect(seen).toEqual([]);
  });

  it("forwards an authorized command and returns its outcome", async () => {
    const { app, seen } = appWithConsole(() => ({
      status: "command",
      result: { outcome: "accepted" },
    }));

    const response = await app.request(
      "/api/v1/console/commands?tenantId=tenant-a&locationId=location-1",
      {
        method: "POST",
        headers: {
          ...signedIn,
          Origin: publicOrigin,
          ...payloadBound(JSON.stringify({
          command: "reset-location-override",
          key: "requireDisclosure",
        })),
        },
        body: JSON.stringify({
          command: "reset-location-override",
          key: "requireDisclosure",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "accepted" });
    expect(seen[0]?.request).toEqual({
      mode: "command",
      command: { command: "reset-location-override", key: "requireDisclosure" },
    });
  });

  it("surfaces an operator-fixable rejection distinctly from not-found", async () => {
    const { app } = appWithConsole(() => ({
      status: "rejected",
      code: "INVALID_WEIGHTS",
      message: "Variant weights must total 100%.",
    }));

    const response = await app.request("/api/v1/console/commands?tenantId=tenant-a", {
      method: "POST",
      headers: {
        ...signedIn,
        Origin: publicOrigin,
        ...payloadBound(JSON.stringify({
        command: "create-experiment",
        action: "generate",
        variants: [
          { promptVersionId: "prompt-a", weightPct: 60 },
          { promptVersionId: "prompt-b", weightPct: 50 },
        ],
      })),
      },
      body: JSON.stringify({
        command: "create-experiment",
        action: "generate",
        variants: [
          { promptVersionId: "prompt-a", weightPct: 60 },
          { promptVersionId: "prompt-b", weightPct: 50 },
        ],
      }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "INVALID_WEIGHTS" });
  });

  it("rejects a malformed command body before it reaches Context", async () => {
    const { app, seen } = appWithConsole(() => ({
      status: "command",
      result: { outcome: "accepted" },
    }));

    const response = await app.request("/api/v1/console/commands?tenantId=tenant-a", {
      method: "POST",
      headers: {
        ...signedIn,
        Origin: publicOrigin,
        ...payloadBound(JSON.stringify({ command: "drop-database" })),
      },
      body: JSON.stringify({ command: "drop-database" }),
    });

    expect(response.status).toBe(404);
    expect(seen).toEqual([]);
  });
});

describe("Console distribution links", () => {
  it("reports the origin the request arrived on so links resolve", async () => {
    const { app, seen } = appWithConsole(() => ({ status: "not-found" }));

    await app.request(
      "/api/v1/console/views/distribution?tenantId=tenant-a&locationId=location-1",
      { headers: signedIn },
    );

    expect(seen[0]?.publicOrigin).toBe(publicOrigin);
  });

  it("reports no origin when the deployment cannot establish one", async () => {
    const seen: { publicOrigin: string | null }[] = [];
    const app = createWebBffApp({
      operatorAuth,
      consolePort: {
        request: async (input) => {
          seen.push({ publicOrigin: input.publicOrigin });
          return { status: "not-found" };
        },
      },
    });

    await app.request("/api/v1/console/views/distribution?tenantId=tenant-a", {
      headers: signedIn,
    });

    expect(seen[0]?.publicOrigin).toBeNull();
  });
});

describe("Console commands are payload-bound", () => {
  const body = JSON.stringify({
    command: "reset-location-override",
    key: "requireDisclosure",
  });

  it("refuses a command that declares no payload hash", async () => {
    // CloudFront signs the request with the hash the browser declared, so a
    // command without one cannot have been signed by the edge at all.
    const { app, seen } = appWithConsole(() => ({
      status: "command",
      result: { outcome: "accepted" },
    }));

    const response = await app.request("/api/v1/console/commands?tenantId=tenant-a", {
      method: "POST",
      headers: { ...signedIn, Origin: publicOrigin },
      body,
    });

    expect(response.status).toBe(404);
    expect(seen).toEqual([]);
  });

  it("refuses a body that does not match its declared hash", async () => {
    const { app, seen } = appWithConsole(() => ({
      status: "command",
      result: { outcome: "accepted" },
    }));

    const response = await app.request("/api/v1/console/commands?tenantId=tenant-a", {
      method: "POST",
      headers: {
        ...signedIn,
        Origin: publicOrigin,
        ...payloadBound(JSON.stringify({ command: "delete-keyword", keywordId: "k" })),
      },
      body,
    });

    expect(response.status).toBe(404);
    expect(seen).toEqual([]);
  });
});
