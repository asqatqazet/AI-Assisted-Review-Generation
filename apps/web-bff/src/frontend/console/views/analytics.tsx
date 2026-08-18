import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import type { ConsoleClient } from "../console-client.js";
import { useConsoleView } from "../console-queries.js";
import {
  DataTable,
  EmptyState,
  QueryState,
  ViewHeader,
  money,
  percent,
  scopeLabel,
} from "../console-ui.js";
import styles from "../operator-console.module.css";
import type { ConsoleScopeController } from "../use-console-scope.js";

const SORT_KEYS = [
  "generations",
  "acceptanceRate",
  "averageEditDistance",
  "p95LatencyMs",
  "totalCost",
  "costPerAccepted",
] as const;

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function AnalyticsView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  // Pinned once per mount: a range recomputed on every render would change the
  // query key on every render and leave the table permanently loading.
  const [fallback] = useState(defaultRange);
  // The query lives in the URL so an operator can share the exact table.
  const from = searchParams.get("from") ?? fallback.from;
  const to = searchParams.get("to") ?? fallback.to;
  const sortKey = searchParams.get("sortKey") ?? "generations";
  const sortDirection = searchParams.get("sortDirection") ?? "desc";

  const analytics = useConsoleView({
    client,
    view: "analytics",
    scope: scopeController.scope,
    params: { from, to, sortKey, sortDirection },
  });

  const updateQuery = (changes: Readonly<Record<string, string>>): void => {
    const next = new URLSearchParams(searchParams);
    next.set("from", from);
    next.set("to", to);
    next.set("sortKey", sortKey);
    next.set("sortDirection", sortDirection);
    for (const [name, value] of Object.entries(changes)) {
      next.set(name, value);
    }
    setSearchParams(next);
  };

  return (
    <>
      <ViewHeader
        eyebrow="Analytics"
        title="Generation analytics"
        meta={
          analytics.data === undefined
            ? undefined
            : scopeLabel(analytics.data.scope)
        }
      />

      <div className={styles.toolbar}>
        <label className={styles.field}>
          From
          <input
            type="date"
            value={from.slice(0, 10)}
            onChange={(event) =>
              updateQuery({
                from: new Date(`${event.target.value}T00:00:00.000Z`).toISOString(),
              })
            }
          />
        </label>
        <label className={styles.field}>
          To
          <input
            type="date"
            value={to.slice(0, 10)}
            onChange={(event) =>
              updateQuery({
                to: new Date(`${event.target.value}T00:00:00.000Z`).toISOString(),
              })
            }
          />
        </label>
        <label className={styles.field}>
          Sort by
          <select
            value={sortKey}
            onChange={(event) => updateQuery({ sortKey: event.target.value })}
          >
            {SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.button}
          onClick={() =>
            updateQuery({
              sortDirection: sortDirection === "desc" ? "asc" : "desc",
            })
          }
        >
          {sortDirection === "desc" ? "Descending" : "Ascending"}
        </button>
      </div>

      <QueryState query={analytics} label="analytics" />

      {analytics.data === undefined ? null : (
        <DataTable
          caption="Generations by venue, Action, Review Format and experiment variant"
          empty="No Generation matched this scope and date range."
          rows={analytics.data.rows}
          rowKey={(row) =>
            `${row.location.id}:${row.action}:${row.style}:${row.variant ?? "none"}`
          }
          sort={{
            key: sortKey,
            direction: sortDirection === "asc" ? "asc" : "desc",
          }}
          onSort={(key) =>
            updateQuery({
              sortKey: key,
              sortDirection:
                sortKey === key && sortDirection === "desc" ? "asc" : "desc",
            })
          }
          columns={[
            {
              key: "location",
              header: "Venue",
              rowHeader: true,
              render: (row) =>
                analytics.data.scope.type === "platform"
                  ? `${row.tenant.name} · ${row.location.name}`
                  : row.location.name,
            },
            { key: "action", header: "Action", render: (row) => row.action },
            { key: "style", header: "Format", render: (row) => row.style },
            {
              key: "variant",
              header: "Variant",
              render: (row) => row.variant ?? "—",
            },
            {
              key: "generations",
              header: "Generations",
              sortable: true,
              render: (row) => row.generations,
            },
            {
              key: "acceptanceRate",
              header: "Accepted",
              sortable: true,
              render: (row) => percent(row.acceptanceRate),
            },
            {
              key: "averageEditDistance",
              header: "Avg edit distance",
              sortable: true,
              render: (row) => row.averageEditDistance.toFixed(2),
            },
            {
              key: "p95LatencyMs",
              header: "p50 / p95",
              sortable: true,
              render: (row) => `${row.p50LatencyMs} / ${row.p95LatencyMs} ms`,
            },
            {
              key: "totalCost",
              header: "Spend",
              sortable: true,
              render: (row) => money(row.totalCost),
            },
            {
              key: "costPerAccepted",
              header: "Per accepted",
              sortable: true,
              render: (row) =>
                row.costPerAccepted === null ? "—" : money(row.costPerAccepted),
            },
          ]}
        />
      )}
    </>
  );
}

