import type { ConsoleBootstrapDto } from "@review/contracts/console";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";

import {
  ConsoleAccessError,
  type ConsoleClient,
} from "./console-client.js";
import { useConsoleView } from "./console-queries.js";
import { EmptyState, ViewHeader } from "./console-ui.js";
import styles from "./operator-console.module.css";
import { useConsoleScope, type ConsoleScopeController } from "./use-console-scope.js";
import { OverviewView } from "./views/overview.js";
import {
  DistributionView,
  LocationSettingsView,
  LocationsView,
  TenantSettingsView,
} from "./views/locations.js";
import {
  ActionsView,
  ContextView,
  KeywordsView,
  StyleDetailView,
  StylesView,
} from "./views/configuration.js";
import { BenchView, ExperimentsView, PromptsView } from "./views/ai.js";
import { AnalyticsView, GenerationDetailView } from "./views/analytics.js";
import {
  PlatformProvidersView,
  PlatformSettingsView,
  PlatformStylesView,
  PlatformTenantsView,
} from "./views/platform.js";

function ConsoleUnavailable({ error }: { readonly error: Error }): React.JSX.Element {
  const code = error instanceof ConsoleAccessError ? error.code : "unavailable";
  return (
    <main className={styles.accessPage}>
      <p className={styles.eyebrow}>Operator Console</p>
      <h1 className={styles.title}>
        {code === "unauthenticated" ? "Sign in to Console" : "Console access unavailable"}
      </h1>
      <p className={styles.accessCopy} role={code === "forbidden" ? "alert" : undefined}>
        {code === "unauthenticated"
          ? "Use your authorized operator account. Your Tenant scope is resolved after sign-in."
          : code === "forbidden"
            ? "Your identity has no current Console Access Grant."
            : "The authorized Console projection could not be loaded."}
      </p>
      {code === "unauthenticated" ? (
        <a className={styles.primaryAction} href="/auth/login?returnTo=%2Fconsole">
          Sign in
        </a>
      ) : null}
    </main>
  );
}

interface NavigationItem {
  readonly to: string;
  readonly label: string;
  readonly end?: boolean | undefined;
}

interface NavigationSection {
  readonly heading: string;
  readonly items: readonly NavigationItem[];
}

/**
 * ADM-AUTH-03. Navigation is assembled from server-resolved capabilities, so a
 * Tenant operator is never offered a Platform screen. Hiding is presentation
 * only — the same capability is enforced again on every request.
 */
function navigationSections(
  capabilities: ConsoleBootstrapDto["capabilities"],
): readonly NavigationSection[] {
  const sections: NavigationSection[] = [
    {
      heading: "Operate",
      items: [
        { to: "/console", label: "Overview", end: true },
        ...(capabilities.canManageLocations
          ? [
              { to: "/console/locations", label: "Locations" },
              { to: "/console/settings/tenant", label: "Account settings" },
            ]
          : []),
      ],
    },
  ];

  if (capabilities.canManageConfiguration) {
    sections.push({
      heading: "Configure",
      items: [
        { to: "/console/configuration/context", label: "Business context" },
        { to: "/console/configuration/keywords", label: "Fact options" },
        { to: "/console/configuration/styles", label: "Review formats" },
        { to: "/console/configuration/actions", label: "Drafting actions" },
      ],
    });
  }

  if (capabilities.canViewAnalytics) {
    sections.push({
      heading: "Analyse",
      items: [{ to: "/console/analytics", label: "Analytics" }],
    });
  }

  if (capabilities.canManageAiOperations) {
    sections.push({
      heading: "AI operations",
      items: [
        { to: "/console/ai/prompts", label: "Prompt versions" },
        { to: "/console/ai/experiments", label: "Experiments" },
        { to: "/console/ai/bench", label: "Bench" },
      ],
    });
  }

  if (capabilities.canAccessPlatform) {
    sections.push({
      heading: "Platform",
      items: [
        { to: "/console/platform/tenants", label: "Accounts" },
        { to: "/console/platform/providers", label: "Providers" },
        { to: "/console/platform/styles", label: "Format catalogue" },
        { to: "/console/platform/settings", label: "Platform settings" },
      ],
    });
  }

  return sections;
}

