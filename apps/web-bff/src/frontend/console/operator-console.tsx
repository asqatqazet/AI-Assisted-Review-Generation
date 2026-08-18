import styles from "./operator-console.module.css";

const navigation = [
  {
    label: "Platform",
    items: ["Tenants", "Providers", "Style catalogue", "Platform settings"],
  },
  {
    label: "Operate",
    items: ["Overview", "Bench", "Analytics", "Generation detail"],
  },
  {
    label: "Tenant",
    items: [
      "Business context",
      "Keywords",
      "Style enablement",
      "Actions",
      "Tenant settings",
    ],
  },
  {
    label: "Location",
    items: ["Locations", "Distribution", "Location settings"],
  },
  { label: "Model", items: ["Prompts", "Experiments"] },
] as const;

function ScopeBadge({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <span className={styles.scopeBadge}>{children}</span>;
}

export default function OperatorConsole(): React.JSX.Element {
  return (
    <div className={styles.page}>
      <header className={styles.scopeBar}>
        <span className={styles.brand}>Review assistant</span>
        <ScopeBadge>Platform</ScopeBadge>
        <span className={styles.scopeLink}>All granted tenants</span>
        <span className={styles.scopeSeparator}>›</span>
        <ScopeBadge>Tenant</ScopeBadge>
        <span className={styles.scopeValue}>Authenticated tenant</span>
        <span className={styles.scopeSeparator}>›</span>
        <ScopeBadge>Location</ScopeBadge>
        <span className={styles.scopeValue}>Authenticated location</span>
        <span className={styles.operator}>Operator · server authorized</span>
      </header>
      <div className={styles.layout}>
        <nav className={styles.navigation} aria-label="Console">
          <p className={styles.navigationHeading}>Authorized workspace</p>
          <p className={styles.navigationMeta}>Bound at sign-in</p>
          {navigation.map((section) => (
            <section className={styles.navigationSection} key={section.label}>
              <h2 className={styles.navigationLabel}>{section.label}</h2>
              <ul className={styles.navigationList}>
                {section.items.map((item) => (
                  <li key={item}>
                    <span
                      className={styles.navigationItem}
                      aria-current={item === "Overview" ? "page" : undefined}
                    >
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <main className={styles.main}>
          <header className={styles.viewHeader}>
            <div>
              <p className={styles.eyebrow}>Today</p>
              <h1 className={styles.title}>Overview</h1>
            </div>
            <p className={styles.meta}>Server-authorized scope</p>
          </header>

          <div className={styles.scopeControl}>
            <span>Scope</span>
            <span className={styles.scopeValue}>This tenant</span>
            <span className={styles.scopeHelp}>
              Live totals appear only after the operator projection is authorized.
            </span>
          </div>

          <section className={styles.cards} aria-label="Console readiness">
            <article className={styles.card}>
              <p className={styles.cardLabel}>Generations · last 30 days</p>
              <p className={styles.metric}>—</p>
              <p className={styles.cardText}>No operating data loaded</p>
            </article>
            <article className={styles.card}>
              <p className={styles.cardLabel}>Acceptance rate</p>
              <p className={styles.metric}>—</p>
              <p className={styles.cardText}>Awaiting authorized projection</p>
            </article>
            <article className={styles.card}>
              <p className={styles.cardLabel}>Month-to-date cost</p>
              <p className={styles.metric}>—</p>
              <p className={styles.cardText}>No fabricated totals</p>
            </article>
          </section>

          <div className={styles.overviewGrid}>
            <section aria-labelledby="by-location-title">
              <h2 className={styles.sectionLabel} id="by-location-title">
                By location
              </h2>
              <div className={styles.emptyTable}>
                Tenant-scoped location metrics will appear here.
              </div>
              <h2 className={styles.sectionLabel}>Cost by action</h2>
              <div className={styles.emptyTable}>
                Action totals are unavailable until the projection endpoint is connected.
              </div>
            </section>
            <aside className={styles.sideColumn}>
              <section>
                <h2 className={styles.sectionLabel}>Experiment</h2>
                <p className={styles.emptyCopy}>No experiment projection loaded.</p>
              </section>
              <section>
                <h2 className={styles.sectionLabel}>Providers</h2>
                <p className={styles.emptyCopy}>Provider health comes from runtime evidence.</p>
              </section>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
