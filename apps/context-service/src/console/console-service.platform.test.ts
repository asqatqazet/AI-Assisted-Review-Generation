import type {
  ConsoleCommandDto,
  ConsolePlatformConfigurationDraftChangeDto,
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

const settingsOnlyAccess: OperatorAccessProjectionDto = {
  status: "authorized",
  operator: { id: "operator-settings", email: "settings@example.test" },
  platformGrants: [
    {
      roleKey: "platform_settings_admin",
      capabilities: ["console:read", "platform:admin"],
    },
  ],
  tenantGrants: [],
};

const providerOnlyAccess: OperatorAccessProjectionDto = {
  status: "authorized",
  operator: { id: "operator-provider", email: "provider@example.test" },
  platformGrants: [
    {
      roleKey: "provider_manager",
      capabilities: ["console:read", "provider:manage"],
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
        platformDefaults: defaultTenantSettings("en-GB"),
        tenantValues: defaultTenantSettings("en-GB"),
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
        hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
        hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
            promptVersionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            weightPct: 50,
            generations: 40,
            accepted: 26,
          },
          {
            promptVersionId: "prompt-generate-2",
            promptVersionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
let resolvedAccess: OperatorAccessProjectionDto;

function service(
  providerMode: "configured" | "fake-only" = "configured",
): ReturnType<typeof createConsoleService> {
  return createConsoleService({
    store,
    executionStore: store,
    resolveAccess: async () => resolvedAccess,
    now: () => new Date("2026-08-18T12:00:00.000Z"),
    providerMode,
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
  ifMatch?: string,
): Promise<ConsoleRequestInvocationResultDto["result"]> {
  return await service().request({
    identity,
    scope,
    publicOrigin: "https://review.example.test",
    ...(ifMatch === undefined ? {} : { ifMatch }),
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
  resolvedAccess = platformAccess;
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

  it("projects only FakeProvider in the strict-$0 deployment", async () => {
    store.readPlatformProviders = async () => ({
      models: [
        {
          providerKey: "fake",
          providerName: "FakeProvider",
          modelKey: "fake-v1",
          modelName: "Fake v1",
          health: "healthy",
          credentialState: "configured",
          supportsStreaming: true,
          supportsStructuredOutput: true,
          maxTokens: 4096,
          routingPriority: 1,
          fallbackPriority: null,
        },
        {
          providerKey: "gemini",
          providerName: "Google Gemini",
          modelKey: "gemini-2.0-flash",
          modelName: "Gemini 2.0 Flash",
          health: "healthy",
          credentialState: "configured",
          supportsStreaming: true,
          supportsStructuredOutput: true,
          maxTokens: 8192,
          routingPriority: null,
          fallbackPriority: 1,
        },
      ],
      priceVersions: [
        {
          id: "price-gemini",
          providerKey: "gemini",
          modelKey: "gemini-2.0-flash",
          inputPerMillion: { amountMicros: 1000, currency: "EUR" },
          outputPerMillion: { amountMicros: 2000, currency: "EUR" },
          validFrom: "2026-08-01T00:00:00.000Z",
          validTo: null,
          superseded: false,
        },
      ],
    });

    const result = await service("fake-only").request({
      identity,
      scope: { tenantId: null, locationId: null },
      publicOrigin: "https://review.example.test",
      request: { mode: "query", query: { view: "platform-providers" } },
    });
    const providers = viewData<{
      models: { providerKey: string }[];
      priceVersions: { providerKey: string }[];
    }>(result);

    expect(providers.models.map((model) => model.providerKey)).toEqual(["fake"]);
    expect(providers.priceVersions).toEqual([]);
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

describe("Platform Configuration Draft publication", () => {
  const settingsChange: ConsolePlatformConfigurationDraftChangeDto = {
    operation: "save-platform-settings",
    defaultPolicyTemplate: "{}",
    globalRateLimits: {
      perReviewSessionPerHour: 20,
      perTenantPerMinute: 60,
      maxConcurrentGenerations: 4,
    },
    logRetentionDays: 45,
    featureFlags: [],
  };

  async function configuration(): Promise<{
    etag: string;
    draft: null | { changes: readonly unknown[] };
  }> {
    return viewData<{ configuration: { etag: string; draft: null | { changes: readonly unknown[] } } }>(
      await query(
        { view: "platform-settings" },
        { tenantId: null, locationId: null },
      ),
    ).configuration;
  }

  it("uses one Platform ETag for stage, cancel and publish", async () => {
    const before = await configuration();
    expect(before).toEqual({
      etag: '"platform-configuration:1:draft:none"',
      draft: null,
    });

    await expect(
      command(
        {
          command: "stage-platform-configuration-changes",
          changes: [settingsChange],
        },
        { tenantId: null, locationId: null },
        before.etag,
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });

    const staged = await configuration();
    expect(staged.etag).toMatch(
      /^"platform-configuration:1:draft:platform-configuration-draft-1:1"$/u,
    );
    expect(staged.draft?.changes).toEqual([settingsChange]);

    const publication =
      command(
        { command: "publish-platform-configuration" },
        { tenantId: null, locationId: null },
        staged.etag,
      );
    await expect(publication).resolves.toEqual({
      status: "command",
      result: { outcome: "accepted" },
    });
    await expect(
      command(
        { command: "publish-platform-configuration" },
        { tenantId: null, locationId: null },
        staged.etag,
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });
    await expect(configuration()).resolves.toEqual({
      etag: '"platform-configuration:2:draft:none"',
      draft: null,
    });
  });

  it("rejects the losing browser tab with CONFIG_CONFLICT", async () => {
    const tabEtag = (await configuration()).etag;
    await command(
      {
        command: "stage-platform-configuration-changes",
        changes: [settingsChange],
      },
      { tenantId: null, locationId: null },
      tabEtag,
    );
    await expect(
      command(
        {
          command: "stage-platform-configuration-changes",
          changes: [{ ...settingsChange, logRetentionDays: 90 }],
        },
        { tenantId: null, locationId: null },
        tabEtag,
      ),
    ).resolves.toMatchObject({ status: "rejected", code: "CONFIG_CONFLICT" });
  });

  it("rechecks the union of staged capabilities before publish", async () => {
    const before = await configuration();
    await command(
      {
        command: "stage-platform-configuration-changes",
        changes: [
          settingsChange,
          {
            operation: "set-provider-routing",
            providerKey: "fake",
            modelKey: "fake-model",
            routingPriority: 1,
            fallbackPriority: null,
          },
        ],
      },
      { tenantId: null, locationId: null },
      before.etag,
    );
    const staged = await configuration();
    for (const partialAccess of [settingsOnlyAccess, providerOnlyAccess]) {
      resolvedAccess = partialAccess;
      await expect(
        command(
          { command: "publish-platform-configuration" },
          { tenantId: null, locationId: null },
          staged.etag,
        ),
      ).resolves.toEqual({ status: "not-found" });
    }
    expect(
      store.calls.some((call) =>
        call.startsWith("publishPlatformConfiguration:"),
      ),
    ).toBe(false);
    resolvedAccess = platformAccess;
    expect((await configuration()).draft).not.toBeNull();
  });

  it("does not let a Provider-only operator stage a global publication", async () => {
    const before = await configuration();
    resolvedAccess = providerOnlyAccess;

    await expect(
      command(
        {
          command: "stage-platform-configuration-changes",
          changes: [
            {
              operation: "set-provider-routing",
              providerKey: "fake",
              modelKey: "fake-model",
              routingPriority: 1,
              fallbackPriority: null,
            },
          ],
        },
        { tenantId: null, locationId: null },
        before.etag,
      ),
    ).resolves.toEqual({ status: "not-found" });
    resolvedAccess = platformAccess;
    await expect(configuration()).resolves.toEqual(before);
  });

  it("publishes routing and a prospective Price Rate only through the Draft", async () => {
    const before = await configuration();
    await command(
      {
        command: "stage-platform-configuration-changes",
        changes: [
          {
            operation: "set-provider-routing",
            providerKey: "fake",
            modelKey: "fake-model",
            routingPriority: 1,
            fallbackPriority: null,
          },
          {
            operation: "publish-price-rate",
            providerKey: "fake",
            modelKey: "fake-model",
            inputMicrosPerMillion: 2_000_000,
            outputMicrosPerMillion: 5_000_000,
            currency: "EUR",
            validFrom: "2099-09-01T00:00:00.000Z",
          },
        ],
      },
      { tenantId: null, locationId: null },
      before.etag,
    );
    const staged = await configuration();
    await command(
      { command: "publish-platform-configuration" },
      { tenantId: null, locationId: null },
      staged.etag,
    );
    const providers = viewData<{
      models: { routingPriority: number | null }[];
      priceVersions: { validFrom: string }[];
    }>(
      await query(
        { view: "platform-providers" },
        { tenantId: null, locationId: null },
      ),
    );
    expect(providers.models.filter((model) => model.routingPriority === 1)).toHaveLength(1);
    expect(providers.priceVersions).toEqual([
      expect.objectContaining({ validFrom: "2099-09-01T00:00:00.000Z" }),
    ]);
  });

  it("rolls back every staged Platform change when terminal validation fails", async () => {
    const before = await configuration();
    await command(
      {
        command: "stage-platform-configuration-changes",
        changes: [
          {
            ...settingsChange,
            defaultPolicyTemplate: "not-json",
            logRetentionDays: 90,
          },
        ],
      },
      { tenantId: null, locationId: null },
      before.etag,
    );
    const staged = await configuration();
    await expect(
      command(
        { command: "publish-platform-configuration" },
        { tenantId: null, locationId: null },
        staged.etag,
      ),
    ).resolves.toMatchObject({ status: "rejected", code: "INVALID_VALUE" });
    await expect(configuration()).resolves.toEqual(staged);
    const settings = viewData<{ logRetentionDays: number }>(
      await query(
        { view: "platform-settings" },
        { tenantId: null, locationId: null },
      ),
    );
    expect(settings.logRetentionDays).toBe(30);
  });

  it("refuses every direct snapshot-affecting Platform mutation", async () => {
    const legacyCommands: ConsoleCommandDto[] = [
      {
        command: "set-provider-routing",
        providerKey: "fake",
        modelKey: "fake-model",
        routingPriority: 1,
        fallbackPriority: null,
      },
      {
        command: "publish-price-rate",
        providerKey: "fake",
        modelKey: "fake-model",
        inputMicrosPerMillion: 0,
        outputMicrosPerMillion: 0,
        currency: "EUR",
        validFrom: "2026-09-01T00:00:00.000Z",
      },
      {
        command: "save-platform-settings",
        defaultPolicyTemplate: settingsChange.defaultPolicyTemplate,
        globalRateLimits: settingsChange.globalRateLimits,
        logRetentionDays: settingsChange.logRetentionDays,
        featureFlags: settingsChange.featureFlags,
      },
    ];
    for (const legacy of legacyCommands) {
      await expect(
        command(legacy, { tenantId: null, locationId: null }),
      ).resolves.toMatchObject({
        status: "rejected",
        code: "CONFIG_DRAFT_REQUIRED",
      });
    }
    expect(store.calls).not.toContain("savePlatformSettings");
  });
});

describe("ADM-AI-01/02/04 prompt versions and experiments", () => {
  it("qualifies a fully evaluated Prompt Version as Candidate without deploying it", async () => {
    await expect(
      command(
        {
          command: "create-prompt-version",
          action: "generate",
          body: "A newly evaluated grounded Prompt.",
          variables: [],
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).resolves.toEqual({
      status: "command",
      result: { outcome: "accepted" },
    });
    const created = data.prompts.find(
      (prompt) => prompt.id === "prompt-generate-3",
    );
    if (created === undefined) {
      throw new Error("Expected the new immutable Prompt Version");
    }
    data.prompts = data.prompts.map((prompt) =>
      prompt.id === created.id
        ? { ...prompt, evaluationScore: 1 }
        : prompt,
    );

    await expect(
      command(
        {
          command: "promote-prompt-version",
          promptVersionId: created.id,
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).resolves.toEqual({
      status: "command",
      result: { outcome: "accepted" },
    });
    expect(
      data.prompts.find((prompt) => prompt.id === created.id)?.status,
    ).toBe("candidate");
    expect(data.prompts.some((prompt) => prompt.status === "published")).toBe(
      false,
    );

    const before = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    await expect(
      command(
        {
          command: "stage-configuration-changes",
          changes: [
            {
              operation: "deploy-prompt-version",
              action: "generate",
              promptVersionId: created.id,
            },
          ],
        },
        { tenantId: "tenant-bright", locationId: null },
        before.configuration.etag,
      ),
    ).resolves.toEqual({
      status: "command",
      result: { outcome: "accepted" },
    });
    expect(
      data.prompts.find((prompt) => prompt.id === created.id)?.status,
    ).toBe("candidate");
    const staged = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    await expect(
      command(
        { command: "publish-configuration" },
        { tenantId: "tenant-bright", locationId: null },
        staged.configuration.etag,
      ),
    ).resolves.toEqual({
      status: "command",
      result: { outcome: "accepted" },
    });
    expect(
      data.prompts.find((prompt) => prompt.id === created.id)?.status,
    ).toBe("published");
  });

  it("refuses to qualify or deploy an unevaluated Prompt Version", async () => {
    expect(
      await command(
        {
          command: "promote-prompt-version",
          promptVersionId: "prompt-generate-2",
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({
      status: "rejected",
      code: "INVALID_VALUE",
    });
    const before = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    await command(
      {
        command: "stage-configuration-changes",
        changes: [
          {
            operation: "deploy-prompt-version",
            action: "generate",
            promptVersionId: "prompt-generate-2",
          },
        ],
      },
      { tenantId: "tenant-bright", locationId: null },
      before.configuration.etag,
    );
    const staged = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    await expect(
      command(
        { command: "publish-configuration" },
        { tenantId: "tenant-bright", locationId: null },
        staged.configuration.etag,
      ),
    ).resolves.toMatchObject({ status: "rejected", code: "INVALID_VALUE" });
  });

  it("publishes exactly one evaluated candidate Prompt Version for an Action", async () => {
    const before = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    await expect(
      command(
        {
          command: "stage-configuration-changes",
          changes: [
            {
              operation: "deploy-prompt-version",
              action: "generate",
              promptVersionId: "prompt-generate-1",
            },
          ],
        },
        { tenantId: "tenant-bright", locationId: null },
        before.configuration.etag,
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });
    const staged = viewData<{ configuration: { etag: string } }>(
      await query(
        { view: "tenant-settings" },
        { tenantId: "tenant-bright", locationId: null },
      ),
    );
    await expect(
      command(
        { command: "publish-configuration" },
        { tenantId: "tenant-bright", locationId: null },
        staged.configuration.etag,
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });

    const prompts = viewData<{ prompts: { id: string; status: string }[] }>(
      await query({ view: "prompts", action: "generate" }, {
        tenantId: "tenant-bright",
        locationId: null,
      }),
    );
    expect(prompts.prompts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "prompt-generate-1", status: "published" }),
        expect.objectContaining({ id: "prompt-generate-2", status: "draft" }),
      ]),
    );
  });

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

  it("refuses duplicate Prompt Versions and Prompts owned by another Action", async () => {
    expect(
      await command(
        {
          command: "create-experiment",
          action: "generate",
          variants: [
            { promptVersionId: "prompt-generate-1", weightPct: 40 },
            { promptVersionId: "prompt-generate-1", weightPct: 60 },
          ],
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "INVALID_VALUE" });

    expect(
      await command(
        {
          command: "create-experiment",
          action: "paraphrase",
          variants: [
            { promptVersionId: "prompt-generate-1", weightPct: 40 },
            { promptVersionId: "prompt-generate-2", weightPct: 60 },
          ],
        },
        { tenantId: "tenant-bright", locationId: null },
      ),
    ).toMatchObject({ status: "rejected", code: "INVALID_VALUE" });
  });

  it("creates an experiment as a draft but refuses a second running Action experiment", async () => {
    data.prompts = data.prompts.map((prompt) =>
      prompt.id === "prompt-generate-2"
        ? { ...prompt, status: "candidate", evaluationScore: 1 }
        : prompt,
    );
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
    ).toMatchObject({ status: "rejected", code: "EXPERIMENT_RUNNING" });
    expect(
      data.experiments.find((experiment) => experiment.id === "experiment-2")
        ?.status,
    ).toBe("draft");
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
  it("keeps a Location Bench closed until one published snapshot can supply every choice", async () => {
    expect(
      await query(
        { view: "bench-form", replayGenerationId: null },
        { tenantId: "tenant-bright", locationId: "location-downtown" },
      ),
    ).toMatchObject({ status: "rejected", code: "VIEW_NOT_AVAILABLE" });
  });

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

describe("ADM-PLT-01 account lifecycle", () => {
  it("suspends and reactivates an account", async () => {
    await expect(
      command(
        {
          command: "set-tenant-status",
          tenantId: "tenant-bright",
          status: "suspended",
        },
        { tenantId: null, locationId: null },
      ),
    ).resolves.toEqual({ status: "command", result: { outcome: "accepted" } });
    expect(
      data.tenants.find((tenant) => tenant.id === "tenant-bright")?.status,
    ).toBe("suspended");

    await command(
      {
        command: "set-tenant-status",
        tenantId: "tenant-bright",
        status: "active",
      },
      { tenantId: null, locationId: null },
    );
    expect(
      data.tenants.find((tenant) => tenant.id === "tenant-bright")?.status,
    ).toBe("active");
  });

  it("reports a deactivated account as beyond reactivation here", async () => {
    await command(
      {
        command: "set-tenant-status",
        tenantId: "tenant-bright",
        status: "deactivated",
      },
      { tenantId: null, locationId: null },
    );

    const tenants = viewData<{
      tenants: { status: string; suspendable: boolean }[];
    }>(
      await query({ view: "platform-tenants" }, {
        tenantId: null,
        locationId: null,
      }),
    );

    expect(tenants.tenants[0]).toMatchObject({
      status: "deactivated",
      suspendable: false,
    });
  });

  it("answers not-found for an account that does not exist", async () => {
    await expect(
      command(
        {
          command: "set-tenant-status",
          tenantId: "tenant-imaginary",
          status: "suspended",
        },
        { tenantId: null, locationId: null },
      ),
    ).resolves.toEqual({ status: "not-found" });
  });
});

describe("ADM-AUTH-02 Platform scope selection", () => {
  it("offers a provisioned account in the scope bar without a Tenant Grant", async () => {
    await command(
      {
        command: "create-tenant",
        name: "Chen's Noodle",
        slug: "chens-noodle",
        locale: "en-GB",
        category: "Restaurant",
        plan: "lite",
      },
      { tenantId: null, locationId: null },
    );

    const bootstrap = viewData<{ tenants: { slug: string }[] }>(
      await query({ view: "bootstrap" }, { tenantId: null, locationId: null }),
    );

    // The Platform administrator holds no Tenant Grant for it, so Grants
    // alone would have hidden the account they had just created.
    expect(platformAccess.status === "authorized" && platformAccess.tenantGrants).toEqual(
      [],
    );
    expect(bootstrap.tenants.map((tenant) => tenant.slug)).toContain(
      "chens-noodle",
    );
  });

  it("keeps a Tenant operator's scope bar to their own Grants", async () => {
    const tenantOnly = createConsoleService({
      store,
      resolveAccess: async () => ({
        status: "authorized",
        operator: { id: "operator-tenant", email: "tenant@example.test" },
        platformGrants: [],
        tenantGrants: [
          {
            tenantId: "tenant-bright",
            tenantSlug: "brightsmile",
            tenantName: "BrightSmile",
            roleKey: "tenant_admin",
            capabilities: ["console:read", "tenant:configure"],
            locations: [],
          },
        ],
      }),
      now: () => new Date("2026-08-18T12:00:00.000Z"),
    });

    const result = await tenantOnly.request({
      identity,
      scope: { tenantId: null, locationId: null },
      publicOrigin: "https://review.example.test",
      request: { mode: "query", query: { view: "bootstrap" } },
    });
    if (result.status !== "view" || result.view.view !== "bootstrap") {
      throw new Error("expected bootstrap");
    }
    expect(result.view.data.tenants.map((tenant) => tenant.slug)).toEqual([
      "brightsmile",
    ]);
  });
});
