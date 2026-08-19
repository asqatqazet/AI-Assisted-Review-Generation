import {
  ConsoleCommandDtoSchema,
  ConsoleQueryDtoSchema,
  ConsoleViewDtoSchema,
  ConsoleCommandResultDtoSchema,
  type ConsoleQueryDto,
} from "@review/contracts/console";
import type { Context, Hono } from "hono";
import { getCookie } from "hono/cookie";

import type { ConsolePort } from "./ports/console.port.js";
import type { OperatorAuthPort } from "./ports/operator-auth.port.js";

export interface ConsoleRouteDependencies {
  readonly operatorAuth: OperatorAuthPort | undefined;
  readonly consolePort: ConsolePort | undefined;
  readonly errorBody: (
    code: string,
    message: string,
    retryable: boolean,
  ) => unknown;
  readonly expectedPublicOrigin: (headers: Headers) => string | undefined;
}

/**
 * Every Console answer that an operator is not entitled to see is this one.
 * An unknown id, another Tenant's id and a missing capability are
 * indistinguishable from outside.
 */
const NOT_FOUND = {
  code: "CONSOLE_NOT_FOUND",
  message: "This resource is unavailable.",
} as const;

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

function parseConsoleQuery(
  view: string,
  params: URLSearchParams,
): ConsoleQueryDto | undefined {
  const candidate: Record<string, unknown> = { view };
  switch (view) {
    case "style-detail":
      candidate["styleId"] = params.get("styleId") ?? undefined;
      break;
    case "generation-detail":
      candidate["generationId"] = params.get("generationId") ?? undefined;
      break;
    case "prompts":
      candidate["action"] = params.get("action");
      break;
    case "prompt-comparison":
      candidate["leftPromptVersionId"] = params.get("left") ?? undefined;
      candidate["rightPromptVersionId"] = params.get("right") ?? undefined;
      break;
    case "bench-form":
      candidate["replayGenerationId"] = params.get("replayGenerationId");
      break;
    case "analytics":
      candidate["query"] = {
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
        sortKey: params.get("sortKey") ?? undefined,
        sortDirection: params.get("sortDirection") ?? undefined,
      };
      break;
    default:
      break;
  }
  const parsed = ConsoleQueryDtoSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function scopeRequest(params: URLSearchParams): {
  readonly tenantId: string | null;
  readonly locationId: string | null;
} {
  const tenantId = params.get("tenantId");
  const locationId = params.get("locationId");
  return {
    tenantId: tenantId === null || tenantId === "" ? null : tenantId,
    locationId: locationId === null || locationId === "" ? null : locationId,
  };
}

export function registerConsoleRoutes(
  app: Hono,
  dependencies: ConsoleRouteDependencies,
): void {
  const { errorBody } = dependencies;

  const readIdentity = async (
    c: Context,
  ): Promise<
    | { readonly status: "unauthenticated" }
    | { readonly status: "unavailable" }
    | {
        readonly status: "authenticated";
        readonly identity: {
          readonly issuer: string;
          readonly subject: string;
          readonly email: string;
        };
      }
  > => {
    if (
      dependencies.operatorAuth === undefined ||
      dependencies.consolePort === undefined
    ) {
      return { status: "unavailable" };
    }
    const sessionCookie = getCookie(c, "__Host-operator_session");
    if (sessionCookie === undefined) {
      return { status: "unauthenticated" };
    }
    const identity = await dependencies.operatorAuth.readSession({
      sessionCookie,
    });
    return identity === null
      ? { status: "unauthenticated" }
      : { status: "authenticated", identity };
  };

  app.get("/api/v1/console/views/:view", async (c) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie");

    const session = await readIdentity(c);
    if (session.status === "unavailable") {
      return c.json(
        errorBody("CONSOLE_UNAVAILABLE", "The Console is unavailable.", true),
        503,
      );
    }
    if (session.status === "unauthenticated") {
      return c.json(
        errorBody("OPERATOR_UNAUTHENTICATED", "Sign in is required.", false),
        401,
      );
    }

    const params = new URL(c.req.url).searchParams;
    const query = parseConsoleQuery(c.req.param("view"), params);
    if (query === undefined) {
      return c.json(errorBody(NOT_FOUND.code, NOT_FOUND.message, false), 404);
    }

    const result = await dependencies.consolePort!.request({
      identity: session.identity,
      scope: scopeRequest(params),
      publicOrigin: dependencies.expectedPublicOrigin(c.req.raw.headers) ?? null,
      request: { mode: "query", query },
    });

    if (result.status !== "view") {
      return c.json(errorBody(NOT_FOUND.code, NOT_FOUND.message, false), 404);
    }
    return c.json(ConsoleViewDtoSchema.parse(result.view), 200);
  });

  app.post("/api/v1/console/commands", async (c) => {
    c.header("Cache-Control", "private, no-store");

    const origin = c.req.header("Origin");
    const expectedOrigin = dependencies.expectedPublicOrigin(c.req.raw.headers);
    if (expectedOrigin === undefined || origin !== expectedOrigin) {
      return c.json(errorBody(NOT_FOUND.code, NOT_FOUND.message, false), 404);
    }

    const session = await readIdentity(c);
    if (session.status === "unavailable") {
      return c.json(
        errorBody("CONSOLE_UNAVAILABLE", "The Console is unavailable.", true),
        503,
      );
    }
    if (session.status === "unauthenticated") {
      return c.json(
        errorBody("OPERATOR_UNAUTHENTICATED", "Sign in is required.", false),
        401,
      );
    }

    // The edge signs this request with the hash the browser declared, so a
    // command whose body does not match its declared hash never reaches a
    // Tenant's configuration.
    const rawBody = await c.req.text();
    const claimedBodyHash = c.req.header("x-amz-content-sha256");
    if (
      claimedBodyHash === undefined ||
      claimedBodyHash !== (await sha256Hex(rawBody))
    ) {
      return c.json(errorBody(NOT_FOUND.code, NOT_FOUND.message, false), 404);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      parsedBody = undefined;
    }
    const command = ConsoleCommandDtoSchema.safeParse(parsedBody);
    if (!command.success) {
      return c.json(errorBody(NOT_FOUND.code, NOT_FOUND.message, false), 404);
    }

    const result = await dependencies.consolePort!.request({
      identity: session.identity,
      scope: scopeRequest(new URL(c.req.url).searchParams),
      publicOrigin: expectedOrigin,
      request: { mode: "command", command: command.data },
    });

    if (result.status === "rejected") {
      return c.json(errorBody(result.code, result.message, false), 422);
    }
    if (result.status !== "command") {
      return c.json(errorBody(NOT_FOUND.code, NOT_FOUND.message, false), 404);
    }
    return c.json(ConsoleCommandResultDtoSchema.parse(result.result), 200);
  });
}