export function GenerationDetailView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const { generationId } = useParams<{ generationId: string }>();
  const detail = useConsoleView({
    client,
    view: "generation-detail",
    scope: scopeController.scope,
    params: { generationId: generationId ?? null },
    enabled: generationId !== undefined,
  });

  return (
    <>
      <ViewHeader
        eyebrow="Audit"
        title="Generation detail"
        meta={generationId}
      />
      <QueryState query={detail} label="the Generation" />

      {detail.data === undefined ? null : (
        <>
          <dl className={styles.detailList}>
            <dt>Generation</dt>
            <dd className={styles.mono}>{detail.data.generation.id}</dd>
            <dt>Recorded</dt>
            <dd>{detail.data.generation.createdAt}</dd>
            <dt>Account · venue</dt>
            <dd>
              {detail.data.generation.tenant.name} ·{" "}
              {detail.data.generation.location.name}
            </dd>
            <dt>Action · format</dt>
            <dd>
              {detail.data.generation.action} ·{" "}
              {detail.data.generation.style.name} v
              {detail.data.generation.style.version}
            </dd>
            <dt>Prompt version</dt>
            <dd className={styles.mono}>
              v{detail.data.generation.promptVersion.version} ·{" "}
              {detail.data.generation.promptVersion.hash}
            </dd>
            <dt>Context version</dt>
            <dd>
              {detail.data.generation.contextVersion === null
                ? "—"
                : `v${detail.data.generation.contextVersion.version}`}
            </dd>
            <dt>Input fact options</dt>
            <dd>
              {detail.data.generation.inputKeywords.length === 0
                ? "—"
                : detail.data.generation.inputKeywords.join(", ")}
            </dd>
            <dt>Free-text assertions</dt>
            <dd>
              {detail.data.generation.freeTextAssertions.length === 0
                ? "—"
                : detail.data.generation.freeTextAssertions.join(" / ")}
            </dd>
            <dt>Provider route</dt>
            <dd>
              {detail.data.generation.provider} ·{" "}
              {detail.data.generation.model} ({detail.data.generation.route})
            </dd>
            <dt>Cost</dt>
            <dd>
              {money(detail.data.generation.cost)}
              {detail.data.generation.pricingVersionId === null
                ? ""
                : ` · price version ${detail.data.generation.pricingVersionId}`}
            </dd>
            <dt>Outcome</dt>
            <dd>
              {detail.data.generation.outcome}
              {detail.data.generation.editDistance === null
                ? ""
                : ` · edit distance ${detail.data.generation.editDistance.toFixed(2)}`}
            </dd>
          </dl>

          {detail.data.replayable ? (
            <p className={styles.buttonRow}>
              <Link
                className={styles.button}
                to={scopeController.href("/console/ai/bench", {
                  replayGenerationId: detail.data.generation.id,
                })}
              >
                Replay in bench
              </Link>
            </p>
          ) : null}

          <h2 className={styles.sectionLabel}>Draft</h2>
          <pre className={styles.codeBlock}>{detail.data.generation.output}</pre>

          <h2 className={styles.sectionLabel}>Claims</h2>
          <DataTable
            caption="Claims in the generated draft"
            empty="This Generation recorded no Claim."
            rows={detail.data.generation.claims}
            rowKey={(row) => row.id}
            columns={[
              { key: "text", header: "Claim", rowHeader: true, render: (row) => row.text },
              { key: "verdict", header: "Verdict", render: (row) => row.verdict },
              {
                key: "support",
                header: "Supported by",
                render: (row) => row.supportedBy.join(", "),
              },
            ]}
          />

          <h2 className={styles.sectionLabel}>Removed claims</h2>
          {detail.data.generation.removedClaims === null ? (
            <EmptyState>
              Raw removed output is retained only for a privileged audit role.
            </EmptyState>
          ) : (
            <DataTable
              caption="Claims removed before the draft was shown"
              empty="Nothing was removed from this Generation."
              rows={detail.data.generation.removedClaims}
              rowKey={(row) => row.text}
              columns={[
                { key: "text", header: "Removed", rowHeader: true, render: (row) => row.text },
                { key: "reason", header: "Reason", render: (row) => row.reason },
              ]}
            />
          )}

          <h2 className={styles.sectionLabel}>Lineage</h2>
          {detail.data.lineage.ancestors.length === 0 &&
          detail.data.lineage.descendants.length === 0 ? (
            <EmptyState>This Generation has no derived draft.</EmptyState>
          ) : (
            <ul className={styles.lineage}>
              {detail.data.lineage.ancestors.map((entry) => (
                <li key={entry.id}>
                  <Link
                    to={scopeController.href(`/console/generations/${entry.id}`)}
                  >
                    {entry.action} · {entry.id}
                  </Link>
                </li>
              ))}
              <li>
                <strong>
                  {detail.data.generation.action} · this Generation
                </strong>
              </li>
              {detail.data.lineage.descendants.map((entry) => (
                <li key={entry.id}>
                  <Link
                    to={scopeController.href(`/console/generations/${entry.id}`)}
                  >
                    {entry.action} · {entry.id}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
