import type { ConsoleStyleDetailDto } from "@review/contracts/console";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { ConsoleClient } from "../console-client.js";
import {
  ConfigurationDraftPanel,
  tenantConfigurationScope,
  useConfigurationDraftController,
} from "../configuration-draft-panel.js";
import { useConsoleCommand, useConsoleView } from "../console-queries.js";
import {
  DataTable,
  EmptyState,
  OwnerBadge,
  QueryState,
  RejectionNotice,
  ReorderControls,
  ViewHeader,
  moveItem,
} from "../console-ui.js";
import styles from "../operator-console.module.css";
import type { ConsoleScopeController } from "../use-console-scope.js";

export function ContextView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const configurationScope = tenantConfigurationScope(scopeController.scope);
  const context = useConsoleView({
    client,
    view: "context",
    scope: configurationScope,
  });

  const current = context.data?.current ?? null;

  return (
    <>
      <ViewHeader
        eyebrow="Configuration"
        title="Business context"
        meta={
          current === null
            ? "No published version yet"
            : `Version ${current.version} · published ${current.createdAt}`
        }
      />
      <QueryState query={context} label="business context" />

      {context.data === undefined ? null : (
        <>
          <p className={styles.emptyCopy}>
            Audit history only. Business Context versions are not part of the
            Effective Configuration Snapshot used by live Generation, so this
            screen does not offer a misleading publish control.
          </p>
          {current === null ? null : (
            <dl className={styles.detailList}>
              <dt>Recorded context</dt>
              <dd>{current.context || "—"}</dd>
              <dt>Recorded banned terms</dt>
              <dd>
                {current.bannedTerms.length === 0
                  ? "—"
                  : current.bannedTerms.join(", ")}
              </dd>
            </dl>
          )}

          <h2 className={styles.sectionLabel}>Published versions</h2>
          <DataTable
            caption="Published business context versions"
            empty="No business context has been published yet."
            rows={context.data.history}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "version",
                header: "Version",
                rowHeader: true,
                render: (row) => row.version,
              },
              { key: "createdAt", header: "Published", render: (row) => row.createdAt },
              {
                key: "createdBy",
                header: "By",
                render: (row) => row.createdBy ?? "—",
              },
            ]}
          />
        </>
      )}
    </>
  );
}

