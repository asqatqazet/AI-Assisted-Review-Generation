import type {
  ConsoleActionKeyDto,
  ConsoleBenchResultDto,
} from "@review/contracts/console";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { ConsoleClient } from "../console-client.js";
import { useConsoleCommand, useConsoleView } from "../console-queries.js";
import {
  DataTable,
  EmptyState,
  QueryState,
  RejectionNotice,
  ViewHeader,
  money,
  percent,
} from "../console-ui.js";
import styles from "../operator-console.module.css";
import type { ConsoleScopeController } from "../use-console-scope.js";

export function PromptsView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const actionFilter = searchParams.get("action");
  const prompts = useConsoleView({
    client,
    view: "prompts",
    scope: scopeController.scope,
    params: { action: actionFilter },
  });
  const [selection, setSelection] = useState<readonly string[]>([]);
  const comparison = useConsoleView({
    client,
    view: "prompt-comparison",
    scope: scopeController.scope,
    params: {
      left: selection[0] ?? null,
      right: selection[1] ?? null,
    },
    enabled: selection.length === 2,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });
  const [draft, setDraft] = useState({ action: "", body: "" });

  // The filter narrows the table; publishing chooses its own Action so a
  // prompt for any Action can be written while looking at all of them.
  const publishAction =
    draft.action ||
    actionFilter ||
    prompts.data?.actions[0]?.key ||
    "generate";

  const toggle = (id: string): void => {
    setSelection((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id].slice(-2),
    );
  };

  return (
    <>
      <ViewHeader
        eyebrow="AI operations"
        title="Prompt versions"
        meta="Every version is immutable; editing publishes a new one"
      />

      <div className={styles.toolbar}>
        <label className={styles.field}>
          Filter by Action
          <select
            value={actionFilter ?? ""}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              if (event.target.value === "") {
                next.delete("action");
              } else {
                next.set("action", event.target.value);
              }
              setSearchParams(next);
              setSelection([]);
            }}
          >
            <option value="">All Actions</option>
            {(prompts.data?.actions ?? []).map((action) => (
              <option key={action.key} value={action.key}>
                {action.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.button}
          disabled={selection.length !== 2}
          onClick={() => setSelection((current) => [...current])}
        >
          Compare selected ({selection.length}/2)
        </button>
      </div>

      <QueryState query={prompts} label="prompt versions" />

      {prompts.data === undefined ? null : (
        <>
          <DataTable
            caption="Prompt versions"
            empty="No prompt version exists for this Action yet."
            rows={prompts.data.prompts}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "select",
                header: "Compare",
                render: (row) => (
                  <input
                    type="checkbox"
                    aria-label={`Select prompt version ${row.version} for comparison`}
                    checked={selection.includes(row.id)}
                    onChange={() => toggle(row.id)}
                  />
                ),
              },
              { key: "action", header: "Action", rowHeader: true, render: (row) => row.action },
              { key: "version", header: "Version", render: (row) => row.version },
              {
                key: "hash",
                header: "Hash",
                render: (row) => <span className={styles.mono}>{row.hash}</span>,
              },
              { key: "status", header: "Status", render: (row) => row.status },
              { key: "createdAt", header: "Created", render: (row) => row.createdAt },
              {
                key: "score",
                header: "Evaluation",
                render: (row) =>
                  row.evaluationScore === null ? "—" : percent(row.evaluationScore),
              },
            ]}
          />

          {selection.length === 2 ? (
            <>
              <h2 className={styles.sectionLabel}>Comparison</h2>
              <QueryState query={comparison} label="the comparison" />
              {comparison.data === undefined ? null : (
                <div className={styles.diffGrid}>
                  {[comparison.data.left, comparison.data.right].map((side) => (
                    <section key={side.id}>
                      <h3 className={styles.sectionLabel}>
                        Version {side.version}
                      </h3>
                      <p className={styles.mono}>{side.hash}</p>
                      <pre className={styles.codeBlock}>{side.body}</pre>
                    </section>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {prompts.data.editable ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                command.mutate({
                  command: "create-prompt-version",
                  action: publishAction as ConsoleActionKeyDto,
                  body: draft.body,
                  variables: [],
                });
                setDraft((current) => ({ ...current, body: "" }));
              }}
            >
              <h2 className={styles.sectionLabel}>Publish a new version</h2>
              <label className={styles.field}>
                Action
                <select
                  value={publishAction}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      action: event.target.value,
                    }))
                  }
                >
                  {prompts.data.actions.map((action) => (
                    <option key={action.key} value={action.key}>
                      {action.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Prompt body
                <textarea
                  required
                  value={draft.body}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      body: event.target.value,
                    }))
                  }
                />
              </label>
              <p className={styles.buttonRow}>
                <button
                  className={styles.buttonPrimary}
                  type="submit"
                  disabled={command.isPending}
                >
                  Publish draft version
                </button>
              </p>
              <RejectionNotice error={command.error} />
            </form>
          ) : null}
        </>
      )}
    </>
  );
}

