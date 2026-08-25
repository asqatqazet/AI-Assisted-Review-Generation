/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import type { ConsoleViewDto } from "@review/contracts/console";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleRejectionError,
} from "../console-client.js";
import {
  createFakeConsoleClient,
  tenantScope,
  testBootstrap,
  type FakeConsoleClient,
} from "../console-client.test-support.js";
import OperatorConsole from "../operator-console.js";

afterEach(cleanup);

const tenantSettings: Extract<
  ConsoleViewDto,
  { view: "tenant-settings" }
>["data"] = {
  scope: tenantScope,
  editable: true,
  configuration: {
    etag: '"tenant-configuration:7:draft:none"',
    draft: null,
  },
  settings: [
    {
      key: "locale",
      label: "Locale",
      description: "Reviewer-facing locale.",
      group: "Experience",
      kind: "locale",
      ownerScope: "tenant",
      source: "tenant",
      value: "en-GB",
      platformDefault: "en-GB",
      tenantValue: "en-GB",
      editable: true,
    },
  ],
  keywordCategories: [],
};

const locationSettings: Extract<
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
  configuration: {
    etag: '"location-configuration:11:draft:none"',
    draft: null,
  },
  settings: [
    {
      key: "requireDisclosure",
      label: "Review disclosure",
      description: "Show the disclosure.",
      group: "Policy",
      kind: "boolean",
      ownerScope: "tenant",
      effectiveValue: true,
      source: "tenant",
      platformDefault: false,
      tenantValue: true,
      locationOverride: null,
      overridable: true,
    },
  ],
};

const facts: Extract<ConsoleViewDto, { view: "keywords" }>["data"] = {
  scope: tenantScope,
  editable: true,
  categories: [{ key: "service", label: "Service", sortOrder: 0 }],
  keywords: [
    {
      id: "fact-friendly",
      label: "Friendly",
      categoryKey: "service",
      categoryLabel: "Service",
      polarity: "positive",
      ownerScope: "tenant",
      active: true,
      sortOrder: 0,
      deletable: true,
    },
    {
      id: "fact-fast",
      label: "Fast",
      categoryKey: "service",
      categoryLabel: "Service",
      polarity: "positive",
      ownerScope: "tenant",
      active: true,
      sortOrder: 1,
      deletable: false,
    },
  ],
};

const reviewFormats: Extract<ConsoleViewDto, { view: "styles" }>["data"] = {
  scope: tenantScope,
  editable: true,
  tenantLocale: "en-GB",
  styles: [
    {
      id: "format-google",
      key: "google-short",
      name: "Google short",
      version: "1",
      locale: "en-GB",
      targetPlatform: "google",
      maxChars: 500,
      supportedActions: ["generate"],
      enabled: false,
      sortOrder: 0,
      enabledActions: [],
      incompatibility: null,
    },
    {
      id: "format-tripadvisor",
      key: "tripadvisor-short",
      name: "Tripadvisor short",
      version: "1",
      locale: "en-GB",
      targetPlatform: "tripadvisor",
      maxChars: 500,
      supportedActions: ["generate"],
      enabled: true,
      sortOrder: 1,
      enabledActions: ["generate"],
      incompatibility: null,
    },
  ],
};

const actions: Extract<ConsoleViewDto, { view: "actions" }>["data"] = {
  scope: tenantScope,
  editable: true,
  actions: [
    {
      key: "generate",
      label: "Generate",
      enabled: false,
      requiredInputs: ["facts"],
      groundingRule: "Every assertion must be grounded in submitted facts.",
      relativeCost: "low",
      disableBlockedReason: null,
    },
  ],
};

const locationScope = {
  type: "location" as const,
  tenant: tenantScope.tenant,
  location: {
    id: "location-hafencity",
    slug: "hafencity",
    name: "HafenCity",
  },
};

