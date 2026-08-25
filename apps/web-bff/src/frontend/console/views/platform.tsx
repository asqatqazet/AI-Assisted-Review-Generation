import { useState } from "react";
import type { ConsolePlatformConfigurationStateDto } from "@review/contracts/console";

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

function PlatformDraftActions({
  configuration,
  pending,
  onCancel,
  onPublish,
}: {
  readonly configuration: ConsolePlatformConfigurationStateDto;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onPublish: () => void;
}): React.JSX.Element {
  return (
    <section aria-label="Platform Configuration Draft" className={styles.form}>
      <h2 className={styles.sectionLabel}>Platform Configuration Draft</h2>
      <p className={styles.emptyCopy}>
        {configuration.draft === null
          ? "No Platform changes are staged."
          : `${configuration.draft.changes.length} change(s) staged. Publication updates every Location snapshot atomically.`}
      </p>
      {configuration.draft === null ? null : (
        <p className={styles.buttonRow}>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={pending}
            onClick={onPublish}
          >
            Publish Platform Draft
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={pending}
            onClick={onCancel}
          >
            Cancel Platform Draft
          </button>
        </p>
      )}
    </section>
  );
}

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
  // Deactivation is irreversible from here, so it is confirmed rather than
  // performed on a single click in a table row.
  const [closing, setClosing] = useState<string | null>(null);
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
              {
                key: "lifecycle",
                header: "",
                render: (row) => (
                  <span className={styles.buttonRow}>
                    {row.status === "active" ? (
                      <button
                        type="button"
                        className={styles.button}
                        disabled={command.isPending}
                        onClick={() =>
                          command.mutate({
                            command: "set-tenant-status",
                            tenantId: row.id,
                            status: "suspended",
                          })
                        }
                      >
                        Suspend
                      </button>
                    ) : row.suspendable ? (
                      <button
                        type="button"
                        className={styles.button}
                        disabled={command.isPending}
                        onClick={() =>
                          command.mutate({
                            command: "set-tenant-status",
                            tenantId: row.id,
                            status: "active",
                          })
                        }
                      >
                        Reactivate
                      </button>
                    ) : null}
                    {row.suspendable ? (
                      <button
                        type="button"
                        className={styles.button}
                        disabled={command.isPending}
                        onClick={() => setClosing(row.id)}
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />

          {closing === null ? null : (
            <p className={styles.alertCritical} role="alert">
              Deactivating closes the account permanently: reviewer entry stops
              at every venue and it cannot be reactivated here. Its Generations
              and Drafts are retained so past reviews stay reconstructable.
              <span className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.buttonPrimary}
                  disabled={command.isPending}
                  onClick={() => {
                    command.mutate({
                      command: "set-tenant-status",
                      tenantId: closing,
                      status: "deactivated",
                    });
                    setClosing(null);
                  }}
                >
                  Deactivate this account
                </button>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => setClosing(null)}
                >
                  Keep it open
                </button>
              </span>
            </p>
          )}

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
  const command = useConsoleCommand({
    client,
    scope: platformScope,
    ifMatch: providers.data?.configuration.etag,
  });
  const [price, setPrice] = useState({
    model: "",
    inputPerMillion: "2.50",
    outputPerMillion: "5.00",
    currency: "EUR",
    validFrom: "",
  });
  const models = providers.data?.models ?? [];
  const selectedModel =
    price.model ||
    (models[0] === undefined
      ? ""
      : `${models[0].providerKey}:${models[0].modelKey}`);

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
                    disabled={command.isPending || row.routingPriority === 1}
                    onClick={() =>
                      command.mutate({
                        command: "stage-platform-configuration-changes",
                        changes: [
                          {
                            operation: "set-provider-routing",
                            providerKey: row.providerKey,
                            modelKey: row.modelKey,
                            routingPriority: 1,
                            fallbackPriority: null,
                          },
                        ],
                      })
                    }
                  >
                    {row.routingPriority === 1
                      ? "Current primary"
                      : "Stage as primary"}
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

          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              const [providerKey = "", modelKey = ""] = selectedModel.split(":");
              command.mutate({
                command: "stage-platform-configuration-changes",
                changes: [
                  {
                    operation: "publish-price-rate",
                    providerKey,
                    modelKey,
                    inputMicrosPerMillion: Math.round(
                      Number(price.inputPerMillion) * 1_000_000,
                    ),
                    outputMicrosPerMillion: Math.round(
                      Number(price.outputPerMillion) * 1_000_000,
                    ),
                    currency: price.currency,
                    validFrom: new Date(
                      `${price.validFrom}T00:00:00.000Z`,
                    ).toISOString(),
                  },
                ],
              });
            }}
          >
            <h2 className={styles.sectionLabel}>Stage a price version</h2>
            <p className={styles.emptyCopy}>
              The current version is closed at this start date and kept, so a
              Generation from before it still costs at the old price.
            </p>
            <div className={styles.formRow}>
              <label className={styles.field}>
                Model
                <select
                  value={selectedModel}
                  onChange={(event) =>
                    setPrice((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                >
                  {models.map((model) => (
                    <option
                      key={`${model.providerKey}:${model.modelKey}`}
                      value={`${model.providerKey}:${model.modelKey}`}
                    >
                      {model.providerName} · {model.modelName}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Input per million tokens
                <input
                  required
                  inputMode="decimal"
                  value={price.inputPerMillion}
                  onChange={(event) =>
                    setPrice((current) => ({
                      ...current,
                      inputPerMillion: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                Output per million tokens
                <input
                  required
                  inputMode="decimal"
                  value={price.outputPerMillion}
                  onChange={(event) =>
                    setPrice((current) => ({
                      ...current,
                      outputPerMillion: event.target.value,
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                Currency
                <input
                  required
                  maxLength={3}
                  value={price.currency}
                  onChange={(event) =>
                    setPrice((current) => ({
                      ...current,
                      currency: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                Valid from
                <input
                  required
                  type="date"
                  min={new Date(Date.now() + 86_400_000)
                    .toISOString()
                    .slice(0, 10)}
                  value={price.validFrom}
                  onChange={(event) =>
                    setPrice((current) => ({
                      ...current,
                      validFrom: event.target.value,
                    }))
                  }
                />
              </label>
              <button
                className={styles.buttonPrimary}
                type="submit"
                disabled={command.isPending || models.length === 0}
              >
                Stage price version
              </button>
            </div>
          </form>
          <PlatformDraftActions
            configuration={providers.data.configuration}
            pending={command.isPending}
            onPublish={() =>
              command.mutate({ command: "publish-platform-configuration" })
            }
            onCancel={() =>
              command.mutate({
                command: "cancel-platform-configuration-draft",
              })
            }
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
  const command = useConsoleCommand({
    client,
    scope: platformScope,
    ifMatch: settings.data?.configuration.etag,
  });
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
              command: "stage-platform-configuration-changes",
              changes: [
                {
                  operation: "save-platform-settings",
                  defaultPolicyTemplate: settings.data.defaultPolicyTemplate,
                  globalRateLimits: settings.data.globalRateLimits,
                  logRetentionDays: retention ?? settings.data.logRetentionDays,
                  featureFlags: settings.data.featureFlags.map((flag) => ({
                    key: flag.key,
                    enabled: flag.enabled,
                  })),
                },
              ],
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
              Stage platform settings
            </button>
          </p>
          <RejectionNotice error={command.error} />
          <PlatformDraftActions
            configuration={settings.data.configuration}
            pending={command.isPending}
            onPublish={() =>
              command.mutate({ command: "publish-platform-configuration" })
            }
            onCancel={() =>
              command.mutate({
                command: "cancel-platform-configuration-draft",
              })
            }
          />
        </form>
      )}
    </>
  );
}