export function ExperimentsView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const experiments = useConsoleView({
    client,
    view: "experiments",
    scope: scopeController.scope,
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });
  const [draft, setDraft] = useState({
    action: "generate" as ConsoleActionKeyDto,
    left: "",
    right: "",
    weight: 50,
  });

  const available = experiments.data?.availablePrompts ?? [];
  const left = draft.left || (available[0]?.id ?? "");
  const right = draft.right || (available[1]?.id ?? "");

  return (
    <>
      <ViewHeader
        eyebrow="AI operations"
        title="Experiments"
        meta="A running experiment can only be stopped"
      />
      <QueryState query={experiments} label="experiments" />

      {experiments.data === undefined ? null : (
        <>
          {experiments.data.experiments.length === 0 ? (
            <EmptyState>No experiment has been created for this account.</EmptyState>
          ) : (
            experiments.data.experiments.map((experiment) => (
              <section key={experiment.id}>
                <h2 className={styles.sectionLabel}>
                  {experiment.action} · {experiment.status}
                </h2>
                <DataTable
                  caption={`Variants of experiment ${experiment.id}`}
                  empty="This experiment has no variant."
                  rows={experiment.variants}
                  rowKey={(row) => row.promptVersionId}
                  columns={[
                    {
                      key: "prompt",
                      header: "Prompt version",
                      rowHeader: true,
                      render: (row) => (
                        <span className={styles.mono}>{row.promptVersionHash}</span>
                      ),
                    },
                    { key: "weight", header: "Weight", render: (row) => `${row.weightPct}%` },
                    {
                      key: "generations",
                      header: "Generations",
                      render: (row) =>
                        experiment.metricsAvailable ? row.generations : "—",
                    },
                    {
                      key: "acceptance",
                      header: "Accepted",
                      render: (row) =>
                        experiment.metricsAvailable
                          ? percent(row.acceptanceRate)
                          : "—",
                    },
                  ]}
                />
                {experiment.metricsAvailable ? null : (
                  <p className={styles.settingSource}>
                    Outcome counts are not available in this scope, so none are
                    shown.
                  </p>
                )}
                <p className={styles.buttonRow}>
                  {experiment.stoppable ? (
                    <button
                      type="button"
                      className={styles.button}
                      disabled={command.isPending}
                      onClick={() =>
                        command.mutate({
                          command: "stop-experiment",
                          experimentId: experiment.id,
                        })
                      }
                    >
                      Stop experiment
                    </button>
                  ) : null}
                  {experiment.editable ? (
                    <button
                      type="button"
                      className={styles.buttonPrimary}
                      disabled={command.isPending}
                      onClick={() =>
                        command.mutate({
                          command: "start-experiment",
                          experimentId: experiment.id,
                        })
                      }
                    >
                      Start experiment
                    </button>
                  ) : null}
                  {experiment.status === "running" ? (
                    <span className={styles.settingSource}>
                      Variants, weights and the tested Action are frozen while
                      the experiment runs. Stop it and create a new one to change
                      them.
                    </span>
                  ) : null}
                </p>
              </section>
            ))
          )}

          {experiments.data.editable ? (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                command.mutate({
                  command: "create-experiment",
                  action: draft.action,
                  variants: [
                    { promptVersionId: left, weightPct: draft.weight },
                    { promptVersionId: right, weightPct: 100 - draft.weight },
                  ],
                });
              }}
            >
              <h2 className={styles.sectionLabel}>New experiment</h2>
              <div className={styles.formRow}>
                <label className={styles.field}>
                  Action
                  <select
                    value={draft.action}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        action: event.target.value as ConsoleActionKeyDto,
                      }))
                    }
                  >
                    {["generate", "paraphrase", "condense", "expand"].map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Variant A
                  <select
                    value={left}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        left: event.target.value,
                      }))
                    }
                  >
                    {available.map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        v{prompt.version} · {prompt.hash}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Variant B
                  <select
                    value={right}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        right: event.target.value,
                      }))
                    }
                  >
                    {available.map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        v{prompt.version} · {prompt.hash}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  Weight A ({draft.weight}% / {100 - draft.weight}%)
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.weight}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        weight: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <button
                  className={styles.buttonPrimary}
                  type="submit"
                  disabled={command.isPending || available.length < 2}
                >
                  Create draft experiment
                </button>
              </div>
              <RejectionNotice error={command.error} />
            </form>
          ) : null}
        </>
      )}
    </>
  );
}

