import {
  ConsoleCommandResultDtoSchema,
  ConsoleViewDtoSchema,
  type ConsoleCommandDto,
  type ConsoleCommandResultDto,
  type ConsoleScopeRequestDto,
  type ConsoleViewDto,
} from "@review/contracts/console";
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
    public readonly code:
      | "unauthenticated"
      | "forbidden"
      | "not-found"
      | "unavailable",
  ) {
    super(code);
  }
}

/** An operator-fixable refusal, distinct from "this does not exist for you". */
export class ConsoleRejectionError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type ConsoleViewName = ConsoleViewDto["view"];

export type ConsoleViewOf<TView extends ConsoleViewName> = Extract<
  ConsoleViewDto,
  { readonly view: TView }
>["data"];

export interface ConsoleClient {
  readSession(signal?: AbortSignal): Promise<AuthorizedOperatorAccess>;
  readView<TView extends ConsoleViewName>(input: {
    readonly view: TView;
    readonly scope: ConsoleScopeRequestDto;
    readonly params?: Readonly<Record<string, string | null>> | undefined;
    readonly signal?: AbortSignal | undefined;
  }): Promise<ConsoleViewOf<TView>>;
  runCommand(input: {
    readonly command: ConsoleCommandDto;
    readonly scope: ConsoleScopeRequestDto;
    readonly signal?: AbortSignal | undefined;
  }): Promise<ConsoleCommandResultDto>;
  logout(signal?: AbortSignal): Promise<void>;
}

export function consoleSearchParams(
  scope: ConsoleScopeRequestDto,
  params: Readonly<Record<string, string | null>> = {},
): URLSearchParams {
  const search = new URLSearchParams();
  if (scope.tenantId !== null) {
    search.set("tenantId", scope.tenantId);
  }
  if (scope.locationId !== null) {
    search.set("locationId", scope.locationId);
  }
  for (const [name, value] of Object.entries(params)) {
    if (value !== null) {
      search.set(name, value);
    }
  }
  return search;
}

function accessErrorFor(status: number): ConsoleAccessError {
  if (status === 401) {
    return new ConsoleAccessError("unauthenticated");
  }
  if (status === 403) {
    return new ConsoleAccessError("forbidden");
  }
  if (status === 404) {
    return new ConsoleAccessError("not-found");
  }
  return new ConsoleAccessError("unavailable");
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
      if (!response.ok) {
        throw accessErrorFor(response.status);
      }
      const projection = OperatorAccessProjectionDtoSchema.parse(
        await response.json(),
      );
      if (projection.status !== "authorized") {
        throw new ConsoleAccessError("forbidden");
      }
      return projection;
    },

    async readView({ view, scope, params, signal }) {
      const search = consoleSearchParams(scope, params);
      const response = await fetch(
        `/api/v1/console/views/${view}?${search.toString()}`,
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: signal ?? null,
        },
      );
      if (!response.ok) {
        throw accessErrorFor(response.status);
      }
      const parsed = ConsoleViewDtoSchema.parse(await response.json());
      if (parsed.view !== view) {
        throw new ConsoleAccessError("unavailable");
      }
      return parsed.data as ConsoleViewOf<typeof view>;
    },

    async runCommand({ command, scope, signal }) {
      const response = await fetch(
        `/api/v1/console/commands?${consoleSearchParams(scope).toString()}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(command),
          signal: signal ?? null,
        },
      );
      if (response.status === 422) {
        const body = (await response.json()) as {
          code?: string;
          message?: string;
        };
        throw new ConsoleRejectionError(
          body.code ?? "REJECTED",
          body.message ?? "That change was refused.",
        );
      }
      if (!response.ok) {
        throw accessErrorFor(response.status);
      }
      return ConsoleCommandResultDtoSchema.parse(await response.json());
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
