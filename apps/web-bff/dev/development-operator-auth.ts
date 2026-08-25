import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type {
  OperatorAuthPort,
  OperatorIdentity,
} from "../src/ports/operator-auth.port.js";

type OperatorKey = "platform" | "tenant";

type DevelopmentToken =
  | {
      readonly kind: "transaction";
      readonly operator: OperatorKey;
      readonly returnTo: string;
      readonly state: string;
      readonly code: string;
    }
  | { readonly kind: "session"; readonly operator: OperatorKey };

const encode = (value: string): string =>
  Buffer.from(value, "utf8").toString("base64url");

const decode = (value: string): string =>
  Buffer.from(value, "base64url").toString("utf8");

export function createDevelopmentOperatorAuth({
  publicOrigin,
  signingSecret,
  credentials,
  operators,
  failLogout = false,
}: {
  readonly publicOrigin: string;
  readonly signingSecret: string;
  readonly credentials: Readonly<Record<OperatorKey, string>>;
  readonly operators: Readonly<Record<OperatorKey, OperatorIdentity>>;
  readonly failLogout?: boolean;
}): OperatorAuthPort {
  if (signingSecret.length < 32) {
    throw new Error("development OperatorAuth signing secret is too short");
  }
  if (
    credentials.platform.length < 32 ||
    credentials.tenant.length < 32 ||
    credentials.platform === credentials.tenant
  ) {
    throw new Error("development OperatorAuth credentials are invalid");
  }
  const origin = new URL(publicOrigin).origin;

  const safelyEqual = (left: string, right: string): boolean => {
    const leftHash = createHash("sha256").update(left).digest();
    const rightHash = createHash("sha256").update(right).digest();
    return timingSafeEqual(leftHash, rightHash);
  };

  const operatorForCredential = (credential: string | null): OperatorKey => {
    const supplied = credential ?? "";
    if (safelyEqual(supplied, credentials.platform)) {
      return "platform";
    }
    if (safelyEqual(supplied, credentials.tenant)) {
      return "tenant";
    }
    throw new Error("development OperatorAuth credential is invalid");
  };

  const seal = (value: DevelopmentToken): string => {
    const payload = encode(JSON.stringify(value));
    const signature = createHmac("sha256", signingSecret)
      .update(payload)
      .digest("base64url");
    return `${payload}.${signature}`;
  };

  const open = (token: string): DevelopmentToken | null => {
    const [payload, signature, unexpected] = token.split(".");
    if (
      payload === undefined ||
      signature === undefined ||
      unexpected !== undefined
    ) {
      return null;
    }
    const expected = createHmac("sha256", signingSecret)
      .update(payload)
      .digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, "base64url");
    } catch {
      return null;
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return null;
    }
    try {
      const parsed = JSON.parse(decode(payload)) as Partial<DevelopmentToken>;
      if (
        parsed.kind === "session" &&
        (parsed.operator === "platform" || parsed.operator === "tenant")
      ) {
        return { kind: "session", operator: parsed.operator };
      }
      if (
        parsed.kind === "transaction" &&
        (parsed.operator === "platform" || parsed.operator === "tenant") &&
        typeof parsed.returnTo === "string" &&
        typeof parsed.state === "string" &&
        typeof parsed.code === "string"
      ) {
        return {
          kind: "transaction",
          operator: parsed.operator,
          returnTo: parsed.returnTo,
          state: parsed.state,
          code: parsed.code,
        };
      }
    } catch {
      return null;
    }
    return null;
  };

  return {
    async begin({ returnTo }) {
      const target = new URL(returnTo, origin);
      const operator = operatorForCredential(
        target.searchParams.get("localCredential"),
      );
      target.searchParams.delete("localCredential");
      const cleanReturnTo = `${target.pathname}${target.search}${target.hash}`;
      const state = randomBytes(32).toString("base64url");
      const code = randomBytes(32).toString("base64url");
      const transactionCookie = seal({
        kind: "transaction",
        operator,
        returnTo: cleanReturnTo,
        state,
        code,
      });
      const callback = new URL("/auth/callback", origin);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", state);
      return { authorizationUrl: callback.toString(), transactionCookie };
    },

    async complete({ code, state, transactionCookie }) {
      const transaction = open(transactionCookie);
      if (
        transaction?.kind !== "transaction" ||
        !safelyEqual(transaction.code, code) ||
        !safelyEqual(transaction.state, state)
      ) {
        throw new Error("development OperatorAuth transaction is invalid");
      }
      return {
        sessionCookie: seal({
          kind: "session",
          operator: transaction.operator,
        }),
        returnTo: transaction.returnTo,
      };
    },

    async readSession({ sessionCookie }) {
      const session = open(sessionCookie);
      if (session?.kind !== "session") {
        return null;
      }
      return {
        identity: operators[session.operator],
        refreshedSessionCookie: null,
      };
    },

    async logout() {
      if (failLogout) {
        throw new Error("simulated local provider revocation failure");
      }
      return { logoutUrl: "https://local.review.invalid/logout" };
    },
  };
}
