import type { ConsoleStyleDetailDto } from "@review/contracts/console";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { ConsoleClient } from "../console-client.js";
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
  const context = useConsoleView({
    client,
    view: "context",
    scope: scopeController.scope,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });
  const [draft, setDraft] = useState<{ context: string; bannedTerms: string } | null>(
    null,
  );

  const current = context.data?.current ?? null;
  useEffect(() => {
    if (current !== null && draft === null) {
      setDraft({
        context: current.context,
        bannedTerms: current.bannedTerms.join(", "),
      });
    }
  }, [current, draft]);

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
            Saving publishes a new immutable version. Existing Generations keep
            resolving the version they were grounded on.
          </p>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              command.mutate({
                command: "publish-context-version",
                context: draft?.context ?? "",
                bannedTerms: (draft?.bannedTerms ?? "")
                  .split(",")
                  .map((term) => term.trim())
                  .filter((term) => term.length > 0),
              });
            }}
          >
            <label className={styles.field}>
              Business context
              <textarea
                value={draft?.context ?? ""}
                disabled={!context.data.editable}
                onChange={(event) =>
                  setDraft((state) => ({
                    context: event.target.value,
                    bannedTerms: state?.bannedTerms ?? "",
                  }))
                }
              />
            </label>
            <label className={styles.field}>
              Banned terms (comma separated)
              <input
                value={draft?.bannedTerms ?? ""}
                disabled={!context.data.editable}
                onChange={(event) =>
                  setDraft((state) => ({
                    context: state?.context ?? "",
                    bannedTerms: event.target.value,
                  }))
                }
              />
            </label>
            {context.data.editable ? (
              <p className={styles.buttonRow}>
                <button
                  className={styles.buttonPrimary}
                  type="submit"
                  disabled={command.isPending}
                >
                  Publish new version
                </button>
              </p>
            ) : null}
            <RejectionNotice error={command.error} />
          </form>

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
  const keywords = useConsoleView({
    client,
    view: "keywords",
    scope: scopeController.scope,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });
  const [draft, setDraft] = useState({
    label: "",
    categoryKey: "",
    polarity: "positive" as "positive" | "neutral" | "negative",
    ownerScope: "tenant" as "tenant" | "location",
  });

  const categories = keywords.data?.categories ?? [];
  const categoryKey = draft.categoryKey || (categories[0]?.key ?? "");

  return (
    <>
      <ViewHeader
        eyebrow="Configuration"
        title="Fact options"
        meta="Categories and options are account data, not application code"
      />
      <QueryState query={keywords} label="fact options" />

      {keywords.data === undefined ? null : (
        <>
          {keywords.data.editable ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                command.mutate({
                  command: "create-keyword",
                  label: draft.label,
                  categoryKey,
                  polarity: draft.polarity,
                  ownerScope: draft.ownerScope,
                });
                setDraft((current) => ({ ...current, label: "" }));
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
                <label className={styles.field}>
                  Owned by
                  <select
                    value={draft.ownerScope}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        ownerScope: event.target.value as "tenant" | "location",
                      }))
                    }
                  >
                    <option value="tenant">Account</option>
                    <option
                      value="location"
                      disabled={scopeController.scope.locationId === null}
                    >
                      This Location
                    </option>
                  </select>
                </label>
                <button
                  className={styles.buttonPrimary}
                  type="submit"
                  disabled={command.isPending}
                >
                  Add fact option
                </button>
              </div>
              <RejectionNotice error={command.error} />
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
                  keywords.data.editable ? (
                    <ReorderControls
                      index={keywords.data.keywords.indexOf(row)}
                      total={keywords.data.keywords.length}
                      disabled={command.isPending}
                      onMove={(from, to) =>
                        command.mutate({
                          command: "reorder-keywords",
                          orderedKeywordIds: moveItem(
                            keywords.data.keywords.map(
                              (keyword) => keyword.id,
                            ),
                            from,
                            to,
                          ),
                        })
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
                  keywords.data.editable ? (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={command.isPending}
                      onClick={() =>
                        command.mutate({
                          command: "update-keyword",
                          keywordId: row.id,
                          label: row.label,
                          polarity: row.polarity,
                          active: !row.active,
                        })
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
                  keywords.data.editable && row.deletable ? (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={command.isPending}
                      onClick={() =>
                        command.mutate({
                          command: "delete-keyword",
                          keywordId: row.id,
                        })
                      }
                    >
                      Delete
                    </button>
                  ) : null,
              },
            ]}
          />
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
  const stylesView = useConsoleView({
    client,
    view: "styles",
    scope: scopeController.scope,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });

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
      <RejectionNotice error={command.error} />

      {stylesView.data === undefined ? null : (
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
                stylesView.data.editable ? (
                  <ReorderControls
                    index={stylesView.data.styles.indexOf(row)}
                    total={stylesView.data.styles.length}
                    disabled={command.isPending}
                    onMove={(from, to) =>
                      command.mutate({
                        command: "reorder-styles",
                        orderedStyleIds: moveItem(
                          stylesView.data.styles.map((style) => style.id),
                          from,
                          to,
                        ),
                      })
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
                ) : stylesView.data.editable ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={command.isPending}
                    onClick={() =>
                      command.mutate({
                        command: "set-style-enablement",
                        styleId: row.id,
                        enabled: !row.enabled,
                        enabledActions: row.enabled
                          ? []
                          : [...row.supportedActions],
                      })
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
  const actions = useConsoleView({
    client,
    view: "actions",
    scope: scopeController.scope,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });

  return (
    <>
      <ViewHeader
        eyebrow="Configuration"
        title="Drafting actions"
        meta="A disabled Action disappears from every customer path"
      />
      <QueryState query={actions} label="drafting actions" />
      <RejectionNotice error={command.error} />

      {actions.data === undefined ? null : actions.data.actions.length === 0 ? (
        <EmptyState>No Action is configured for this account.</EmptyState>
      ) : (
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
                actions.data.editable ? (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={
                      command.isPending ||
                      (row.enabled && row.disableBlockedReason !== null)
                    }
                    title={row.disableBlockedReason ?? undefined}
                    onClick={() =>
                      command.mutate({
                        command: "set-action-enablement",
                        action: row.key,
                        enabled: !row.enabled,
                      })
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
      )}
    </>
  );
}
