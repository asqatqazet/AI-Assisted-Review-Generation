import type {
  ConsoleCommandDto,
  ConsoleQueryDto,
  ConsoleRequestInvocationResultDto,
} from "@review/contracts/console";
import type { OperatorAccessProjectionDto } from "@review/contracts/context";
import { beforeEach, describe, expect, it } from "vitest";

import { createConsoleService } from "./console-service.js";
import {
  createFakeConsoleStore,
  defaultTenantSettings,
  type FakeConsoleData,
} from "./console-store.test-support.js";

const identity = {
  issuer: "https://issuer.example.test",
  subject: "platform-1",
  email: "platform@example.test",
};

const platformAccess: OperatorAccessProjectionDto = {
  status: "authorized",
  operator: { id: "operator-platform", email: identity.email },
  platformGrants: [
    {
      roleKey: "platform_admin",
      capabilities: [
        "console:read",
        "platform:admin",
        "provider:manage",
        "tenant:configure",
        "analytics:read",
        "ai:operate",
      ],
    },
  ],
  tenantGrants: [],
};

function freshData(): FakeConsoleData {
  return {
    tenants: [
      {
        id: "tenant-bright",
        slug: "brightsmile",
        name: "BrightSmile",
        locale: "en-GB",
        settings: defaultTenantSettings("en-GB"),
        keywordCategories: [{ key: "service", label: "Service", sortOrder: 0 }],
        category: "Dental",
        plan: "growth",
        monthlyBudgetMicros: 1_000_000,
        monthToDateSpendMicros: 820_000,
        status: "active",
      },
    ],
    locations: [
      {
        id: "location-downtown",
        tenantId: "tenant-bright",
        slug: "downtown",
        name: "Downtown",
        address: {
          line1: "1 High Street",
          line2: "",
          postalCode: "BS1 1AA",
          city: "Bristol",
          country: "GB",
        },
        active: true,
        overrides: {},
      },
    ],
    contextVersions: [],
    keywords: [],
    styles: [],
    actions: [],
    prompts: [
      {
        tenantId: "tenant-bright",
        id: "prompt-generate-1",
        action: "generate",
        version: 1,
        hash: "sha256:aaa",
        status: "candidate",
        createdAt: "2026-08-01T09:00:00.000Z",
        createdBy: "operator-platform",
        evaluationScore: 1,
        body: "Original body.",
        variables: [],
      },
      {
        tenantId: "tenant-bright",
        id: "prompt-generate-2",
        action: "generate",
        version: 2,
        hash: "sha256:bbb",
        status: "draft",
        createdAt: "2026-08-05T09:00:00.000Z",
        createdBy: "operator-platform",
        evaluationScore: null,
        body: "Shorter body.",
        variables: [],
      },
    ],
    experiments: [
      {
        tenantId: "tenant-bright",
        id: "experiment-running",
        action: "generate",
        status: "running",
        createdAt: "2026-08-10T09:00:00.000Z",
        startedAt: "2026-08-11T09:00:00.000Z",
        stoppedAt: null,
        variants: [
          {
            promptVersionId: "prompt-generate-1",
            promptVersionHash: "sha256:aaa",
            weightPct: 50,
            generations: 40,
            accepted: 26,
          },
          {
            promptVersionId: "prompt-generate-2",
            promptVersionHash: "sha256:bbb",
            weightPct: 50,
            generations: 38,
            accepted: 30,
          },
        ],
        metricsAvailable: true,
      },
    ],
    destinations: [],
  };
}

let data: FakeConsoleData;
let store: ReturnType<typeof createFakeConsoleStore>;

function service(): ReturnType<typeof createConsoleService> {
  return createConsoleService({
    store,
    executionStore: store,
    resolveAccess: async () => platformAccess,
    now: () => new Date("2026-08-18T12:00:00.000Z"),
  });
}

async function query(
  view: ConsoleQueryDto,
  scope: { tenantId: string | null; locationId: string | null },
): Promise<ConsoleRequestInvocationResultDto["result"]> {
  return await service().request({
    identity,
    scope,
    publicOrigin: "https://review.example.test",
    request: { mode: "query", query: view },
  });
}

async function command(
  body: ConsoleCommandDto,
  scope: { tenantId: string | null; locationId: string | null },
): Promise<ConsoleRequestInvocationResultDto["result"]> {
  return await service().request({
    identity,
    scope,
    publicOrigin: "https://review.example.test",
    request: { mode: "command", command: body },
  });
}