export function KeywordsView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const configurationScope = tenantConfigurationScope(scopeController.scope);
  const keywords = useConsoleView({
    client,
    view: "keywords",
    scope: configurationScope,
  });
  const configuration = useConsoleView({
    client,
    view: "tenant-settings",
    scope: configurationScope,
  });
  const draftController = useConfigurationDraftController({
    client,
    scope: configurationScope,
    configuration: configuration.data?.configuration,
  });
  const [draft, setDraft] = useState({
    label: "",
    categoryKey: "",
    polarity: "positive" as "positive" | "neutral" | "negative",
  });
  const [mutationId, setMutationId] = useState(() =>
    globalThis.crypto.randomUUID(),
  );

  const categories = keywords.data?.categories ?? [];
  const categoryKey = draft.categoryKey || (categories[0]?.key ?? "");
  const editable =
    keywords.data?.editable === true && configuration.data?.editable === true;

  return (
    <>
      <ViewHeader
        eyebrow="Configuration"
        title="Fact options"
        meta="Categories and options are account data, not application code"
      />
      <QueryState query={keywords} label="fact options" />
      <QueryState query={configuration} label="the Tenant configuration Draft" />

      {keywords.data === undefined ? null : (
        <>
          {editable ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                draftController.stage(
                  [
                    {
                      operation: "create-fact-option",
                      mutationId,
                      label: draft.label,
                      categoryKey,
                      polarity: draft.polarity,
                      ownerScope: "tenant",
                    },
                  ],
                  {
                    onSuccess: () => {
                      setDraft((current) => ({ ...current, label: "" }));
                      setMutationId(globalThis.crypto.randomUUID());
                    },
                  },
                );
              }}
            >
              <div className={styles.formRow}>
                <label className={styles.field}>
                  Label
                  <input
                    required
                    value={draft.label}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className={styles.field}>
                  Category
                  <select
                    value={categoryKey}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        categoryKey: event.target.value,
                      }))
                    }
                  >
                    {categories.map((category) => (
                      <option key={category.key} value={category.key}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Polarity
                  <select
                    value={draft.polarity}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        polarity: event.target
                          .value as "positive" | "neutral" | "negative",
                      }))
                    }
                  >
                    <option value="positive">positive</option>
                    <option value="neutral">neutral</option>
                    <option value="negative">negative</option>
                  </select>
                </label>
                <span className={styles.settingSource}>Owned by this Tenant</span>
                <button
                  className={styles.buttonPrimary}
                  type="submit"
                  disabled={draftController.isPending}
                >
                  Add fact option
                </button>
              </div>
            </form>
          ) : null}

          <DataTable
            caption="Fact options offered to reviewers"
            empty="No fact option is configured in this scope."
            rows={keywords.data.keywords}
            rowKey={(row) => row.id}
            columns={[
              { key: "label", header: "Label", rowHeader: true, render: (row) => row.label },
              { key: "category", header: "Category", render: (row) => row.categoryLabel },
              { key: "polarity", header: "Polarity", render: (row) => row.polarity },
              {
                key: "scope",
                header: "Owner",
                render: (row) => <OwnerBadge scope={row.ownerScope} />,
              },
              {
                key: "order",
                header: "Order",
                render: (row) =>
                  editable ? (
                    <ReorderControls
                      index={keywords.data.keywords.indexOf(row)}
                      total={keywords.data.keywords.length}
                      disabled={draftController.isPending}
                      onMove={(from, to) =>
                        draftController.stage([
                          {
                            operation: "reorder-fact-options",
                            orderedKeywordIds: moveItem(
                              keywords.data.keywords.map(
                                (keyword) => keyword.id,
                              ),
                              from,
                              to,
                            ),
                          },
                        ])
                      }
                    />
                  ) : (
                    row.sortOrder
                  ),
              },
              {
                key: "active",
                header: "Active",
                render: (row) =>
                  editable ? (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={draftController.isPending}
                      onClick={() =>
                        draftController.stage([
                          {
                            operation: "update-fact-option",
                            keywordId: row.id,
                            label: row.label,
                            polarity: row.polarity,
                            active: !row.active,
                          },
                        ])
                      }
                    >
                      {row.active ? "Deactivate" : "Activate"}
                    </button>
                  ) : row.active ? (
                    "yes"
                  ) : (
                    "no"
                  ),
              },
              {
                key: "delete",
                header: "",
                render: (row) =>
                  editable && row.deletable ? (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={draftController.isPending}
                      onClick={() =>
                        draftController.stage([
                          {
                            operation: "delete-fact-option",
                            keywordId: row.id,
                          },
                        ])
                      }
                    >
                      Delete
                    </button>
                  ) : null,
              },
            ]}
          />
          {configuration.data === undefined ? null : (
            <ConfigurationDraftPanel
              configuration={configuration.data.configuration}
              controller={draftController}
              editable={editable}
              scopeKind="tenant"
            />
          )}
        </>
      )}
    </>
  );
}

