-- D12: platform-owned, content-free queue for bounded cross-Tenant reconciliation.
-- Tenant data is read only after Context sets the queued Tenant in a transaction.
CREATE TABLE reconciliation_queue_items (
  reservation_id uuid PRIMARY KEY
    REFERENCES budget_reservations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  execution_lease_id uuid,
  due_at timestamptz(6) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX reconciliation_queue_items_due_idx
  ON reconciliation_queue_items(due_at, reservation_id);

INSERT INTO reconciliation_queue_items (
  reservation_id, tenant_id, execution_lease_id, due_at
)
SELECT
  reservation.id,
  reservation.tenant_id,
  reservation.execution_lease_id,
  reservation.expires_at + interval '30 seconds'
FROM budget_reservations AS reservation
WHERE reservation.status IN ('RESERVED', 'REDEEMED')
ON CONFLICT (reservation_id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON reconciliation_queue_items TO context_svc;