function renderConsole(client: FakeConsoleClient, route: string): void {
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

describe("Tenant and Location configuration Drafts", () => {
  it("stages account settings against the authoritative ETag instead of using the retired direct command", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: { bootstrap: testBootstrap, "tenant-settings": tenantSettings },
      onCommand: (command) => {
        if (command.command === "save-tenant-settings") {
          throw new ConsoleRejectionError(
            "CONFIG_DRAFT_REQUIRED",
            "Account settings must be staged in the Tenant Draft.",
          );
        }
        return { outcome: "accepted" };
      },
    });
    renderConsole(
      client,
      "/console/settings/tenant?tenantId=tenant-speicher",
    );

    await user.selectOptions(await screen.findByLabelText("Locale"), "de-DE");
    await user.click(
      screen.getByRole("button", { name: /account settings/iu }),
    );

    await waitFor(() =>
      expect(client.commands).toEqual([
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [{ key: "locale", value: "de-DE" }],
          },
        },
      ]),
    );
    expect(
      screen.queryByText("Account settings must be staged in the Tenant Draft."),
    ).not.toBeInTheDocument();
  });

  it("shows the Tenant Draft count and makes cancel/publish explicit against the current ETag", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        "tenant-settings": {
          ...tenantSettings,
          configuration: {
            etag: '"tenant-configuration:7:draft:draft-a:2"',
            draft: {
              baseEtag: '"tenant-configuration:7:draft:none"',
              changes: [
                { key: "locale", value: "de-DE" },
                {
                  operation: "set-action-enablement",
                  action: "generate",
                  enabled: true,
                },
              ],
            },
          },
        },
      },
    });
    renderConsole(
      client,
      "/console/settings/tenant?tenantId=tenant-speicher",
    );

    expect(await screen.findByText("2 staged changes")).toBeVisible();
    expect(
      screen.getByText(/Publishing this Tenant Draft updates every Location/iu),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancel draft" }));
    await waitFor(() => expect(client.commands).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Publish draft" }));

    await waitFor(() =>
      expect(client.commands).toEqual([
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:draft-a:2"',
          command: { command: "cancel-configuration-draft" },
        },
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:draft-a:2"',
          command: { command: "publish-configuration" },
        },
      ]),
    );
  });

  it("stages a Location override against the Location Draft instead of calling the retired direct command", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        "location-settings": locationSettings,
      },
      onCommand: (command) => {
        if (command.command === "set-location-override") {
          throw new ConsoleRejectionError(
            "CONFIG_DRAFT_REQUIRED",
            "Location overrides must be staged in the Location Draft.",
          );
        }
        return { outcome: "accepted" };
      },
    });
    renderConsole(
      client,
      "/console/locations/location-hafencity/settings?tenantId=tenant-speicher&locationId=location-hafencity",
    );

    await user.click(await screen.findByRole("button", { name: "Override" }));

    await waitFor(() =>
      expect(client.commands).toEqual([
        {
          scope: {
            tenantId: "tenant-speicher",
            locationId: "location-hafencity",
          },
          ifMatch: '"location-configuration:11:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "set-location-override",
                change: { key: "requireDisclosure", value: false },
              },
            ],
          },
        },
      ]),
    );
    expect(
      screen.getByText(
        "Publishing this Location Draft updates only the selected Location.",
      ),
    ).toBeVisible();
  });

  it("stages deletion of a Location override rather than copying the inherited value", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        "location-settings": {
          ...locationSettings,
          settings: [
            {
              ...locationSettings.settings[0]!,
              effectiveValue: false,
              source: "location",
              locationOverride: false,
            },
          ],
        },
      },
    });
    renderConsole(
      client,
      "/console/locations/location-hafencity/settings?tenantId=tenant-speicher&locationId=location-hafencity",
    );

    await user.click(
      await screen.findByRole("button", { name: "Reset to account value" }),
    );

    await waitFor(() =>
      expect(client.commands).toEqual([
        {
          scope: {
            tenantId: "tenant-speicher",
            locationId: "location-hafencity",
          },
          ifMatch: '"location-configuration:11:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "reset-location-override",
                key: "requireDisclosure",
              },
            ],
          },
        },
      ]),
    );
  });

  it("stages Fact Option create, update, reorder and delete as one Tenant Draft vocabulary", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000901",
    );
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        keywords: facts,
        "tenant-settings": tenantSettings,
      },
      onCommand: (command) => {
        if (
          [
            "create-keyword",
            "update-keyword",
            "reorder-keywords",
            "delete-keyword",
          ].includes(command.command)
        ) {
          throw new ConsoleRejectionError(
            "CONFIG_DRAFT_REQUIRED",
            "Fact Options must be staged in the Tenant Draft.",
          );
        }
        return { outcome: "accepted" };
      },
    });
    renderConsole(
      client,
      "/console/configuration/keywords?tenantId=tenant-speicher",
    );

    await user.type(await screen.findByLabelText("Label"), "Helpful");
    await user.click(screen.getByRole("button", { name: "Add fact option" }));
    await waitFor(() => expect(client.commands).toHaveLength(1));
    await user.click(
      screen.getAllByRole("button", { name: "Deactivate" })[0]!,
    );
    await waitFor(() => expect(client.commands).toHaveLength(2));
    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]!);
    await waitFor(() => expect(client.commands).toHaveLength(3));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(client.commands).toEqual([
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "create-fact-option",
                mutationId: "00000000-0000-4000-8000-000000000901",
                label: "Helpful",
                categoryKey: "service",
                polarity: "positive",
                ownerScope: "tenant",
              },
            ],
          },
        },
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "update-fact-option",
                keywordId: "fact-friendly",
                label: "Friendly",
                polarity: "positive",
                active: false,
              },
            ],
          },
        },
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "reorder-fact-options",
                orderedKeywordIds: ["fact-fast", "fact-friendly"],
              },
            ],
          },
        },
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "delete-fact-option",
                keywordId: "fact-friendly",
              },
            ],
          },
        },
      ]),
    );
  });

  it("stages Review Format enablement and ordering against the Tenant Draft ETag", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        styles: reviewFormats,
        "tenant-settings": tenantSettings,
      },
      onCommand: (command) => {
        if (
          command.command === "set-style-enablement" ||
          command.command === "reorder-styles"
        ) {
          throw new ConsoleRejectionError(
            "CONFIG_DRAFT_REQUIRED",
            "Review Formats must be staged in the Tenant Draft.",
          );
        }
        return { outcome: "accepted" };
      },
    });
    renderConsole(
      client,
      "/console/configuration/styles?tenantId=tenant-speicher",
    );

    await user.click(await screen.findByRole("button", { name: "Enable" }));
    await waitFor(() => expect(client.commands).toHaveLength(1));
    await user.click(screen.getAllByRole("button", { name: "Move down" })[0]!);

    await waitFor(() =>
      expect(client.commands).toEqual([
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "set-review-format-enablement",
                styleId: "format-google",
                enabled: true,
                enabledActions: ["generate"],
              },
            ],
          },
        },
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "reorder-review-formats",
                orderedStyleIds: ["format-tripadvisor", "format-google"],
              },
            ],
          },
        },
      ]),
    );
  });

  it("stages Action enablement against the Tenant Draft ETag", async () => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        actions,
        "tenant-settings": tenantSettings,
      },
      onCommand: (command) => {
        if (command.command === "set-action-enablement") {
          throw new ConsoleRejectionError(
            "CONFIG_DRAFT_REQUIRED",
            "Actions must be staged in the Tenant Draft.",
          );
        }
        return { outcome: "accepted" };
      },
    });
    renderConsole(
      client,
      "/console/configuration/actions?tenantId=tenant-speicher",
    );

    await user.click(await screen.findByRole("button", { name: "Enable" }));

    await waitFor(() =>
      expect(client.commands).toEqual([
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "set-action-enablement",
                action: "generate",
                enabled: true,
              },
            ],
          },
        },
      ]),
    );
  });

  it("presents Business Context as audit-only until it participates in published snapshots", async () => {
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        context: {
          scope: tenantScope,
          editable: true,
          current: {
            id: "context-v3",
            version: 3,
            status: "published",
            createdAt: "2026-08-24T00:00:00.000Z",
            createdBy: "owner@example.com",
            context: "Independent neighbourhood dental clinic.",
            bannedTerms: ["best ever"],
          },
          history: [
            {
              id: "context-v3",
              version: 3,
              createdAt: "2026-08-24T00:00:00.000Z",
              createdBy: "owner@example.com",
            },
          ],
        },
      },
    });
    renderConsole(
      client,
      "/console/configuration/context?tenantId=tenant-speicher",
    );

    expect(
      await screen.findByText(/audit history only/iu),
    ).toBeVisible();
    expect(
      screen.getByText("Independent neighbourhood dental clinic."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /publish/iu }),
    ).not.toBeInTheDocument();
    expect(client.commands).toHaveLength(0);
  });

  it("removes the misleading one-click republish control from Distribution", async () => {
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        distribution: {
          scope: locationScope,
          liveUrl: "https://review.example.test/s/speicher-neun/hafencity",
          qrSvg: null,
          qrUnavailableReason: "Open QR is disabled.",
          entryMode: "invite",
          verifiesVisit: true,
          invitationTemplate: "Please review HafenCity.",
          tableQrCopy: "",
          counters: { issued: 1, opened: 1, completed: 0 },
        },
        destinations: {
          scope: locationScope,
          editable: true,
          destinations: [],
        },
      },
    });
    renderConsole(
      client,
      "/console/locations/location-hafencity/distribution?tenantId=tenant-speicher&locationId=location-hafencity",
    );

    expect(await screen.findByText(/Live survey URL/iu)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Publish configuration/iu }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/settings as they stand right now/iu),
    ).not.toBeInTheDocument();
  });

  it("calls Prompt creation a Draft, not a publication or deployment", async () => {
    const aiBootstrap = {
      ...testBootstrap,
      capabilities: {
        ...testBootstrap.capabilities,
        canManageAiOperations: true,
      },
    };
    const client = createFakeConsoleClient({
      views: {
        bootstrap: aiBootstrap,
        prompts: {
          scope: tenantScope,
          editable: true,
          prompts: [],
          actions: [{ key: "generate", label: "Generate" }],
        },
      },
    });
    renderConsole(client, "/console/ai/prompts?tenantId=tenant-speicher");

    expect(await screen.findByText("Create a draft version")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create draft version" }),
    ).toBeVisible();
    expect(screen.queryByText(/Publish a new version/iu)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Publish draft version/iu }),
    ).not.toBeInTheDocument();
  });

  it("marks a fully evaluated Prompt as Candidate before staging its separate Tenant deployment", async () => {
    const user = userEvent.setup();
    const aiBootstrap = {
      ...testBootstrap,
      capabilities: {
        ...testBootstrap.capabilities,
        canManageAiOperations: true,
      },
    };
    const client = createFakeConsoleClient({
      views: {
        bootstrap: aiBootstrap,
        "tenant-settings": tenantSettings,
        prompts: {
          scope: tenantScope,
          editable: true,
          prompts: [
            {
              id: "prompt-evaluated-draft",
              action: "generate",
              version: 2,
              hash: `sha256:${"a".repeat(64)}`,
              status: "draft",
              createdAt: "2026-08-24T09:00:00.000Z",
              createdBy: "operator-1",
              evaluationScore: 1,
            },
            {
              id: "prompt-qualified-candidate",
              action: "generate",
              version: 1,
              hash: `sha256:${"b".repeat(64)}`,
              status: "candidate",
              createdAt: "2026-08-23T09:00:00.000Z",
              createdBy: "operator-1",
              evaluationScore: 1,
            },
            {
              id: "prompt-failed-evaluation",
              action: "generate",
              version: 3,
              hash: `sha256:${"e".repeat(64)}`,
              status: "draft",
              createdAt: "2026-08-24T10:00:00.000Z",
              createdBy: "operator-1",
              evaluationScore: 0.99,
            },
          ],
          actions: [{ key: "generate", label: "Generate" }],
        },
      },
    });
    renderConsole(client, "/console/ai/prompts?tenantId=tenant-speicher");

    await user.click(
      await screen.findByRole("button", { name: "Mark candidate" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Stage deployment" }),
    );

    await waitFor(() =>
      expect(client.commands).toEqual([
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          command: {
            command: "promote-prompt-version",
            promptVersionId: "prompt-evaluated-draft",
          },
        },
        {
          scope: { tenantId: "tenant-speicher", locationId: null },
          ifMatch: '"tenant-configuration:7:draft:none"',
          command: {
            command: "stage-configuration-changes",
            changes: [
              {
                operation: "deploy-prompt-version",
                action: "generate",
                promptVersionId: "prompt-qualified-candidate",
              },
            ],
          },
        },
      ]),
    );
    expect(screen.getByLabelText("Configuration Draft")).toBeVisible();
    expect(screen.getByText("Requires a 100% evaluation")).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Mark candidate" }),
    ).toHaveLength(1);
    expect(screen.queryByText(/Candidate is deployed/iu)).not.toBeInTheDocument();
  });

  it("shows a candidacy rejection without claiming the Prompt was deployed", async () => {
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
        "tenant-settings": tenantSettings,
        prompts: {
          scope: tenantScope,
          editable: true,
          prompts: [
            {
              id: "prompt-evaluated-draft",
              action: "generate",
              version: 2,
              hash: `sha256:${"c".repeat(64)}`,
              status: "draft",
              createdAt: "2026-08-24T09:00:00.000Z",
              createdBy: "operator-1",
              evaluationScore: 1,
            },
          ],
          actions: [{ key: "generate", label: "Generate" }],
        },
      },
      onCommand: (command) => {
        if (command.command === "promote-prompt-version") {
          throw new ConsoleRejectionError(
            "INVALID_VALUE",
            "The latest complete evaluation no longer passes.",
          );
        }
        return { outcome: "accepted" };
      },
    });
    renderConsole(client, "/console/ai/prompts?tenantId=tenant-speicher");

    await user.click(
      await screen.findByRole("button", { name: "Mark candidate" }),
    );

    expect(
      await screen.findByText("The latest complete evaluation no longer passes."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Stage deployment" })).not.toBeInTheDocument();
  });

  it("keeps Candidate deployment pending and surfaces an ETag conflict from the Tenant Draft", async () => {
    const user = userEvent.setup();
    let rejectStage: ((reason?: unknown) => void) | undefined;
    const pendingStage = new Promise<never>((_resolve, reject) => {
      rejectStage = reject;
    });
    const client = createFakeConsoleClient({
      views: {
        bootstrap: {
          ...testBootstrap,
          capabilities: {
            ...testBootstrap.capabilities,
            canManageAiOperations: true,
          },
        },
        "tenant-settings": tenantSettings,
        prompts: {
          scope: tenantScope,
          editable: true,
          prompts: [
            {
              id: "prompt-qualified-candidate",
              action: "generate",
              version: 1,
              hash: `sha256:${"d".repeat(64)}`,
              status: "candidate",
              createdAt: "2026-08-23T09:00:00.000Z",
              createdBy: "operator-1",
              evaluationScore: 1,
            },
          ],
          actions: [{ key: "generate", label: "Generate" }],
        },
      },
      onCommand: (command) =>
        command.command === "stage-configuration-changes"
          ? pendingStage
          : { outcome: "accepted" },
    });
    renderConsole(client, "/console/ai/prompts?tenantId=tenant-speicher");

    await user.click(
      await screen.findByRole("button", { name: "Stage deployment" }),
    );
    expect(
      await screen.findByRole("button", { name: "Staging deployment…" }),
    ).toBeDisabled();

    await act(async () => {
      rejectStage?.(
        new ConsoleRejectionError(
          "CONFIG_CONFLICT",
          "The Tenant Draft changed in another tab.",
        ),
      );
    });
    expect(
      await screen.findByText(/Draft changed in another tab.*Reload/iu),
    ).toBeVisible();
    expect(screen.getByText(/Candidate means.*not deployed/iu)).toBeVisible();
  });

  it.each([
    {
      code: "CONFIG_CONFLICT",
      detail: "The Draft was changed in another tab.",
      copy: /changed in another tab.*Reload/iu,
    },
    {
      code: "INVALID_VALUE",
      detail: "No executable Prompt remains.",
      copy: /invalid and was not published.*No executable Prompt remains/iu,
    },
  ])("shows $code publication failure without hiding the Draft", async ({
    code,
    detail,
    copy,
  }) => {
    const user = userEvent.setup();
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        "tenant-settings": {
          ...tenantSettings,
          configuration: {
            etag: '"tenant-configuration:7:draft:draft-a:1"',
            draft: {
              baseEtag: '"tenant-configuration:7:draft:none"',
              changes: [{ key: "locale", value: "de-DE" }],
            },
          },
        },
      },
      onCommand: () => {
        throw new ConsoleRejectionError(code, detail);
      },
    });
    renderConsole(
      client,
      "/console/settings/tenant?tenantId=tenant-speicher",
    );

    await user.click(await screen.findByRole("button", { name: "Publish draft" }));

    expect(await screen.findByText(copy)).toBeVisible();
    expect(screen.getByText("1 staged change")).toBeVisible();
  });

  it("locks both release controls while publication is pending", async () => {
    const user = userEvent.setup();
    let resolvePublication:
      | ((value: { readonly outcome: "accepted" }) => void)
      | undefined;
    const client = createFakeConsoleClient({
      views: {
        bootstrap: testBootstrap,
        "tenant-settings": {
          ...tenantSettings,
          configuration: {
            etag: '"tenant-configuration:7:draft:draft-a:1"',
            draft: {
              baseEtag: '"tenant-configuration:7:draft:none"',
              changes: [{ key: "locale", value: "de-DE" }],
            },
          },
        },
      },
      onCommand: () =>
        new Promise((resolve) => {
          resolvePublication = resolve;
        }),
    });
    renderConsole(
      client,
      "/console/settings/tenant?tenantId=tenant-speicher",
    );

    await user.click(await screen.findByRole("button", { name: "Publish draft" }));

    expect(
      await screen.findByRole("button", { name: "Publishing…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel draft" })).toBeDisabled();
    await act(async () => {
      resolvePublication?.({ outcome: "accepted" });
    });
  });
});