function ScopeBar({
  bootstrap,
  scopeController,
  operatorEmail,
  onSignOut,
}: {
  readonly bootstrap: ConsoleBootstrapDto;
  readonly scopeController: ConsoleScopeController;
  readonly operatorEmail: string;
  readonly onSignOut: () => void;
}): React.JSX.Element {
  const { capabilities } = bootstrap;
  return (
    <header className={styles.scopeBar}>
      <span className={styles.brand}>Review assistant</span>
      <span className={styles.scopeBadge}>
        {scopeController.scope.tenantId === null
          ? "Platform"
          : scopeController.scope.locationId === null
            ? "Tenant"
            : "Location"}
      </span>

      {capabilities.canSwitchTenant || bootstrap.tenants.length > 1 ? (
        <label className={styles.scopeControl}>
          Account
          <select
            value={scopeController.scope.tenantId ?? ""}
            onChange={(event) =>
              scopeController.selectTenant(
                event.target.value === "" ? null : event.target.value,
              )
            }
          >
            {capabilities.canAccessPlatform ? (
              <option value="">Platform</option>
            ) : null}
            {bootstrap.tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className={styles.scopeValue}>
          {scopeController.tenant?.name ?? "No account"}
        </span>
      )}

      {scopeController.locations.length > 0 ? (
        <label className={styles.scopeControl}>
          Location
          <select
            value={scopeController.scope.locationId ?? ""}
            onChange={(event) =>
              scopeController.selectLocation(
                event.target.value === "" ? null : event.target.value,
              )
            }
          >
            <option value="">All locations</option>
            {scopeController.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <span className={styles.operator}>{operatorEmail}</span>
      <button className={styles.logout} type="button" onClick={onSignOut}>
        Sign out
      </button>
    </header>
  );
}

function ConsoleWorkspace({
  client,
  bootstrap,
  operatorEmail,
  onSignOut,
  signOutFailed,
}: {
  readonly client: ConsoleClient;
  readonly bootstrap: ConsoleBootstrapDto;
  readonly operatorEmail: string;
  readonly onSignOut: () => void;
  readonly signOutFailed: boolean;
}): React.JSX.Element {
  const scopeController = useConsoleScope(bootstrap);
  const sections = navigationSections(bootstrap.capabilities);
  const viewProps = { client, scopeController };

  return (
    <div className={styles.page}>
      <ScopeBar
        bootstrap={bootstrap}
        scopeController={scopeController}
        operatorEmail={operatorEmail}
        onSignOut={onSignOut}
      />
      {signOutFailed ? (
        <p className={styles.banner} role="alert">
          Sign out failed. Try again.
        </p>
      ) : null}
      <div className={styles.layout}>
        <nav className={styles.navigation} aria-label="Console">
          <p className={styles.navigationHeading}>Authorized workspace</p>
          <p className={styles.navigationMeta}>Resolved from current Grants</p>
          {sections.map((section) => (
            <section className={styles.navigationSection} key={section.heading}>
              <h2 className={styles.navigationLabel}>{section.heading}</h2>
              <ul className={styles.navigationList}>
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      className={styles.navigationLink}
                      to={scopeController.href(item.to)}
                      end={item.end ?? false}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <main className={styles.main}>
          <Routes>
            <Route index element={<OverviewView {...viewProps} />} />
            <Route path="locations" element={<LocationsView {...viewProps} />} />
            <Route
              path="locations/:locationId/settings"
              element={<LocationSettingsView {...viewProps} />}
            />
            <Route
              path="locations/:locationId/distribution"
              element={<DistributionView {...viewProps} />}
            />
            <Route
              path="settings/tenant"
              element={<TenantSettingsView {...viewProps} />}
            />
            <Route
              path="configuration/context"
              element={<ContextView {...viewProps} />}
            />
            <Route
              path="configuration/keywords"
              element={<KeywordsView {...viewProps} />}
            />
            <Route
              path="configuration/styles"
              element={<StylesView {...viewProps} />}
            />
            <Route
              path="configuration/styles/:styleId"
              element={<StyleDetailView {...viewProps} />}
            />
            <Route
              path="configuration/actions"
              element={<ActionsView {...viewProps} />}
            />
            <Route path="analytics" element={<AnalyticsView {...viewProps} />} />
            <Route
              path="generations/:generationId"
              element={<GenerationDetailView {...viewProps} />}
            />
            <Route path="ai/prompts" element={<PromptsView {...viewProps} />} />
            <Route
              path="ai/experiments"
              element={<ExperimentsView {...viewProps} />}
            />
            <Route path="ai/bench" element={<BenchView {...viewProps} />} />
            <Route
              path="platform/tenants"
              element={<PlatformTenantsView {...viewProps} />}
            />
            <Route
              path="platform/providers"
              element={<PlatformProvidersView {...viewProps} />}
            />
            <Route
              path="platform/styles"
              element={<PlatformStylesView {...viewProps} />}
            />
            <Route
              path="platform/settings"
              element={<PlatformSettingsView {...viewProps} />}
            />
            <Route
              path="*"
              element={
                <>
                  <ViewHeader eyebrow="Console" title="Screen unavailable" />
                  <EmptyState>
                    That Console screen does not exist for this scope.
                  </EmptyState>
                </>
              }
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function OperatorConsole({
  client,
}: {
  readonly client: ConsoleClient;
}): React.JSX.Element {
  const session = useQuery({
    queryKey: ["operator-console-session"],
    queryFn: ({ signal }) => client.readSession(signal),
  });
  const bootstrap = useConsoleView({
    client,
    view: "bootstrap",
    scope: { tenantId: null, locationId: null },
    enabled: session.isSuccess,
  });
  const [signOutFailed, setSignOutFailed] = useState(false);

  if (session.isPending) {
    return (
      <main className={styles.accessPage} aria-busy="true">
        <h1 className={styles.title}>Operator Console</h1>
        <p role="status">Loading authorized scope…</p>
      </main>
    );
  }
  if (session.isError) {
    return <ConsoleUnavailable error={session.error} />;
  }
  if (bootstrap.isError) {
    return <ConsoleUnavailable error={bootstrap.error} />;
  }
  if (bootstrap.data === undefined) {
    return (
      <main className={styles.accessPage} aria-busy="true">
        <h1 className={styles.title}>Operator Console</h1>
        <p role="status">Loading authorized scope…</p>
      </main>
    );
  }

  return (
    <ConsoleWorkspace
      client={client}
      bootstrap={bootstrap.data}
      operatorEmail={session.data.operator.email}
      signOutFailed={signOutFailed}
      onSignOut={() => {
        setSignOutFailed(false);
        void client.logout().then(
          () => globalThis.location.assign("/console"),
          () => setSignOutFailed(true),
        );
      }}
    />
  );
}
