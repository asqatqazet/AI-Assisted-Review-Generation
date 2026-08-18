import type {
  ConsoleBootstrapDto,
  ConsoleCommandDto,
  ConsoleCommandResultDto,
  ConsoleScopeRequestDto,
  ConsoleViewDto,
} from "@review/contracts/console";

import {
  ConsoleAccessError,
  type AuthorizedOperatorAccess,
  type ConsoleClient,
  type ConsoleViewName,
} from "./console-client.js";

export interface RecordedConsoleRequest {
  readonly view: ConsoleViewName;
  readonly scope: ConsoleScopeRequestDto;
  readonly params: Readonly<Record<string, string | null>>;
}

export interface FakeConsoleClient extends ConsoleClient {
  readonly requests: RecordedConsoleRequest[];
  readonly commands: {
    readonly command: ConsoleCommandDto;
    readonly scope: ConsoleScopeRequestDto;
  }[];
}

export const testOperatorAccess: AuthorizedOperatorAccess = {
  status: "authorized",
  operator: {
    id: "00000000-0000-4000-8000-000000000301",
    email: "owner@example.com",
  },
  platformGrants: [],
  tenantGrants: [
    {
      tenantId: "tenant-speicher",
      tenantSlug: "speicher-neun",
      tenantName: "Speicher Neun",
      roleKey: "tenant_admin",
      capabilities: ["console:read", "tenant:configure", "analytics:read"],
      locations: [
        {
          locationId: "location-hafencity",
          locationSlug: "hafencity",
          locationName: "HafenCity",
          status: "active",
        },
      ],
    },
  ],
};

export const testBootstrap: ConsoleBootstrapDto = {
  user: { id: "operator-1", displayName: "owner@example.com" },
  role: "tenant_operator",
  tenants: [
    {
      id: "tenant-speicher",
      slug: "speicher-neun",
      name: "Speicher Neun",
      locations: [
        {
          id: "location-hafencity",
          slug: "hafencity",
          name: "HafenCity",
          active: true,
        },
      ],
    },
  ],
  activeContext: { tenantId: "tenant-speicher", locationId: null },
  capabilities: {
    canAccessPlatform: false,
    canSwitchTenant: false,
    canManageLocations: true,
    canManageConfiguration: true,
    canViewAnalytics: true,
    canManageAiOperations: false,
    canManageProviders: false,
  },
};

export const tenantScope = {
  type: "tenant" as const,
  tenant: {
    id: "tenant-speicher",
    slug: "speicher-neun",
    name: "Speicher Neun",
  },
};

export const emptyOverview: Extract<
  ConsoleViewDto,
  { view: "overview" }
>["data"] = {
  scope: tenantScope,
  window: { from: "2026-07-19T00:00:00.000Z", to: "2026-08-18T00:00:00.000Z" },
  metrics: {
    generations: 0,
    accepted: 0,
    acceptanceRate: 0,
    totalCost: { amountMicros: 0, currency: "EUR" },
    costPerAccepted: null,
  },
  byAction: [],
  byLocation: [],
  byTenant: [],
  experiment: null,
  providerHealth: [],
  alerts: [],
};

/**
 * Frontend-side stand-in for the Console transport. Views are supplied per
 * test; anything not supplied answers with the same not-found the BFF gives
 * for an unauthorized scope.
 */
export function createFakeConsoleClient({
  views = {},
  access = testOperatorAccess,
  onCommand,
}: {
  readonly views?: Partial<{
    [TView in ConsoleViewName]: Extract<
      ConsoleViewDto,
      { view: TView }
    >["data"];
  }>;
  readonly access?: AuthorizedOperatorAccess | undefined;
  readonly onCommand?:
    | ((command: ConsoleCommandDto) => ConsoleCommandResultDto)
    | undefined;
} = {}): FakeConsoleClient {
  const requests: RecordedConsoleRequest[] = [];
  const commands: {
    command: ConsoleCommandDto;
    scope: ConsoleScopeRequestDto;
  }[] = [];

  return {
    requests,
    commands,
    readSession: async () => access,
    readView: async ({ view, scope, params = {} }) => {
      requests.push({ view, scope, params });
      const data = (views as Record<string, unknown>)[view];
      if (data === undefined) {
        throw new ConsoleAccessError("not-found");
      }
      return data as never;
    },
    runCommand: async ({ command, scope }) => {
      commands.push({ command, scope });
      return onCommand?.(command) ?? { outcome: "accepted" };
    },
    logout: async () => undefined,
  };
}
