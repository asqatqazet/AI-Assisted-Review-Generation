import {
  OperatorAccessProjectionDtoSchema,
  type OperatorAccessProjectionDto,
} from "@review/contracts/context";

export type AuthorizedOperatorAccess = Extract<
  OperatorAccessProjectionDto,
  { readonly status: "authorized" }
>;

export class ConsoleAccessError extends Error {
  public constructor(
    public readonly code: "unauthenticated" | "forbidden" | "unavailable",
  ) {
    super(code);
  }
}

export interface ConsoleClient {
  readSession(signal?: AbortSignal): Promise<AuthorizedOperatorAccess>;
  logout(signal?: AbortSignal): Promise<void>;
}

export function createHttpConsoleClient(
  fetch: typeof globalThis.fetch = globalThis.fetch,
): ConsoleClient {
  return {
    async readSession(signal) {
      const response = await fetch("/api/v1/console/session", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: signal ?? null,
      });
      if (response.status === 401) {
        throw new ConsoleAccessError("unauthenticated");
      }
      if (response.status === 403) {
        throw new ConsoleAccessError("forbidden");
      }
      if (!response.ok) {
        throw new ConsoleAccessError("unavailable");
      }
      const projection = OperatorAccessProjectionDtoSchema.parse(
        await response.json(),
      );
      if (projection.status !== "authorized") {
        throw new ConsoleAccessError("forbidden");
      }
      return projection;
    },

    async logout(signal) {
      const response = await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: signal ?? null,
      });
      if (!response.ok) {
        throw new ConsoleAccessError("unavailable");
      }
    },
  };
}
