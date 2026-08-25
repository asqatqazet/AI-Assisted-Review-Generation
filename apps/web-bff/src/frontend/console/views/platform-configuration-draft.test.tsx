/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import type {
  ConsoleCommandDto,
  ConsoleCommandResultDto,
  ConsoleScopeRequestDto,
  ConsoleViewDto,
} from "@review/contracts/console";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { ConsoleClient } from "../console-client.js";
import type { ConsoleScopeController } from "../use-console-scope.js";
import { PlatformProvidersView, PlatformSettingsView } from "./platform.js";

afterEach(cleanup);

const scopeController: ConsoleScopeController = {
  scope: { tenantId: null, locationId: null },
  tenant: undefined,
  locations: [],
  selectTenant: () => undefined,
  selectLocation: () => undefined,
  href: (path) => path,
};

interface RecordedCommand {
  readonly command: ConsoleCommandDto;
  readonly scope: ConsoleScopeRequestDto;
  readonly ifMatch: string | undefined;
}

function clientFor(data: ConsoleViewDto["data"]): {
  readonly client: ConsoleClient;
  readonly commands: RecordedCommand[];
} {
  const commands: RecordedCommand[] = [];
  return {
    commands,
    client: {
      readSession: async () => {
        throw new Error("unused");
      },
      readView: async () => data as never,
      runCommand: async ({ command, scope, ifMatch }) => {
        commands.push({ command, scope, ifMatch });
        return { outcome: "accepted" } satisfies ConsoleCommandResultDto;
      },
      logout: async () => "https://auth.example.test/logout",
    },
  };
}

function renderView(element: React.ReactNode): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      {element}
    </QueryClientProvider>,
  );
}

const providerData: Extract<
  ConsoleViewDto,
  { view: "platform-providers" }
>["data"] = {
  scope: "platform",
  configuration: {
    etag: '"platform-configuration:7:draft:none"',
    draft: null,
  },
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
      providerName: "Gemini",
      modelKey: "flash",
      modelName: "Flash",
      health: "healthy",
      credentialState: "configured",
      supportsStreaming: true,
      supportsStructuredOutput: true,
      maxTokens: 8192,
      routingPriority: null,
      fallbackPriority: 1,
    },
  ],
  priceVersions: [],
};

describe("Platform Configuration Draft UI", () => {
  it("stages routing and prospective pricing with the Platform ETag", async () => {
    const user = userEvent.setup();
    const { client, commands } = clientFor(providerData);
    renderView(
      <PlatformProvidersView
        client={client}
        scopeController={scopeController}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Stage as primary" }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toEqual({
      scope: { tenantId: null, locationId: null },
      ifMatch: providerData.configuration.etag,
      command: {
        command: "stage-platform-configuration-changes",
        changes: [
          {
            operation: "set-provider-routing",
            providerKey: "gemini",
            modelKey: "flash",
            routingPriority: 1,
            fallbackPriority: null,
          },
        ],
      },
    });

    await user.type(screen.getByLabelText("Valid from"), "2099-09-10");
    await user.click(screen.getByRole("button", { name: "Stage price version" }));
    await waitFor(() => expect(commands).toHaveLength(2));
    expect(commands[1]).toMatchObject({
      ifMatch: providerData.configuration.etag,
      command: {
        command: "stage-platform-configuration-changes",
        changes: [
          expect.objectContaining({
            operation: "publish-price-rate",
            providerKey: "fake",
            modelKey: "fake-v1",
            validFrom: "2099-09-10T00:00:00.000Z",
          }),
        ],
      },
    });
    expect(commands.map(({ command }) => command.command)).not.toEqual(
      expect.arrayContaining(["set-provider-routing", "publish-price-rate"]),
    );
  });

  it("stages settings and publishes or cancels the visible Draft with If-Match", async () => {
    const user = userEvent.setup();
    const etag = '"platform-configuration:7:draft:draft-1:2"';
    const settingsData: Extract<
      ConsoleViewDto,
      { view: "platform-settings" }
    >["data"] = {
      scope: "platform",
      configuration: {
        etag,
        draft: {
          baseEtag: '"platform-configuration:7:draft:none"',
          changes: [
            {
              operation: "save-platform-settings",
              defaultPolicyTemplate: "{}",
              globalRateLimits: {
                perReviewSessionPerHour: 20,
                perTenantPerMinute: 60,
                maxConcurrentGenerations: 4,
              },
              logRetentionDays: 30,
              featureFlags: [],
            },
          ],
        },
      },
      defaultPolicyTemplate: "{}",
      globalRateLimits: {
        perReviewSessionPerHour: 20,
        perTenantPerMinute: 60,
        maxConcurrentGenerations: 4,
      },
      logRetentionDays: 30,
      featureFlags: [],
    };
    const { client, commands } = clientFor(settingsData);
    renderView(
      <PlatformSettingsView
        client={client}
        scopeController={scopeController}
      />,
    );

    await user.clear(await screen.findByLabelText("Log retention (days)"));
    await user.type(screen.getByLabelText("Log retention (days)"), "45");
    await user.click(screen.getByRole("button", { name: "Stage platform settings" }));
    await waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({
      ifMatch: etag,
      command: {
        command: "stage-platform-configuration-changes",
        changes: [
          expect.objectContaining({
            operation: "save-platform-settings",
            logRetentionDays: 45,
          }),
        ],
      },
    });

    await user.click(screen.getByRole("button", { name: "Publish Platform Draft" }));
    await waitFor(() => expect(commands).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: "Cancel Platform Draft" }));
    await waitFor(() => expect(commands).toHaveLength(3));
    expect(commands.slice(1)).toEqual([
      {
        command: { command: "publish-platform-configuration" },
        scope: { tenantId: null, locationId: null },
        ifMatch: etag,
      },
      {
        command: { command: "cancel-platform-configuration-draft" },
        scope: { tenantId: null, locationId: null },
        ifMatch: etag,
      },
    ]);
    expect(commands.map(({ command }) => command.command)).not.toContain(
      "save-platform-settings",
    );
  });
});