export function BenchView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const replayGenerationId = searchParams.get("replayGenerationId");
  const form = useConsoleView({
    client,
    view: "bench-form",
    scope: scopeController.scope,
    params: { replayGenerationId },
  });
  const command = useConsoleCommand({ client, scope: scopeController.scope });
  const [result, setResult] = useState<ConsoleBenchResultDto | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const prefill = form.data?.prefill ?? null;
  const action = (overrides["action"] ??
    prefill?.action ??
    form.data?.actions[0]?.key ??
    "generate") as ConsoleActionKeyDto;
  const styleId =
    overrides["styleId"] ?? prefill?.styleId ?? form.data?.styles[0]?.id ?? "";
  const promptVersionId =
    overrides["promptVersionId"] ??
    prefill?.promptVersionId ??
    form.data?.promptVersions[0]?.id ??
    "";
  const provider =
    overrides["provider"] ??
    prefill?.provider ??
    form.data?.providers.find((candidate) => candidate.isTestProvider)?.key ??
    form.data?.providers[0]?.key ??
    "";
  const freeText = overrides["freeText"] ?? prefill?.freeText ?? "";
  const sourceText = overrides["sourceText"] ?? prefill?.sourceText ?? "";
  const requiredInputs =
    form.data?.actions.find((candidate) => candidate.key === action)
      ?.requiredInputs ?? [];

  return (
    <>
      <ViewHeader
        eyebrow="AI operations"
        title="Generation bench"
        meta="Bench runs never enter production analytics, experiments or billing"
      />
      <QueryState query={form} label="the bench" />

      {form.data === undefined ? null : (
        <>
          {form.data.missingReplayDependencies.length > 0 ? (
            <p role="alert" className={styles.alertCritical}>
              This Generation cannot be replayed exactly. Missing:{" "}
              {form.data.missingReplayDependencies.join(", ")}. Nothing was
              substituted.
            </p>
          ) : null}

          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              command.mutate(
                {
                  command: "run-bench",
                  input: {
                    action,
                    styleId,
                    promptVersionId,
                    provider,
                    keywordIds: [],
                    freeText,
                    sourceText,
                  },
                },
                {
                  onSuccess: (outcome) => {
                    const value = outcome as {
                      outcome: string;
                      result?: ConsoleBenchResultDto;
                    };
                    setResult(
                      value.outcome === "bench-result"
                        ? (value.result ?? null)
                        : null,
                    );
                  },
                },
              );
            }}
          >
            <div className={styles.formRow}>
              <label className={styles.field}>
                Action
                <select
                  value={action}
                  onChange={(event) =>
                    setOverrides((current) => ({
                      ...current,
                      action: event.target.value,
                    }))
                  }
                >
                  {form.data.actions.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Review format
                <select
                  value={styleId}
                  onChange={(event) =>
                    setOverrides((current) => ({
                      ...current,
                      styleId: event.target.value,
                    }))
                  }
                >
                  {form.data.styles
                    .filter((style) => style.supportedActions.includes(action))
                    .map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className={styles.field}>
                Prompt version
                <select
                  value={promptVersionId}
                  onChange={(event) =>
                    setOverrides((current) => ({
                      ...current,
                      promptVersionId: event.target.value,
                    }))
                  }
                >
                  {form.data.promptVersions
                    .filter((prompt) => prompt.action === action)
                    .map((prompt) => (
                      <option key={prompt.id} value={prompt.id}>
                        v{prompt.version} · {prompt.hash}
                      </option>
                    ))}
                </select>
              </label>
              <label className={styles.field}>
                Provider
                <select
                  value={provider}
                  onChange={(event) =>
                    setOverrides((current) => ({
                      ...current,
                      provider: event.target.value,
                    }))
                  }
                >
                  {form.data.providers.map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.displayName}
                      {candidate.isTestProvider ? " (test)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {requiredInputs.includes("sourceText") ||
            requiredInputs.includes("sourceGeneration") ? (
              <label className={styles.field}>
                Source text
                <textarea
                  value={sourceText}
                  onChange={(event) =>
                    setOverrides((current) => ({
                      ...current,
                      sourceText: event.target.value,
                    }))
                  }
                />
              </label>
            ) : null}

            <label className={styles.field}>
              Free-text assertion
              <input
                value={freeText}
                onChange={(event) =>
                  setOverrides((current) => ({
                    ...current,
                    freeText: event.target.value,
                  }))
                }
              />
            </label>

            <p className={styles.buttonRow}>
              <button
                className={styles.buttonPrimary}
                type="submit"
                disabled={command.isPending}
              >
                Run on the bench
              </button>
            </p>
            <RejectionNotice error={command.error} />
          </form>

          {result === null ? (
            <EmptyState>No bench run yet.</EmptyState>
          ) : (
            <>
              <h2 className={styles.sectionLabel}>Bench result</h2>
              <dl className={styles.detailList}>
                <dt>Provider</dt>
                <dd>
                  {result.provider} · {result.model}
                </dd>
                <dt>Latency</dt>
                <dd>{result.latencyMs} ms</dd>
                <dt>Estimated cost</dt>
                <dd>{money(result.estimatedCost)}</dd>
                <dt>Recorded as</dt>
                <dd>Bench run — excluded from analytics, experiments and billing</dd>
              </dl>
              <pre className={styles.codeBlock}>{result.output}</pre>

              <h2 className={styles.sectionLabel}>Claims</h2>
              <DataTable
                caption="Claims kept in the draft"
                empty="This run produced no Claim."
                rows={result.claims}
                rowKey={(row) => row.id}
                columns={[
                  { key: "text", header: "Claim", rowHeader: true, render: (row) => row.text },
                  {
                    key: "support",
                    header: "Supported by",
                    render: (row) => row.supportedBy.join(", "),
                  },
                ]}
              />

              <h2 className={styles.sectionLabel}>Removed claims</h2>
              <DataTable
                caption="Claims removed before the draft was shown"
                empty="Nothing was removed from this run."
                rows={result.removedClaims}
                rowKey={(row) => row.text}
                columns={[
                  { key: "text", header: "Removed", rowHeader: true, render: (row) => row.text },
                  { key: "reason", header: "Reason", render: (row) => row.reason },
                ]}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
