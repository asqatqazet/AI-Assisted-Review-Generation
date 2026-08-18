import type { ConsoleScopeDto } from "@review/contracts/console";
import type { UseQueryResult } from "@tanstack/react-query";

import { ConsoleAccessError } from "./console-client.js";
import styles from "./operator-console.module.css";

export function ViewHeader({
  eyebrow,
  title,
  meta,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly meta?: string | undefined;
  readonly actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className={styles.viewHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
      </div>
      {actions ?? (meta === undefined ? null : <p className={styles.meta}>{meta}</p>)}
    </header>
  );
}

export function scopeLabel(scope: ConsoleScopeDto): string {
  if (scope.type === "platform") {
    return "Platform";
  }
  return scope.type === "tenant"
    ? scope.tenant.name
    : `${scope.tenant.name} · ${scope.location.name}`;
}

export function OwnerBadge({
  scope,
}: {
  readonly scope: "platform" | "tenant" | "location";
}): React.JSX.Element {
  const className =
    scope === "platform"
      ? styles.ownerBadgePlatform
      : scope === "location"
        ? styles.ownerBadgeLocation
        : styles.ownerBadge;
  return <span className={className}>{scope}</span>;
}

/**
 * Loading, failure and empty are first-class states for every Console view:
 * a blank table is never allowed to read as "no data".
 */
export function QueryState({
  query,
  label,
}: {
  readonly query: Pick<UseQueryResult, "isPending" | "isError" | "error">;
  readonly label: string;
}): React.JSX.Element | null {
  if (query.isPending) {
    return (
      <p role="status" className={styles.emptyCopy}>
        Loading {label}…
      </p>
    );
  }
  if (query.isError) {
    const notFound =
      query.error instanceof ConsoleAccessError &&
      query.error.code === "not-found";
    return (
      <p role="alert" className={styles.rejection}>
        {notFound
          ? "This resource is unavailable in the selected scope."
          : `${label} could not be loaded.`}
      </p>
    );
  }
  return null;
}

export function EmptyState({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return <p className={styles.emptyCopy}>{children}</p>;
}

export interface Column<TRow> {
  readonly key: string;
  readonly header: string;
  readonly rowHeader?: boolean | undefined;
  readonly sortable?: boolean | undefined;
  readonly render: (row: TRow) => React.ReactNode;
}

export function DataTable<TRow>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
  sort,
  onSort,
}: {
  readonly caption: string;
  readonly columns: readonly Column<TRow>[];
  readonly rows: readonly TRow[];
  readonly rowKey: (row: TRow) => string;
  readonly empty: string;
  readonly sort?: { readonly key: string; readonly direction: "asc" | "desc" } | undefined;
  readonly onSort?: ((key: string) => void) | undefined;
}): React.JSX.Element {
  if (rows.length === 0) {
    return <p className={styles.emptyTable}>{empty}</p>;
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.eyebrow}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sort === undefined || sort.key !== column.key
                    ? undefined
                    : sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                }
              >
                {column.sortable === true && onSort !== undefined ? (
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => onSort(column.key)}
                  >
                    {column.header}
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) =>
                column.rowHeader === true ? (
                  <th key={column.key} scope="row">
                    {column.render(row)}
                  </th>
                ) : (
                  <td key={column.key}>{column.render(row)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function money(value: {
  readonly amountMicros: number;
  readonly currency: string;
}): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: value.currency,
  }).format(value.amountMicros / 1_000_000);
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function RejectionNotice({
  error,
}: {
  readonly error: unknown;
}): React.JSX.Element | null {
  if (!(error instanceof Error)) {
    return null;
  }
  return (
    <p role="alert" className={styles.rejection}>
      {error.message}
    </p>
  );
}
