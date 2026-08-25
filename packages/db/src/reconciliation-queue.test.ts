import fs from "node:fs";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  new URL(
    "../prisma/migrations/20260817000009_reconciliation_queue/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const adapter = fs.readFileSync(
  new URL("./admission/index.ts", import.meta.url),
  "utf8",
);
const hardenedMigration = fs.readFileSync(
  new URL(
    "../prisma/migrations/20260824000022_context_runtime_capabilities/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("D12 reconciliation queue boundary", () => {
  it("keeps the global queue content-free and grants it only to Context", () => {
    const table = migration.match(
      /CREATE TABLE reconciliation_queue_items[\s\S]*?\n\);/,
    )?.[0];
    expect(table).toBeDefined();
    expect(table).not.toMatch(/json|text|snapshot|assertion|workload/i);
    expect(migration).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON reconciliation_queue_items TO context_svc;",
    );
    expect(migration).not.toMatch(
      /GRANT[^;]*reconciliation_queue_items[^;]*generation_svc/,
    );
  });

  it("enqueues, reschedules, claims and removes through fixed operations only", () => {
    expect(adapter).toContain("enqueue_reconciliation_queue_item");
    expect(adapter).toContain("reschedule_reconciliation_queue_item");
    expect(adapter).toContain("claim_due_reconciliation_queue");
    expect(adapter).toContain("remove_reconciliation_queue_item");
    expect(adapter).not.toMatch(
      /(?:INSERT INTO|UPDATE|DELETE FROM) reconciliation_queue_items/u,
    );
    expect(hardenedMigration).toContain(
      "REVOKE ALL ON reconciliation_queue_items FROM context_runtime_svc",
    );
    expect(hardenedMigration).toContain("FOR UPDATE SKIP LOCKED");
    expect(hardenedMigration).toContain("queue.due_at <= clock_timestamp()");
    expect(adapter).toContain("reservation.expires_at + interval '30 seconds'");
  });
});
