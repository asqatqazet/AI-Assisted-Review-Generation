/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import type { ConsoleViewDto } from "@review/contracts/console";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import OperatorConsole from "./operator-console.js";
import {
  createFakeConsoleClient,
  emptyOverview,
  tenantScope,
  testBootstrap,
  testOperatorAccess,
  type FakeConsoleClient,
} from "./console-client.test-support.js";

afterEach(cleanup);

function renderConsole(
  client: FakeConsoleClient,
  route = "/console",
): void {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/console/*" element={<OperatorConsole client={client} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const locationsView: Extract<ConsoleViewDto, { view: "locations" }>["data"] = {
  scope: tenantScope,
  editable: true,
  locations: [
    {
      id: "location-hafencity",
      slug: "hafencity",
      name: "HafenCity",
      address: {
        line1: "Kaiserkai 1",
        line2: "",
        postalCode: "20457",
        city: "Hamburg",
        country: "DE",
      },
      active: true,
      entryMode: "invite",
      entryModeSource: "tenant",
    },
  ],
};

describe("ADM-AUTH-03 capability-driven navigation", () => {
  it("offers no Platform or AI navigation to a Tenant operator", async () => {
    renderConsole(
      createFakeConsoleClient({
        views: { bootstrap: testBootstrap, overview: emptyOverview },
      }),
    );

    await screen.findByRole("heading", { name: "Overview" });
    const navigation = screen.getByRole("navigation", { name: "Console" });

    expect(within(navigation).getByRole("link", { name: "Locations" })).toBeVisible();
    expect(
      within(navigation).queryByRole("link", { name: "Providers" }),
    ).not.toBeInTheDocument();
    expect(
      within(navigation).queryByRole("link", { name: "Platform settings" }),
    ).not.toBeInTheDocument();
    expect(
      within(navigation).queryByRole("link", { name: "Experiments" }),
    ).not.toBeInTheDocument();
  });

  it("offers Platform navigation once the capability is granted", async () => {
    renderConsole(
      createFakeConsoleClient({
        views: {
          bootstrap: {
            ...testBootstrap,
            role: "platform_admin",
            activeContext: { tenantId: null, locationId: null },
            capabilities: {
              ...testBootstrap.capabilities,
              canAccessPlatform: true,
              canSwitchTenant: true,
              canManageAiOperations: true,
              canManageProviders: true,
            },
          },
          overview: { ...emptyOverview, scope: { type: "platform" } },
        },
      }),
    );

    await screen.findByRole("heading", { name: "Overview" });
    const navigation = screen.getByRole("navigation", { name: "Console" });
    expect(within(navigation).getByRole("link", { name: "Providers" })).toBeVisible();
    expect(within(navigation).getByRole("link", { name: "Experiments" })).toBeVisible();
  });

  it("uses the Gallery information order and canonical domain language", async () => {
    renderConsole(
      createFakeConsoleClient({
        views: {
          bootstrap: {
            ...testBootstrap,
            role: "platform_admin",
            activeContext: { tenantId: null, locationId: null },
            capabilities: {
              ...testBootstrap.capabilities,
              canAccessPlatform: true,
              canSwitchTenant: true,
              canManageAiOperations: true,
              canManageProviders: true,
            },
          },
          overview: { ...emptyOverview, scope: { type: "platform" } },
        },
      }),
    );

    await screen.findByRole("heading", { name: "Overview" });
    const navigation = screen.getByRole("navigation", { name: "Console" });
    expect(
      within(navigation)
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["Platform", "Operate", "Tenant", "Location", "Model"]);
    expect(
      within(navigation)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Tenants",
      "Providers",
      "Review Format catalogue",
      "Platform settings",
      "Overview",
      "Bench",
      "Analytics",
      "Business context",
      "Fact Options",
      "Review Format enablement",
      "Actions",
      "Tenant settings",
      "Locations",
      "Distribution",
      "Prompt versions",
      "Experiments",
    ]);
  });

  it("shows which immutable release is rendering the Console", async () => {
    renderConsole(
      createFakeConsoleClient({
        views: { bootstrap: testBootstrap, overview: emptyOverview },
      }),
    );

    expect(await screen.findByText("Release local")).toBeVisible();
  });

  it("shows a not-found message rather than a screen the scope cannot serve", async () => {
    renderConsole(
      createFakeConsoleClient({ views: { bootstrap: testBootstrap } }),
      "/console/analytics",
    );

    expect(
      await screen.findByText(
        "This resource is unavailable in the selected scope.",
      ),
    ).toBeVisible();
  });
});

describe("ADM-AUTH-02 scope selection", () => {
  it("sends the selected scope with every view request", async () => {
    const client = createFakeConsoleClient({
      views: { bootstrap: testBootstrap, locations: locationsView },
    });
    renderConsole(client, "/console/locations");

    await screen.findByRole("heading", { name: "Locations" });

    expect(
      client.requests.find((request) => request.view === "locations")?.scope,
    ).toEqual({ tenantId: "tenant-speicher", locationId: null });
  });

  it("narrows every request when a Location is selected", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: { bootstrap: testBootstrap, locations: locationsView },
    });
    renderConsole(client, "/console/locations");

    await screen.findByRole("heading", { name: "Locations" });
    await user.selectOptions(
      screen.getByLabelText("Location"),
      "location-hafencity",
    );

    await waitFor(() => {
      expect(
        client.requests.filter((request) => request.view === "locations").at(-1)
          ?.scope,
      ).toEqual({
        tenantId: "tenant-speicher",
        locationId: "location-hafencity",
      });
    });
  });

  it("reads the scope back out of the URL so a shared link reproduces it", async () => {
    const client = createFakeConsoleClient({
      views: { bootstrap: testBootstrap, locations: locationsView },
    });
    renderConsole(
      client,
      "/console/locations?tenantId=tenant-speicher&locationId=location-hafencity",
    );

    await screen.findByRole("heading", { name: "Locations" });
    expect(
      client.requests.find((request) => request.view === "locations")?.scope,
    ).toEqual({
      tenantId: "tenant-speicher",
      locationId: "location-hafencity",
    });
  });

  it("renders one generic not-found for an explicit crossed Location instead of normalizing it away", async () => {
    const client = createFakeConsoleClient({ views: { bootstrap: testBootstrap } });
    renderConsole(
      client,
      "/console/locations/location-other/settings?tenantId=tenant-speicher&locationId=location-other",
    );

    expect(
      await screen.findByText(
        "This resource is unavailable in the selected scope.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("Select a Location to see its settings."),
    ).not.toBeInTheDocument();
    expect(
      client.requests.find((request) => request.view === "location-settings")
        ?.scope,
    ).toEqual({
      tenantId: "tenant-speicher",
      locationId: "location-other",
    });
  });
});

describe("ADM-OVR-02/03 operational warnings", () => {
  it("renders the budget warning the backend reported without recomputing it", async () => {
    renderConsole(
      createFakeConsoleClient({
        views: {
          bootstrap: testBootstrap,
          overview: {
            ...emptyOverview,
            alerts: [
              {
                type: "budget_warning",
                severity: "warning",
                tenant: null,
                spent: { amountMicros: 820_000_000, currency: "EUR" },
                budget: { amountMicros: 1_000_000_000, currency: "EUR" },
                thresholdPercent: 80,
              },
            ],
          },
        },
      }),
    );

    expect(
      await screen.findByText(/past the 80% alert threshold/),
    ).toBeVisible();
  });

  it("renders provider degradation without customer-facing infrastructure wording", async () => {
    renderConsole(
      createFakeConsoleClient({
        views: {
          bootstrap: testBootstrap,
          overview: {
            ...emptyOverview,
            alerts: [
              {
                type: "provider_degraded",
                severity: "warning",
                providerKey: "openai",
                displayName: "Primary model provider",
              },
            ],
            providerHealth: [
              {
                providerKey: "openai",
                displayName: "Primary model provider",
                routingRole: "primary",
                status: "degraded",
                p95LatencyMs: 4200,
                fallbackShare: 0.35,
              },
            ],
          },
        },
      }),
    );

    expect(
      await screen.findByText(/Primary model provider is degraded/),
    ).toBeVisible();
    expect(screen.getByText("4200 ms")).toBeVisible();
  });

  it("shows an empty state instead of a blank dashboard", async () => {
    renderConsole(
      createFakeConsoleClient({
        views: { bootstrap: testBootstrap, overview: emptyOverview },
      }),
    );

    expect(
      await screen.findByText(
        "No Generation was recorded in this scope and window.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("No experiment is running in this scope."),
    ).toBeVisible();
  });
});

describe("ADM-LOC-03 override and reset", () => {
  const settingsView: Extract<
    ConsoleViewDto,
    { view: "location-settings" }
  >["data"] = {
    scope: {
      type: "location",
      tenant: tenantScope.tenant,
      location: {
        id: "location-hafencity",
        slug: "hafencity",
        name: "HafenCity",
      },
    },
    editable: true,
    configuration: { etag: '"revision-1"', draft: null },
    settings: [
      {
        key: "requireDisclosure",
        label: "Review disclosure",
        description: "",
        group: "Settings",
        kind: "boolean",
        ownerScope: "tenant",
        effectiveValue: true,
        source: "tenant",
        tenantValue: true,
        locationOverride: null,
        overridable: true,
      },
      {
        key: "locale",
        label: "Locale",
        description: "",
        group: "Settings",
        kind: "locale",
        ownerScope: "tenant",
        effectiveValue: "de-DE",
        source: "tenant",
        tenantValue: "de-DE",
        locationOverride: null,
        overridable: false,
      },
    ],
  };

  it("offers Override while inheriting and Reset once overridden", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        "location-settings": settingsView,
      },
    });
    renderConsole(
      client,
      "/console/locations/location-hafencity/settings?tenantId=tenant-speicher&locationId=location-hafencity",
    );

    expect(
      (await screen.findAllByText(/Inherited from account/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Account-wide only")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Override" }));

    expect(client.commands[0]?.command).toEqual({
      command: "stage-configuration-changes",
      changes: [
        {
          operation: "set-location-override",
          change: { key: "requireDisclosure", value: false },
        },
      ],
    });
  });

  it("sends a reset that deletes the override rather than a copy of the account value", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        "location-settings": {
          ...settingsView,
          settings: [
            {
              ...settingsView.settings[0]!,
              effectiveValue: false,
              source: "location",
              locationOverride: false,
            },
            settingsView.settings[1]!,
          ],
        },
      },
    });
    renderConsole(
      client,
      "/console/locations/location-hafencity/settings?tenantId=tenant-speicher&locationId=location-hafencity",
    );

    await screen.findByText(/Location override/);
    await user.click(
      screen.getByRole("button", { name: "Reset to account value" }),
    );

    expect(client.commands[0]?.command).toEqual({
      command: "stage-configuration-changes",
      changes: [
        {
          operation: "reset-location-override",
          key: "requireDisclosure",
        },
      ],
    });
  });
});

describe("ADM-LOC-04 distribution assets", () => {
  it("renders the real survey URL, a QR built from it and honest entry-mode copy", async () => {
    renderConsole(
      createFakeConsoleClient({
        views: {
          bootstrap: testBootstrap,
          distribution: {
            scope: {
              type: "location",
              tenant: tenantScope.tenant,
              location: {
                id: "location-hafencity",
                slug: "hafencity",
                name: "HafenCity",
              },
            },
            liveUrl: "https://review.example.test/s/speicher-neun/hafencity",
            qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
            qrUnavailableReason: null,
            entryMode: "open-qr",
            verifiesVisit: false,
            invitationTemplate: "Thanks for visiting HafenCity.",
            tableQrCopy: "Scan to review HafenCity.",
            counters: { issued: 0, opened: 12, completed: 5 },
          },
          destinations: {
            scope: {
              type: "location",
              tenant: tenantScope.tenant,
              location: {
                id: "location-hafencity",
                slug: "hafencity",
                name: "HafenCity",
              },
            },
            editable: true,
            destinations: [
              {
                destinationTypeId: "destination-google",
                platform: "google",
                displayName: "Google Maps",
                platformPlaceId: "",
                targetUrl: "",
                enabled: false,
                configurationState: "missing",
              },
            ],
          },
        },
      }),
      "/console/locations/location-hafencity/distribution?tenantId=tenant-speicher&locationId=location-hafencity",
    );

    expect(
      await screen.findByText(
        "https://review.example.test/s/speicher-neun/hafencity",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/anyone who scans can start, so a visit is not verified/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Download QR (SVG)" }),
    ).toHaveAttribute("download", "survey-qr.svg");
    expect(screen.getByText("missing")).toBeVisible();
  });
});

describe("ADM-ANA-01 reproducible analytics", () => {
  it("carries the date range and sort in the request", async () => {
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        analytics: {
          scope: tenantScope,
          query: {
            from: "2026-07-01T00:00:00.000Z",
            to: "2026-08-01T00:00:00.000Z",
            sortKey: "totalCost",
            sortDirection: "desc",
          },
          rows: [],
        },
      },
    });
    renderConsole(
      client,
      "/console/analytics?tenantId=tenant-speicher&from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z&sortKey=totalCost&sortDirection=desc",
    );

    expect(
      await screen.findByText("No Generation matched this scope and date range."),
    ).toBeVisible();
    expect(
      client.requests.find((request) => request.view === "analytics")?.params,
    ).toEqual({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
      sortKey: "totalCost",
      sortDirection: "desc",
    });
  });
});

describe("Console session", () => {
  it("offers sign-in when the session is missing", async () => {
    const client = createFakeConsoleClient();
    const failing: FakeConsoleClient = {
      ...client,
      readSession: async () => {
        const { ConsoleAccessError } = await import("./console-client.js");
        throw new ConsoleAccessError("unauthenticated");
      },
    };
    renderConsole(failing);

    expect(
      await screen.findByRole("link", { name: "Sign in" }),
    ).toBeVisible();
  });

  it("keeps the operator identity visible in the scope bar", async () => {
    renderConsole(
      createFakeConsoleClient({
        views: { bootstrap: testBootstrap, overview: emptyOverview },
        access: testOperatorAccess,
      }),
    );

    expect(await screen.findByText("owner@example.com")).toBeVisible();
  });
});

describe("Console failure states are distinguishable", () => {
  async function renderWithSessionError(code: string): Promise<void> {
    const { ConsoleAccessError } = await import("./console-client.js");
    const client = createFakeConsoleClient();
    renderConsole({
      ...client,
      readSession: async () => {
        throw new ConsoleAccessError(code as never);
      },
    });
  }

  it("tells an operator a scope is empty rather than blaming the service", async () => {
    await renderWithSessionError("not-found");

    expect(
      await screen.findByRole("heading", { name: "Nothing to show in this scope" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });

  it("tells an operator the service is down and offers a retry", async () => {
    await renderWithSessionError("unavailable");

    expect(
      await screen.findByRole("heading", { name: "Console is not responding" }),
    ).toBeVisible();
    expect(
      screen.getByText(/service problem, not a permissions problem/),
    ).toBeVisible();
  });

  it("separates a missing Grant from both of those", async () => {
    await renderWithSessionError("forbidden");

    expect(
      await screen.findByText("Your identity has no current Console Access Grant."),
    ).toBeVisible();
  });
});

describe("Console forms offer the choices the data allows", () => {
  it("runs Bench only after selecting a published Fact Option", async () => {
    const user = userEvent.setup();
    const locationScope = {
      type: "location" as const,
      tenant: tenantScope.tenant,
      location: {
        id: "location-hafencity",
        slug: "hafencity",
        name: "HafenCity",
      },
    };
    const client = createFakeConsoleClient({
      views: {
        bootstrap: {
          ...testBootstrap,
          capabilities: {
            ...testBootstrap.capabilities,
            canManageAiOperations: true,
          },
        },
        "bench-form": {
          scope: locationScope,
          actions: [
            {
              key: "generate",
              label: "Generate",
              requiredInputs: ["factOptionsOrFreeText"],
            },
          ],
          styles: [
            {
              id: "format-generate",
              name: "Generate only",
              supportedActions: ["generate"],
            },
          ],
          promptVersions: [
            {
              id: "prompt-generate",
              action: "generate",
              key: "review.generate",
              hash: `sha256:${"a".repeat(64)}`,
            },
          ],
          providers: [
            { key: "fake", displayName: "FakeProvider", isTestProvider: true },
          ],
          keywords: [{ id: "fact-welcome", label: "Warm welcome" }],
          prefill: null,
          missingReplayDependencies: [],
        },
      },
    });
    renderConsole(
      client,
      "/console/ai/bench?tenantId=tenant-speicher&locationId=location-hafencity",
    );

    const run = await screen.findByRole("button", { name: "Run on the bench" });
    expect(run).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Warm welcome" }));
    expect(run).toBeEnabled();
    await user.click(run);

    await waitFor(() =>
      expect(client.commands).toEqual([
        {
          scope: {
            tenantId: "tenant-speicher",
            locationId: "location-hafencity",
          },
          command: {
            command: "run-bench",
            input: {
              action: "generate",
              styleId: "format-generate",
              promptVersionId: "prompt-generate",
              provider: "fake",
              keywordIds: ["fact-welcome"],
              freeText: "",
              sourceText: "",
            },
          },
        },
      ]),
    );
  });

  it("does not run an impossible Bench Action/Format/Prompt combination", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: {
          ...testBootstrap,
          capabilities: {
            ...testBootstrap.capabilities,
            canManageAiOperations: true,
          },
        },
        "bench-form": {
          scope: tenantScope,
          actions: [
            { key: "generate", label: "Generate", requiredInputs: [] },
            {
              key: "paraphrase",
              label: "Paraphrase",
              requiredInputs: ["sourceText"],
            },
          ],
          styles: [
            {
              id: "format-generate",
              name: "Generate only",
              supportedActions: ["generate"],
            },
          ],
          promptVersions: [
            {
              id: "prompt-generate",
              action: "generate",
              key: "review.generate",
              hash: `sha256:${"a".repeat(64)}`,
            },
          ],
          providers: [
            { key: "fake", displayName: "FakeProvider", isTestProvider: true },
          ],
          keywords: [],
          prefill: null,
          missingReplayDependencies: [],
        },
      },
    });
    renderConsole(client, "/console/ai/bench?tenantId=tenant-speicher");

    expect(
      await screen.findByRole("button", { name: "Run on the bench" }),
    ).toBeDisabled();
    expect(screen.getByText(/Select a Location to run the bench/)).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Action"), "paraphrase");

    expect(
      screen.getByRole("button", { name: "Run on the bench" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/No compatible Review Format and Prompt Version/),
    ).toBeVisible();
    expect(client.commands).toEqual([]);
  });

  it("lets a prompt Draft be created for any Action, not just the filtered one", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: {
          ...testBootstrap,
          capabilities: {
            ...testBootstrap.capabilities,
            canManageAiOperations: true,
          },
        },
        prompts: {
          scope: tenantScope,
          editable: true,
          prompts: [],
          actions: [
            { key: "generate", label: "Generate" },
            { key: "condense", label: "Condense" },
          ],
        },
      },
    });
    renderConsole(client, "/console/ai/prompts?tenantId=tenant-speicher");

    await screen.findByRole("heading", { name: "Create a draft version" });
    await user.selectOptions(screen.getByLabelText("Action"), "condense");
    await user.type(screen.getByLabelText("Prompt body"), "Shorten it.");
    await user.click(screen.getByRole("button", { name: "Create draft version" }));

    expect(client.commands[0]?.command).toMatchObject({
      command: "create-prompt-version",
      action: "condense",
    });
  });

  it("offers locale and entry mode as choices rather than free text", async () => {
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        "tenant-settings": {
          scope: tenantScope,
          editable: true,
          configuration: { etag: '"revision-1"', draft: null },
          settings: [
            {
              key: "locale",
              label: "Locale",
              description: "",
              group: "Settings",
              kind: "locale",
              ownerScope: "tenant",
              value: "de-DE",
              platformDefault: null,
              editable: true,
            },
            {
              key: "entryMode",
              label: "Entry mode",
              description: "",
              group: "Settings",
              kind: "entry-mode",
              ownerScope: "tenant",
              value: "open-qr",
              platformDefault: null,
              editable: true,
            },
            {
              key: "toneGuidelines",
              label: "Tone guidelines",
              description: "",
              group: "Settings",
              kind: "text",
              ownerScope: "tenant",
              value: "Plain and factual.",
              platformDefault: null,
              editable: true,
            },
          ],
          keywordCategories: [],
        },
      },
    });
    renderConsole(client, "/console/settings/tenant?tenantId=tenant-speicher");

    const locale = await screen.findByLabelText("Locale");
    expect(locale.tagName).toBe("SELECT");
    expect(
      [...(locale as HTMLSelectElement).options].map((option) => option.value),
    ).toEqual(["en-GB", "de-DE"]);

    const entryMode = screen.getByLabelText("Entry mode");
    expect(
      [...(entryMode as HTMLSelectElement).options].map((option) => option.value),
    ).toEqual(["invite", "open-qr", "both"]);

    // Free-form guidance gets room to be written in.
    expect(screen.getByLabelText("Tone guidelines").tagName).toBe("TEXTAREA");
  });

  it("does not offer a save until something has changed", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        "tenant-settings": {
          scope: tenantScope,
          editable: true,
          configuration: { etag: '"revision-1"', draft: null },
          settings: [
            {
              key: "locale",
              label: "Locale",
              description: "",
              group: "Settings",
              kind: "locale",
              ownerScope: "tenant",
              value: "en-GB",
              platformDefault: null,
              editable: true,
            },
          ],
          keywordCategories: [],
        },
      },
    });
    renderConsole(client, "/console/settings/tenant?tenantId=tenant-speicher");

    expect(
      await screen.findByRole("button", { name: "Stage account settings" }),
    ).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Locale"), "de-DE");

    expect(
      screen.getByRole("button", { name: "Stage account settings" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeVisible();
  });
});
