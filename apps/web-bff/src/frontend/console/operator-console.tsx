import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  ConsoleAccessError,
  type ConsoleClient,
} from "./console-client.js";
import styles from "./operator-console.module.css";

function ScopeBadge({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <span className={styles.scopeBadge}>{children}</span>;
}

function ConsoleUnavailable({ error }: { readonly error: Error }): React.JSX.Element {
  const unauthenticated =
    error instanceof ConsoleAccessError && error.code === "unauthenticated";
  const forbidden = error instanceof ConsoleAccessError && error.code === "forbidden";
  return (
    <main className={styles.accessPage}>
      <p className={styles.eyebrow}>Operator Console</p>
      <h1 className={styles.title}>
        {unauthenticated ? "Sign in to Console" : "Console access unavailable"}
      </h1>
      <p className={styles.accessCopy} role={forbidden ? "alert" : undefined}>
        {unauthenticated
          ? "Use your authorized operator account. Your Tenant scope is resolved after sign-in."
          : forbidden
            ? "Your identity has no current Console Access Grant."
            : "The authorized Console projection could not be loaded."}
      </p>
      {unauthenticated ? (
        <a className={styles.primaryAction} href="/auth/login?returnTo=%2Fconsole">
          Sign in
        </a>
      ) : null}
    </main>
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
  const [selectedTenantId, setSelectedTenantId] = useState<string>();
  const [logoutFailed, setLogoutFailed] = useState(false);

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

  const selectedTenant =
    session.data.tenantGrants.find(
      (grant) => grant.tenantId === selectedTenantId,
    ) ?? session.data.tenantGrants[0];
  const platformRole = session.data.platformGrants[0];

  return (
    <div className={styles.page}>
      <header className={styles.scopeBar}>
        <span className={styles.brand}>Review assistant</span>
        <ScopeBadge>{platformRole === undefined ? "Tenant" : "Platform"}</ScopeBadge>
        {selectedTenant === undefined ? null : (
          <span className={styles.scopeValue}>{selectedTenant.tenantName}</span>
        )}
        <span className={styles.operator}>{session.data.operator.email}</span>
        <button
          className={styles.logout}
          type="button"
          onClick={() => {
            setLogoutFailed(false);
            void client.logout().then(
              () => globalThis.location.assign("/console"),
              () => setLogoutFailed(true),
            );
          }}
        >
          Sign out
        </button>
      </header>
      {logoutFailed ? <p className={styles.banner} role="alert">Sign out failed. Try again.</p> : null}
      <div className={styles.layout}>
        <nav className={styles.navigation} aria-label="Console">
          <p className={styles.navigationHeading}>Authorized workspace</p>
          <p className={styles.navigationMeta}>Resolved from current Grants</p>
          <section className={styles.navigationSection}>
            <h2 className={styles.navigationLabel}>Operate</h2>
            <ul className={styles.navigationList}>
              <li><span className={styles.navigationItem} aria-current="page">Overview</span></li>
              <li><span className={styles.navigationItem}>Locations</span></li>
            </ul>
          </section>
        </nav>
        <main className={styles.main}>
          <header className={styles.viewHeader}>
            <div>
              <p className={styles.eyebrow}>Authorized scope</p>
              <h1 className={styles.title}>Overview</h1>
            </div>
            <p className={styles.meta}>Server-authorized · current Grants</p>
          </header>

          {session.data.tenantGrants.length > 1 ? (
            <label className={styles.scopeControl}>
              Tenant
              <select
                value={selectedTenant?.tenantId ?? ""}
                onChange={(event) => setSelectedTenantId(event.target.value)}
              >
                {session.data.tenantGrants.map((grant) => (
                  <option key={grant.tenantId} value={grant.tenantId}>
                    {grant.tenantName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {selectedTenant === undefined ? (
            <p className={styles.accessCopy}>No Tenant Grant is assigned to this operator.</p>
          ) : (
            <>
              <section className={styles.cards} aria-label="Granted scope summary">
                <article className={styles.card}>
                  <p className={styles.cardLabel}>Tenant</p>
                  <p className={styles.cardValue}>{selectedTenant.tenantName}</p>
                  <p className={styles.cardText}>{selectedTenant.tenantSlug}</p>
                </article>
                <article className={styles.card}>
                  <p className={styles.cardLabel}>Access role</p>
                  <p className={styles.cardValue}>{selectedTenant.roleKey}</p>
                  <p className={styles.cardText}>{selectedTenant.capabilities.length} capabilities</p>
                </article>
                <article className={styles.card}>
                  <p className={styles.cardLabel}>Locations</p>
                  <p className={styles.metric}>{selectedTenant.locations.length}</p>
                  <p className={styles.cardText}>Visible in this granted Tenant</p>
                </article>
              </section>

              <section className={styles.locationSection} aria-labelledby="locations-title">
                <h2 className={styles.sectionLabel} id="locations-title">Locations</h2>
                {selectedTenant.locations.length === 0 ? (
                  <p className={styles.emptyCopy}>No authorized Locations.</p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead><tr><th scope="col">Location</th><th scope="col">Slug</th><th scope="col">Status</th></tr></thead>
                      <tbody>
                        {selectedTenant.locations.map((location) => (
                          <tr key={location.locationId}>
                            <th scope="row">{location.locationName}</th>
                            <td>{location.locationSlug}</td>
                            <td>{location.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
