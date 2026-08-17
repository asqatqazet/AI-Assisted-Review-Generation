-- US-03.2: Context binds one redeemed reservation to the Generation lease
-- receipt it verified. These are opaque execution-plane identities here: no
-- cross-role foreign key gives Context a path into Generation-owned tables.
ALTER TABLE budget_reservations
  ADD COLUMN execution_lease_id uuid,
  ADD COLUMN activation_expires_at timestamptz;

CREATE UNIQUE INDEX budget_reservations_execution_lease_unique
  ON budget_reservations(execution_lease_id)
  WHERE execution_lease_id IS NOT NULL;
