import { useState } from "react";

import type { ConsoleClient } from "../console-client.js";
import { useConsoleCommand, useConsoleView } from "../console-queries.js";
import {
  DataTable,
  QueryState,
  RejectionNotice,
  ViewHeader,
  money,
} from "../console-ui.js";
import styles from "../operator-console.module.css";
import type { ConsoleScopeController } from "../use-console-scope.js";

const platformScope = { tenantId: null, locationId: null } as const;

export function PlatformTenantsView({
  client,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const tenants = useConsoleView({
    client,
    view: "platform-tenants",
    scope: platformScope,
  });
  const command = useConsoleCommand({ client, scope: platformScope });
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState({
    name: "",
    slug: "",
    locale: "en-GB" as "en-GB" | "de-DE",
    category: "",
    plan: "lite",
  });

  const rows = (tenants.data?.tenants ?? []).filter((tenant) =>
    `${tenant.name} ${tenant.slug} ${tenant.category}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );

  return (
    <>
      <ViewHeader
        eyebrow="Platform"
        title="Accounts"
        meta="Provisioning an account creates a data record, not a deployment"
      />

      <div className={styles.toolbar}>
        <label className={styles.field}>
          Search
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </div>

      <QueryState query={tenants} label="accounts" />

      {tenants.data === undefined ? null : (
        <>
          <DataTable
            caption="Accounts on this platform"
            empty={
              filter === ""
                ? "No account has been provisioned."
                : "No account matched that search."
            }
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Account", rowHeader: true, render: (row) => row.name },
              { key: "locale", header: "Locale", render: (row) => row.locale },
              { key: "category", header: "Category", render: (row) => row.category },
              {
                key: "locations",
                header: "Locations",
                render: (row) => row.locationCount,
              },
              { key: "plan", header: "Plan", render: (row) => row.plan },
              {
                key: "spend",
                header: "Month to date",
                render: (row) => money(row.monthToDateSpend),
              },
              {
                key: "budget",
                header: "Budget",
                render: (row) => money(row.monthlyBudget),
              },
              { key: "status", header: "Status", render: (row) => row.status },
            ]}
          />

          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              command.mutate({
                command: "create-tenant",
                name: draft.name,
                slug: draft.slug,
                locale: draft.locale,
                category: draft.category,
                plan: draft.plan,
              });
            }}
          >
            <h2 className={styles.sectionLabel}>Provision an account</h2>
            <div className={styles.formRow}>
              <label className={styles.field}>
                Name
                <input
                  required
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label className={styles.field}>
                Slug
                <input
                  required
                  pattern="[a-z0-9-]+"
                  value={draft.slug}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, slug: event.target.value }))
                  }
                />
              </label>
              <label className={styles.field}>
                Locale
                <select
                  value={draft.locale}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      locale: event.target.value as "en-GB" | "de-DE",
                    }))
                  }
                >
                  <option value="en-GB">en-GB</option>
                  <option value="de-DE">de-DE</option>
                </select>
              </label>
              <label className={styles.field}>
                Category
                <input
                  value={draft.category}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      category: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                Plan
                <input
                  value={draft.plan}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, plan: event.target.value }))
                  }
                />
              </label>
              <button
                className={styles.buttonPrimary}
                type="submit"
                disabled={command.isPending}
              >
                Create account
              </button>
            </div>
            <RejectionNotice error={command.error} />
          </form>
        </>
      )}
    </>
  );
}

export function PlatformProvidersView({
  client,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const providers = useConsoleView({
    client,
    view: "platform-providers",
    scope: platformScope,
  });
  const command = useConsoleCommand({ client, scope: platformScope });

  return (
    <>
      <ViewHeader
        eyebrow="Platform"
        title="Providers and routing"
        meta="The customer survey never chooses a provider; routing does"
      />
      <QueryState query={providers} label="providers" />
      <RejectionNotice error={command.error} />

      {providers.data === undefined ? null : (
        <>
          <DataTable
            caption="Model capability and routing matrix"
            empty="No model provider is registered."
            rows={providers.data.models}
            rowKey={(row) => `${row.providerKey}:${row.modelKey}`}
            columns={[
              {
                key: "provider",
                header: "Provider",
                rowHeader: true,
                render: (row) => row.providerName,
              },
              { key: "model", header: "Model", render: (row) => row.modelName },
              { key: "health", header: "Health", render: (row) => row.health },
              {
                key: "credential",
                header: "Credential",
                render: (row) => (
                  <span
                    className={
                      row.credentialState === "configured"
                        ? styles.statusPass
                        : styles.statusFail
                    }
                  >
                    {row.credentialState}
                  </span>
                ),
              },
              {
                key: "streaming",
                header: "Streaming",
                render: (row) => (row.supportsStreaming ? "yes" : "no"),
              },
              {
                key: "structured",
                header: "Structured output",
                render: (row) => (row.supportsStructuredOutput ? "yes" : "no"),
              },
              { key: "maxTokens", header: "Max tokens", render: (row) => row.maxTokens },
              {
                key: "routing",
                header: "Primary priority",
                render: (row) => row.routingPriority ?? "—",
              },
              {
                key: "fallback",
                header: "Fallback priority",
                render: (row) => row.fallbackPriority ?? "—",
              },
              {
                key: "promote",
                header: "",
                render: (row) => (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={command.isPending}
                    onClick={() =>
                      command.mutate({
                        command: "set-provider-routing",
                        providerKey: row.providerKey,
                        modelKey: row.modelKey,
                        routingPriority: row.routingPriority === 1 ? null : 1,
                        fallbackPriority: row.routingPriority === 1 ? 1 : null,
                      })
                    }
                  >
                    {row.routingPriority === 1 ? "Make fallback" : "Make primary"}
                  </button>
                ),
              },
            ]}
          />

          <h2 className={styles.sectionLabel}>Price versions</h2>
          <p className={styles.emptyCopy}>
            A price change appends a version and closes the previous one, so a
            historical Generation is always re-costed with the price that was
            active when it ran.
          </p>
          <DataTable
            caption="Versioned provider pricing"
            empty="No price version has been published."
            rows={providers.data.priceVersions}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "model",
                header: "Model",
                rowHeader: true,
                render: (row) => `${row.providerKey}/${row.modelKey}`,
              },
              {
                key: "input",
                header: "Input / M tokens",
                render: (row) => money(row.inputPerMillion),
              },
              {
                key: "output",
                header: "Output / M tokens",
                render: (row) => money(row.outputPerMillion),
              },
              { key: "from", header: "Valid from", render: (row) => row.validFrom },
              {
                key: "to",
                header: "Valid to",
                render: (row) => row.validTo ?? "current",
              },
              {
                key: "state",
                header: "State",
                render: (row) => (row.superseded ? "superseded" : "active"),
              },
            ]}
          />
        </>
      )}
    </>
  );
}

export function PlatformStylesView({
  client,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const catalogue = useConsoleView({
    client,
    view: "platform-styles",
    scope: platformScope,
  });
  const command = useConsoleCommand({ client, scope: platformScope });
  const [manifest, setManifest] = useState("");

  return (
    <>
      <ViewHeader
        eyebrow="Platform"
        title="Review format catalogue"
        meta="Manifests are validated before a format can be enabled anywhere"
      />
      <QueryState query={catalogue} label="the catalogue" />

      {catalogue.data === undefined ? null : (
        <>
          <DataTable
            caption="Platform review formats"
            empty="The catalogue is empty."
            rows={catalogue.data.styles}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", header: "Format", rowHeader: true, render: (row) => row.name },
              {
                key: "key",
                header: "Key",
                render: (row) => <span className={styles.mono}>{row.key}</span>,
              },
              { key: "version", header: "Version", render: (row) => row.version },
              { key: "locale", header: "Locale", render: (row) => row.locale },
              {
                key: "platform",
                header: "Target platform",
                render: (row) => row.targetPlatform,
              },
              { key: "maxChars", header: "Max chars", render: (row) => row.maxChars },
              {
                key: "actions",
                header: "Supported Actions",
                render: (row) => row.supportedActions.join(", "),
              },
              {
                key: "validation",
                header: "Validation",
                render: (row) => (
                  <span
                    className={
                      row.validationStatus === "valid"
                        ? styles.statusPass
                        : styles.statusFail
                    }
                  >
                    {row.validationStatus}
                  </span>
                ),
              },
            ]}
          />

          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              command.mutate({ command: "import-platform-style", manifest });
            }}
          >
            <h2 className={styles.sectionLabel}>Import a manifest</h2>
            <label className={styles.field}>
              Manifest JSON
              <textarea
                required
                value={manifest}
                onChange={(event) => setManifest(event.target.value)}
              />
            </label>
            <p className={styles.buttonRow}>
              <button
                className={styles.buttonPrimary}
                type="submit"
                disabled={command.isPending}
              >
                Validate and import
              </button>
            </p>
            <RejectionNotice error={command.error} />
          </form>
        </>
      )}
    </>
  );
}

export function PlatformSettingsView({
  client,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const settings = useConsoleView({
    client,
    view: "platform-settings",
    scope: platformScope,
  });
  const command = useConsoleCommand({ client, scope: platformScope });
  const [retention, setRetention] = useState<number | null>(null);

  return (
    <>
      <ViewHeader
        eyebrow="Platform"
        title="Platform settings"
        meta="System-wide policy; every change is audited"
      />
      <QueryState query={settings} label="platform settings" />

      {settings.data === undefined ? null : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            command.mutate({
              command: "save-platform-settings",
              defaultPolicyTemplate: settings.data.defaultPolicyTemplate,
              globalRateLimits: settings.data.globalRateLimits,
              logRetentionDays: retention ?? settings.data.logRetentionDays,
              featureFlags: settings.data.featureFlags.map((flag) => ({
                key: flag.key,
                enabled: flag.enabled,
              })),
            });
          }}
        >
          <dl className={styles.detailList}>
            <dt>Per Review Session / hour</dt>
            <dd>{settings.data.globalRateLimits.perReviewSessionPerHour}</dd>
            <dt>Per account / minute</dt>
            <dd>{settings.data.globalRateLimits.perTenantPerMinute}</dd>
            <dt>Max concurrent Generations</dt>
            <dd>{settings.data.globalRateLimits.maxConcurrentGenerations}</dd>
          </dl>

          <label className={styles.field}>
            Log retention (days)
            <input
              type="number"
              min={1}
              max={3650}
              value={retention ?? settings.data.logRetentionDays}
              onChange={(event) => setRetention(Number(event.target.value))}
            />
          </label>

          <h2 className={styles.sectionLabel}>Default policy template</h2>
          <pre className={styles.codeBlock}>
            {settings.data.defaultPolicyTemplate}
          </pre>

          <h2 className={styles.sectionLabel}>Feature flags</h2>
          <DataTable
            caption="Platform feature flags"
            empty="No feature flag is defined."
            rows={settings.data.featureFlags}
            rowKey={(row) => row.key}
            columns={[
              {
                key: "key",
                header: "Flag",
                rowHeader: true,
                render: (row) => <span className={styles.mono}>{row.key}</span>,
              },
              {
                key: "description",
                header: "Description",
                render: (row) => row.description,
              },
              {
                key: "enabled",
                header: "Enabled",
                render: (row) => (row.enabled ? "yes" : "no"),
              },
            ]}
          />

          <p className={styles.buttonRow}>
            <button
              className={styles.buttonPrimary}
              type="submit"
              disabled={command.isPending}
            >
              Save platform settings
            </button>
          </p>
          <RejectionNotice error={command.error} />
        </form>
      )}
    </>
  );
}