export function StylesView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const configurationScope = tenantConfigurationScope(scopeController.scope);
  const stylesView = useConsoleView({
    client,
    view: "styles",
    scope: configurationScope,
  });
  const configuration = useConsoleView({
    client,
    view: "tenant-settings",
    scope: configurationScope,
  });
  const draftController = useConfigurationDraftController({
    client,
    scope: configurationScope,
    configuration: configuration.data?.configuration,
  });
  const editable =
    stylesView.data?.editable === true && configuration.data?.editable === true;

  return (
    <>
      <ViewHeader
        eyebrow="Configuration"
        title="Review formats"
        meta={
          stylesView.data === undefined
            ? undefined
            : `Account locale ${stylesView.data.tenantLocale}`
        }
      />
      <QueryState query={stylesView} label="review formats" />
      <QueryState query={configuration} label="the Tenant configuration Draft" />

      {stylesView.data === undefined ? null : (
        <>
          <DataTable
            caption="Platform review formats available to this account"
            empty="The platform catalogue is empty."
            rows={stylesView.data.styles}
            rowKey={(row) => row.id}
            columns={[
            {
              key: "name",
              header: "Format",
              rowHeader: true,
              render: (row) => (
                <Link
                  to={scopeController.href(
                    `/console/configuration/styles/${row.id}`,
                  )}
                >
                  {row.name}
                </Link>
              ),
            },
            { key: "locale", header: "Locale", render: (row) => row.locale },
            {
              key: "platform",
              header: "Target",
              render: (row) => row.targetPlatform,
            },
            { key: "maxChars", header: "Max chars", render: (row) => row.maxChars },
            {
              key: "order",
              header: "Order",
              render: (row) =>
                editable ? (
                  <ReorderControls
                    index={stylesView.data.styles.indexOf(row)}
                    total={stylesView.data.styles.length}
                    disabled={draftController.isPending}
                    onMove={(from, to) =>
                      draftController.stage([
                        {
                          operation: "reorder-review-formats",
                          orderedStyleIds: moveItem(
                            stylesView.data.styles.map((style) => style.id),
                            from,
                            to,
                          ),
                        },
                      ])
                    }
                  />
                ) : (
                  row.sortOrder
                ),
            },
            {
              key: "actions",
              header: "Enabled Actions",
              render: (row) =>
                row.enabledActions.length === 0 ? "—" : row.enabledActions.join(", "),
            },
            {
              key: "enabled",
              header: "Enabled",
              render: (row) =>
                row.incompatibility !== null ? (
                  <span className={styles.settingSource}>
                    {row.incompatibility}
                  </span>
                ) : editable ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={draftController.isPending}
                    onClick={() =>
                      draftController.stage([
                        {
                          operation: "set-review-format-enablement",
                          styleId: row.id,
                          enabled: !row.enabled,
                          enabledActions: row.enabled
                            ? []
                            : [...row.supportedActions],
                        },
                      ])
                    }
                  >
                    {row.enabled ? "Disable" : "Enable"}
                  </button>
                ) : row.enabled ? (
                  "yes"
                ) : (
                  "no"
                ),
            },
            ]}
          />
          {configuration.data === undefined ? null : (
            <ConfigurationDraftPanel
              configuration={configuration.data.configuration}
              controller={draftController}
              editable={editable}
              scopeKind="tenant"
            />
          )}
        </>
      )}
    </>
  );
}

