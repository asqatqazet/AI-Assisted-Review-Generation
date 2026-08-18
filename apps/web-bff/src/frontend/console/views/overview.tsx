import type { ConsoleAlertDto } from "@review/contracts/console";

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
import type { ConsoleScopeController } from "../use-console-scope.js";
import styles from "../operator-console.module.css";

function AlertBanner({ alert }: { readonly alert: ConsoleAlertDto }): React.JSX.Element {
  const critical = alert.severity === "critical";
  if (alert.type === "budget_warning") {
    return (
      <p
        className={critical ? styles.alertCritical : styles.alert}
        role={critical ? "alert" : "status"}
      >
        {alert.tenant === null ? "This account" : alert.tenant.name} has spent{" "}
        {money(alert.spent)} of {money(alert.budget)} — past the{" "}
        {alert.thresholdPercent}% alert threshold. Assisted drafting stops when
        the budget is exhausted.
      </p>
    );
  }
  return (
    <p
      className={critical ? styles.alertCritical : styles.alert}
      role={critical ? "alert" : "status"}
    >
      {alert.displayName} is degraded. Drafts may take longer and may be served
      by the fallback route.
    </p>
  );
}

export function OverviewView({
  client,
  scopeController,
}: {
  readonly client: ConsoleClient;
  readonly scopeController: ConsoleScopeController;
}): React.JSX.Element {
  const overview = useConsoleView({
    client,
    view: "overview",
    scope: scopeController.scope,
  });

  const state = <QueryState query={overview} label="the overview" />;
  if (overview.data === undefined) {
    return (
      <>
        <ViewHeader eyebrow="Authorized scope" title="Overview" />
        {state}
      </>
    );
  }
  const data = overview.data;

  return (
    <>
      <ViewHeader
        eyebrow="Authorized scope"
        title="Overview"
        meta={`${scopeLabel(data.scope)} · last 30 days`}
      />
      {data.alerts.map((alert, index) => (
        <AlertBanner key={`${alert.type}-${index}`} alert={alert} />
      ))}

      <section className={styles.cards} aria-label="Scope totals">
        <article className={styles.card}>
          <p className={styles.cardLabel}>Generations</p>
          <p className={styles.metric}>{data.metrics.generations}</p>
        </article>
        <article className={styles.card}>
          <p className={styles.cardLabel}>Accepted</p>
          <p className={styles.metric}>{percent(data.metrics.acceptanceRate)}</p>
          <p className={styles.cardText}>{data.metrics.accepted} drafts kept</p>
        </article>
        <article className={styles.card}>
          <p className={styles.cardLabel}>Spend</p>
          <p className={styles.metric}>{money(data.metrics.totalCost)}</p>
          <p className={styles.cardText}>
            {data.metrics.costPerAccepted === null
              ? "No accepted draft yet"
              : `${money(data.metrics.costPerAccepted)} per accepted draft`}
          </p>
        </article>
      </section>

      <h2 className={styles.sectionLabel}>By Action</h2>
      <DataTable
        caption="Generations by Action"
        empty="No Generation was recorded in this scope and window."
        rows={data.byAction}
        rowKey={(row) => row.action}
        columns={[
          { key: "action", header: "Action", rowHeader: true, render: (row) => row.action },
          { key: "generations", header: "Generations", render: (row) => row.generations },
          {
            key: "acceptance",
            header: "Accepted",
            render: (row) => percent(row.acceptanceRate),
          },
          { key: "cost", header: "Spend", render: (row) => money(row.totalCost) },
        ]}
      />

      {data.scope.type === "platform" ? (
        <>
          <h2 className={styles.sectionLabel}>By account</h2>
          <DataTable
            caption="Generations by account"
            empty="No account recorded activity in this window."
            rows={data.byTenant}
            rowKey={(row) => row.subject.id}
            columns={[
              {
                key: "tenant",
                header: "Account",
                rowHeader: true,
                render: (row) => row.subject.name,
              },
              { key: "generations", header: "Generations", render: (row) => row.generations },
              {
                key: "acceptance",
                header: "Accepted",
                render: (row) => percent(row.acceptanceRate),
              },
              { key: "cost", header: "Spend", render: (row) => money(row.totalCost) },
            ]}
          />
        </>
      ) : (
        <>
          <h2 className={styles.sectionLabel}>By venue</h2>
          <DataTable
            caption="Generations by venue"
            empty="No venue recorded activity in this window."
            rows={data.byLocation}
            rowKey={(row) => row.subject.id}
            columns={[
              {
                key: "location",
                header: "Venue",
                rowHeader: true,
                render: (row) => row.subject.name,
              },
              { key: "generations", header: "Generations", render: (row) => row.generations },
              {
                key: "acceptance",
                header: "Accepted",
                render: (row) => percent(row.acceptanceRate),
              },
              { key: "cost", header: "Spend", render: (row) => money(row.totalCost) },
            ]}
          />
        </>
      )}

      <h2 className={styles.sectionLabel}>Running experiment</h2>
      {data.experiment === null ? (
        <EmptyState>No experiment is running in this scope.</EmptyState>
      ) : (
        <DataTable
          caption={`Variants of the running ${data.experiment.action} experiment`}
          empty="This experiment has no variant."
          rows={data.experiment.variants}
          rowKey={(row) => row.promptVersionId}
          columns={[
            {
              key: "prompt",
              header: "Prompt version",
              rowHeader: true,
              render: (row) => <span className={styles.mono}>{row.promptVersionHash}</span>,
            },
            { key: "weight", header: "Weight", render: (row) => `${row.weightPct}%` },
            { key: "generations", header: "Generations", render: (row) => row.generations },
            {
              key: "acceptance",
              header: "Accepted",
              render: (row) => percent(row.acceptanceRate),
            },
          ]}
        />
      )}

      <h2 className={styles.sectionLabel}>Provider health</h2>
      <DataTable
        caption="Model provider health"
        empty="No provider health is reported for this scope."
        rows={data.providerHealth}
        rowKey={(row) => row.providerKey}
        columns={[
          {
            key: "provider",
            header: "Provider",
            rowHeader: true,
            render: (row) => row.displayName,
          },
          { key: "role", header: "Route", render: (row) => row.routingRole },
          { key: "status", header: "Status", render: (row) => row.status },
          {
            key: "latency",
            header: "p95 latency",
            render: (row) =>
              row.p95LatencyMs === null ? "—" : `${row.p95LatencyMs} ms`,
          },
          {
            key: "fallback",
            header: "Fallback share",
            render: (row) => percent(row.fallbackShare),
          },
        ]}
      />
    </>
  );
}