function viewData<T>(result: ConsoleRequestInvocationResultDto["result"]): T {
  if (result.status !== "view") {
    throw new Error(`Expected a view, received ${result.status}`);
  }
  return result.view.data as T;
}

beforeEach(() => {
  data = freshData();
  store = createFakeConsoleStore(data);
});

describe("ADM-AUTH-02/03 Platform scope", () => {
  it("lands a Platform administrator on Platform scope", async () => {
    const bootstrap = viewData<{
      role: string;
      activeContext: { tenantId: string | null };
      capabilities: Record<string, boolean>;
    }>(await query({ view: "bootstrap" }, { tenantId: null, locationId: null }));

    expect(bootstrap.role).toBe("platform_admin");
    expect(bootstrap.activeContext.tenantId).toBeNull();
    expect(bootstrap.capabilities).toMatchObject({
      canAccessPlatform: true,
      canSwitchTenant: true,
      canManageProviders: true,
      canManageAiOperations: true,
    });
  });

  it("lets a Platform administrator open a Tenant it holds no Tenant Grant for", async () => {
    const locations = viewData<{ locations: unknown[] }>(
      await query({ view: "locations" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    expect(locations.locations).toHaveLength(1);
  });

  it("still answers not-found for a Tenant that does not exist", async () => {
    expect(
      await query({ view: "locations" }, {
        tenantId: "tenant-imaginary",
        locationId: null,
      }),
    ).toEqual({ status: "not-found" });
  });
});

describe("ADM-PLT-01/02/05 Platform administration", () => {
  it("lists Tenants with spend against budget", async () => {
    const tenants = viewData<{ tenants: { slug: string; monthToDateSpend: unknown }[] }>(
      await query({ view: "platform-tenants" }, {
        tenantId: null,
        locationId: null,
      }),
    );

    expect(tenants.tenants).toEqual([
      expect.objectContaining({
        slug: "brightsmile",
        locationCount: 1,
        monthToDateSpend: { amountMicros: 820_000, currency: "EUR" },
        monthlyBudget: { amountMicros: 1_000_000, currency: "EUR" },
      }),
    ]);
  });

  it("provisions a Tenant as a data record with platform defaults", async () => {
    expect(
      await command(
        {
          command: "create-tenant",
          name: "Harbour Bistro",
          slug: "harbour-bistro",
          locale: "de-DE",
          category: "Restaurant",
          plan: "lite",
        },
        { tenantId: null, locationId: null },
      ),
    ).toEqual({ status: "command", result: { outcome: "accepted" } });

    const created = data.tenants.find(
      (tenant) => tenant.slug === "harbour-bistro",
    );
    expect(created?.settings["locale"]).toBe("de-DE");
    expect(created?.settings["requireDisclosure"]).toBe(true);

    expect(
      await command(
        {
          command: "create-tenant",
          name: "Duplicate",
          slug: "harbour-bistro",
          locale: "en-GB",
          category: "Restaurant",
          plan: "lite",
        },
        { tenantId: null, locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "SLUG_TAKEN" });
  });

  it("exposes credential state without exposing a secret", async () => {
    const providers = viewData<{
      models: { credentialState: string; providerKey: string }[];
    }>(
      await query({ view: "platform-providers" }, {
        tenantId: null,
        locationId: null,
      }),
    );

    expect(providers.models[0]).toMatchObject({ credentialState: "configured" });
    expect(JSON.stringify(providers)).not.toMatch(
      /secret|apikey|password|"(access|bearer|api)?[Tt]oken"/i,
    );
  });

  it("rejects a style manifest that fails validation instead of importing it", async () => {
    const result = await command(
      { command: "import-platform-style", manifest: "{\"key\":\"broken\"}" },
      { tenantId: null, locationId: null },
    );

    expect(result).toMatchObject({
      status: "command",
      result: { outcome: "style-validation" },
    });
    if (result.status !== "command" || result.result.outcome !== "style-validation") {
      throw new Error("expected validation outcome");
    }
    expect(result.result.validation.status).toBe("fail");
  });
});

describe("ADM-AI-01/02/04 prompt versions and experiments", () => {
  it("creates a new immutable version with a new hash instead of editing", async () => {
    await command(
      {
        command: "create-prompt-version",
        action: "generate",
        body: "Original body. Now with a constraint.",
        variables: [],
      },
      { tenantId: "tenant-bright", locationId: null },
    );

    const prompts = viewData<{
      prompts: { version: number; hash: string; status: string }[];
    }>(
      await query({ view: "prompts", action: "generate" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    expect(prompts.prompts).toHaveLength(3);
    const created = prompts.prompts.find((prompt) => prompt.version === 3);
    expect(created?.status).toBe("draft");
    expect(new Set(prompts.prompts.map((prompt) => prompt.hash)).size).toBe(3);
    expect(
      data.prompts.find((prompt) => prompt.id === "prompt-generate-1")?.body,
    ).toBe("Original body.");
  });

  it("compares two versions side by side without altering either", async () => {
    const comparison = viewData<{
      left: { body: string; readOnly: boolean };
      right: { body: string };
    }>(
      await query(
        {
          view: "prompt-comparison",
          leftPromptVersionId: "prompt-generate-1",
          rightPromptVersionId: "prompt-generate-2",
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );

    expect(comparison.left.body).toBe("Original body.");
    expect(comparison.left.readOnly).toBe(true);
    expect(comparison.right.body).toBe("Shorter body.");
  });

  it("refuses variant weights that do not total 100", async () => {
    expect(
      await command(
        {
          command: "create-experiment",
          action: "generate",
          variants: [
            { promptVersionId: "prompt-generate-1", weightPct: 60 },
            { promptVersionId: "prompt-generate-2", weightPct: 50 },
          ],
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "INVALID_WEIGHTS" });
  });

  it("creates an experiment as a draft and starts it explicitly", async () => {
    await command(
      {
        command: "create-experiment",
        action: "generate",
        variants: [
          { promptVersionId: "prompt-generate-1", weightPct: 40 },
          { promptVersionId: "prompt-generate-2", weightPct: 60 },
        ],
      },
      { tenantId: "tenant-bright", locationId: null },
    );

    const created = data.experiments.find(
      (experiment) => experiment.id === "experiment-2",
    );
    expect(created?.status).toBe("draft");

    expect(
      await command(
        { command: "start-experiment", experimentId: "experiment-2" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toEqual({ status: "command", result: { outcome: "accepted" } });
    expect(
      data.experiments.find((experiment) => experiment.id === "experiment-2")
        ?.status,
    ).toBe("running");
  });

  it("lets a running experiment be stopped but not restarted or edited", async () => {
    const experiments = viewData<{
      experiments: { id: string; editable: boolean; stoppable: boolean }[];
    }>(
      await query({ view: "experiments" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );
    expect(experiments.experiments[0]).toMatchObject({
      id: "experiment-running",
      editable: false,
      stoppable: true,
    });

    expect(
      await command(
        { command: "start-experiment", experimentId: "experiment-running" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "EXPERIMENT_RUNNING" });

    expect(
      await command(
        { command: "stop-experiment", experimentId: "experiment-running" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toEqual({ status: "command", result: { outcome: "accepted" } });
  });

  it("reports variant acceptance from recorded counts", async () => {
    const experiments = viewData<{
      experiments: { variants: { acceptanceRate: number }[] }[];
    }>(
      await query({ view: "experiments" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );

    expect(experiments.experiments[0]?.variants[0]?.acceptanceRate).toBeCloseTo(
      26 / 40,
    );
  });
});

describe("ADM-AI-05 bench isolation", () => {
  it("marks a bench run as bench work", async () => {
    const result = await command(
      {
        command: "run-bench",
        input: {
          action: "generate",
          styleId: "style-concise",
          promptVersionId: "prompt-generate-1",
          provider: "fake",
          keywordIds: [],
          freeText: "",
          sourceText: "",
        },
      },
      { tenantId: "tenant-bright", locationId: null },
    );

    expect(result).toMatchObject({
      status: "command",
      result: { outcome: "bench-result", result: { isBench: true } },
    });
    if (result.status !== "command" || result.result.outcome !== "bench-result") {
      throw new Error("expected bench result");
    }
    expect(result.result.result.removedClaims).toHaveLength(1);
    expect(result.result.result.claims).toHaveLength(1);
  });

  it("refuses a bench replay of a Generation the scope cannot resolve", async () => {
    expect(
      await query(
        { view: "bench-form", replayGenerationId: "generation-elsewhere" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toEqual({ status: "not-found" });
  });
});