export function StyleDetailView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const { styleId } = useParams<{ styleId: string }>();
  const detail = useConsoleView({
    client,
    view: "style-detail",
    scope: scopeController.scope,
    params: { styleId: styleId ?? null },
    enabled: styleId !== undefined,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });
  const [validation, setValidation] = useState<
    ConsoleStyleDetailDto["validation"] | null
  >(null);

  return (
    <>
      <ViewHeader
        eyebrow="Configuration"
        title={detail.data?.style.name ?? "Review format"}
        meta={
          detail.data === undefined
            ? undefined
            : `${detail.data.style.key} · version ${detail.data.style.version}`
        }
      />
      <QueryState query={detail} label="the review format" />

      {detail.data === undefined ? null : (
        <>
          <dl className={styles.detailList}>
            <dt>Target platform</dt>
            <dd>{detail.data.style.targetPlatform}</dd>
            <dt>Locale</dt>
            <dd>{detail.data.style.locale}</dd>
            <dt>Maximum characters</dt>
            <dd>{detail.data.style.maxChars}</dd>
            <dt>Supported Actions</dt>
            <dd>{detail.data.style.supportedActions.join(", ")}</dd>
            <dt>Manifest</dt>
            <dd>
              {detail.data.manifestEditable
                ? "Editable in Platform scope"
                : "Read-only: this manifest is owned by the platform"}
            </dd>
          </dl>

          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.button}
              disabled={command.isPending}
              onClick={() => {
                command.mutate(
                  { command: "validate-style", styleId: detail.data.style.id },
                  {
                    onSuccess: (result) => {
                      const outcome = result as {
                        outcome: string;
                        validation?: ConsoleStyleDetailDto["validation"];
                      };
                      setValidation(
                        outcome.outcome === "style-validation"
                          ? (outcome.validation ?? null)
                          : null,
                      );
                    },
                  },
                );
              }}
            >
              Validate manifest
            </button>
          </div>
          <RejectionNotice error={command.error} />

          {validation === null ? null : (
            <>
              <h2 className={styles.sectionLabel}>
                Validation ·{" "}
                <span
                  className={
                    validation.status === "pass"
                      ? styles.statusPass
                      : styles.statusFail
                  }
                >
                  {validation.status}
                </span>
              </h2>
              <DataTable
                caption="Manifest rules"
                empty="No rule was evaluated."
                rows={validation.rules}
                rowKey={(row) => row.ruleKey}
                columns={[
                  {
                    key: "label",
                    header: "Rule",
                    rowHeader: true,
                    render: (row) => row.label,
                  },
                  {
                    key: "status",
                    header: "Result",
                    render: (row) => (
                      <span
                        className={
                          row.status === "pass"
                            ? styles.statusPass
                            : styles.statusFail
                        }
                      >
                        {row.status}
                      </span>
                    ),
                  },
                  {
                    key: "detail",
                    header: "Detail",
                    render: (row) => row.detail ?? "—",
                  },
                ]}
              />
            </>
          )}

          <h2 className={styles.sectionLabel}>Manifest</h2>
          <pre className={styles.codeBlock}>{detail.data.manifest}</pre>
        </>
      )}
    </>
  );
}

export function ActionsView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const configurationScope = tenantConfigurationScope(scopeController.scope);
  const actions = useConsoleView({
    client,
    view: "actions",
    scope: configurationScope,
  });
  const configuration = useConsoleView({
    client,
    view: "tenant-settings",
    scope: configurationScope,
  });
  const draftController = useConfigurationDraftController({
    client,
    scope: configurationScope,
    configuration: configuration.data?.configuration,
  });
  const editable =
    actions.data?.editable === true && configuration.data?.editable === true;

  return (
    <>
      <ViewHeader
        eyebrow="Configuration"
        title="Drafting actions"
        meta="A disabled Action disappears from every customer path"
      />
      <QueryState query={actions} label="drafting actions" />
      <QueryState query={configuration} label="the Tenant configuration Draft" />

      {actions.data === undefined ? null : actions.data.actions.length === 0 ? (
        <EmptyState>No Action is configured for this account.</EmptyState>
      ) : (
        <>
          <DataTable
            caption="Drafting Actions offered to reviewers"
            empty="No Action is configured for this account."
            rows={actions.data.actions}
            rowKey={(row) => row.key}
            columns={[
            { key: "label", header: "Action", rowHeader: true, render: (row) => row.label },
            {
              key: "inputs",
              header: "Required inputs",
              render: (row) => row.requiredInputs.join(", "),
            },
            {
              key: "grounding",
              header: "Grounding rule",
              render: (row) => row.groundingRule,
            },
            { key: "cost", header: "Relative cost", render: (row) => row.relativeCost },
            {
              key: "enabled",
              header: "Enabled",
              render: (row) =>
                editable ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={
                      draftController.isPending ||
                      (row.enabled && row.disableBlockedReason !== null)
                    }
                    title={row.disableBlockedReason ?? undefined}
                    onClick={() =>
                      draftController.stage([
                        {
                          operation: "set-action-enablement",
                          action: row.key,
                          enabled: !row.enabled,
                        },
                      ])
                    }
                  >
                    {row.enabled ? "Disable" : "Enable"}
                  </button>
                ) : row.enabled ? (
                  "yes"
                ) : (
                  "no"
                ),
            },
            ]}
          />
          {configuration.data === undefined ? null : (
            <ConfigurationDraftPanel
              configuration={configuration.data.configuration}
              controller={draftController}
              editable={editable}
              scopeKind="tenant"
            />
          )}
        </>
      )}
    </>
  );
}
