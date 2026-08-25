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
    sessionCookie === "valid-operator-session"
      ? { identity, refreshedSessionCookie: null }
      : null,
  logout: async () => ({ logoutUrl: "https://example.invalid/logout" }),
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
  it("couriers a Context-authorized read receipt to the Generation plane", async () => {
    const reads: unknown[] = [];
    const app = createWebBffApp({
      publicOrigin,
      operatorAuth,
      consolePort: {
        request: async () => ({
          status: "rejected",
          code: "VIEW_NOT_AVAILABLE",
          message: "must not use the control-plane fallback",
        }),
      },
      consoleExecutionAuthorizationPort: {
        authorize: async () => ({
          status: "authorized",
          receipt: "context-signed-receipt",
          authorizationId: "2ffad1ca-22f2-41ad-a9b3-07991a66cf76",
          projectionScope: overviewView.data.scope,
          query: {
            view: "overview",
            from: overviewView.data.window.from,
            to: overviewView.data.window.to,
          },
        }),
      },
      consoleExecutionReadPort: {
        read: async (input) => {
          reads.push(input);
          return {
            status: "overview",
            data: {
              window: overviewView.data.window,
              metrics: overviewView.data.metrics,
              byAction: [],
              byLocation: [],
              byTenant: [],
              experiment: null,
              providerHealth: [],
              alerts: [],
            },
          };
        },
      },
    });

    const response = await app.request(
      "/api/v1/console/views/overview?tenantId=tenant-a",
      { headers: signedIn },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(overviewView);
    expect(reads).toEqual([
      {
        receipt: "context-signed-receipt",
        authorizationId: "2ffad1ca-22f2-41ad-a9b3-07991a66cf76",
      },
    ]);
  });

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
  it("couriers an authorized Bench workload from Context to Generation", async () => {
    const authorizations: unknown[] = [];
    const executions: unknown[] = [];
    let controlPlaneCommands = 0;
    const workload = { bindings: { generationId: "bench-generation-a" } } as never;
    const app = createWebBffApp({
      publicOrigin,
      operatorAuth,
      consolePort: {
        request: async () => {
          controlPlaneCommands += 1;
          return { status: "not-found" };
        },
      },
      consoleBenchAuthorizationPort: {
        authorize: async (input) => {
          authorizations.push(input);
          return {
            status: "authorized",
            receipt: "context-signed-bench-receipt",
            workload,
          };
        },
      },
      consoleBenchExecutionPort: {
        execute: async (input) => {
          executions.push(input);
          return {
            status: "completed",
            result: {
              generationId: "bench-generation-a",
              output: "The team was attentive.",
              claims: [
                {
                  id: "claim-a",
                  text: "The team was attentive.",
                  supportedBy: ["assertion-a"],
                },
              ],
              removedClaims: [],
              provider: "fake",
              model: "fake-v1",
              latencyMs: 5,
              estimatedCost: { amountMicros: 0, currency: "EUR" },
              isBench: true,
              guard: {
                verdict: "passed",
                supportedClaimIds: ["claim-a"],
                removedClaimCount: 0,
              },
            },
          };
        },
      },
    });
    const command = {
      command: "run-bench",
      input: {
        action: "generate",
        styleId: "format-a@1",
        promptVersionId: "prompt-generate@1",
        provider: "fake",
        keywordIds: ["fact-a"],
        freeText: "",
        sourceText: "",
      },
    } as const;
    const body = JSON.stringify(command);

    const response = await app.request(
      "/api/v1/console/commands?tenantId=tenant-a&locationId=location-a",
      {
        method: "POST",
        headers: {
          ...signedIn,
          Origin: publicOrigin,
          ...payloadBound(body),
        },
        body,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "bench-result",
      result: { isBench: true, guard: { verdict: "passed" } },
    });
    expect(authorizations).toEqual([
      { identity, scope: { tenantId: "tenant-a", locationId: "location-a" }, input: command.input },
    ]);
    expect(executions).toEqual([
      { receipt: "context-signed-bench-receipt", workload },
    ]);
    expect(controlPlaneCommands).toBe(0);
  });

  it("renders an invalid Bench combination as the same generic not-found before Generation", async () => {
    let executions = 0;
    const app = createWebBffApp({
      publicOrigin,
      operatorAuth,
      consolePort: { request: async () => ({ status: "not-found" }) },
      consoleBenchAuthorizationPort: {
        authorize: async () => ({ status: "not-found" }),
      },
      consoleBenchExecutionPort: {
        execute: async () => {
          executions += 1;
          return { status: "not-found" };
        },
      },
    });
    const body = JSON.stringify({
      command: "run-bench",
      input: {
        action: "generate",
        styleId: "format-other-tenant",
        promptVersionId: "prompt-other-tenant",
        provider: "fake",
        keywordIds: [],
        freeText: "text",
        sourceText: "",
      },
    });
    const response = await app.request(
      "/api/v1/console/commands?tenantId=tenant-a&locationId=location-a",
      {
        method: "POST",
        headers: {
          ...signedIn,
          Origin: publicOrigin,
          ...payloadBound(body),
        },
        body,
      },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "CONSOLE_NOT_FOUND" });
    expect(executions).toBe(0);
  });

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

  it("forwards If-Match as the configuration CAS precondition", async () => {
    const { app, seen } = appWithConsole(() => ({
      status: "command",
      result: { outcome: "accepted" },
    }));
    const body = JSON.stringify({ command: "publish-configuration" });

    const response = await app.request(
      "/api/v1/console/commands?tenantId=tenant-a",
      {
        method: "POST",
        headers: {
          ...signedIn,
          Origin: publicOrigin,
          "If-Match": '"configuration:tenant-a:tenant:7"',
          ...payloadBound(body),
        },
        body,
      },
    );

    expect(response.status).toBe(200);
    expect(seen[0]?.ifMatch).toBe('"configuration:tenant-a:tenant:7"');
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

describe("Deployment limits are not disguised as denials", () => {
  it("returns a retryable explanation, not a 404, when a view is not deployed", async () => {
    const { app } = appWithConsole(() => ({
      status: "rejected",
      code: "VIEW_NOT_AVAILABLE",
      message: "Generation history is not available in this deployment yet.",
    }));

    const response = await app.request(
      "/api/v1/console/views/analytics?tenantId=tenant-a" +
        "&from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z" +
        "&sortKey=generations&sortDirection=desc",
      { headers: signedIn },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "VIEW_NOT_AVAILABLE",
      retryable: true,
    });
  });
});
