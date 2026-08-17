-- US-03.2: persist a finite execution lease before any provider call.
CREATE TYPE execution_lease_state AS ENUM (
  'LEASED',
  'RUNNING',
  'CANCELLED',
  'TERMINAL'
);

CREATE TABLE execution_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  generation_batch_id uuid NOT NULL,
  generation_id uuid NOT NULL UNIQUE,
  permit_jti varchar(128) NOT NULL UNIQUE,
  permit_expires_at timestamptz(6) NOT NULL,
  lease_expires_at timestamptz(6) NOT NULL,
  activation_expires_at timestamptz(6),
  state execution_lease_state NOT NULL DEFAULT 'LEASED',
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  running_at timestamptz(6),
  cancelled_at timestamptz(6),
  terminal_at timestamptz(6),
  CONSTRAINT execution_leases_scope_unique UNIQUE (
    id,
    tenant_id,
    location_id,
    review_session_id,
    generation_id
  ),
  CONSTRAINT execution_leases_expiry_order CHECK (lease_expires_at <= permit_expires_at),
  CONSTRAINT execution_leases_lease_future CHECK (lease_expires_at > created_at),
  CONSTRAINT execution_leases_activation_bound CHECK (
    activation_expires_at IS NULL OR activation_expires_at <= lease_expires_at
  ),
  CONSTRAINT execution_leases_state_timestamps CHECK (
    (state = 'LEASED' AND running_at IS NULL AND cancelled_at IS NULL AND terminal_at IS NULL) OR
    (state = 'RUNNING' AND running_at IS NOT NULL AND cancelled_at IS NULL AND terminal_at IS NULL) OR
    (state = 'CANCELLED' AND running_at IS NULL AND cancelled_at IS NOT NULL AND terminal_at IS NULL) OR
    (state = 'TERMINAL' AND running_at IS NOT NULL AND cancelled_at IS NULL AND terminal_at IS NOT NULL)
  ),
  CONSTRAINT execution_leases_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT execution_leases_location_scope_fk
    FOREIGN KEY (location_id, tenant_id)
    REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT execution_leases_session_scope_fk
    FOREIGN KEY (review_session_id, tenant_id, location_id)
    REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  CONSTRAINT execution_leases_batch_scope_fk
    FOREIGN KEY (generation_batch_id, tenant_id, location_id, review_session_id)
    REFERENCES generation_batches(id, tenant_id, location_id, review_session_id)
    ON DELETE RESTRICT,
  CONSTRAINT execution_leases_generation_scope_fk
    FOREIGN KEY (generation_id, tenant_id, location_id, review_session_id)
    REFERENCES generations(id, tenant_id, location_id, review_session_id)
    ON DELETE RESTRICT
);

CREATE INDEX execution_leases_tenant_location_session_idx
  ON execution_leases(tenant_id, location_id, review_session_id);

ALTER TABLE provider_attempts
  RENAME COLUMN sequence TO attempt_ordinal;

ALTER TABLE provider_attempts
  ADD COLUMN execution_lease_id uuid NOT NULL;

ALTER TABLE provider_attempts
  DROP CONSTRAINT provider_attempts_generation_sequence_unique;

ALTER TABLE provider_attempts
  DROP CONSTRAINT provider_attempts_sequence_positive;

ALTER TABLE provider_attempts
  ADD CONSTRAINT provider_attempts_lease_ordinal_unique
    UNIQUE (execution_lease_id, attempt_ordinal),
  ADD CONSTRAINT provider_attempts_attempt_ordinal_positive
    CHECK (attempt_ordinal > 0),
  ADD CONSTRAINT provider_attempts_execution_lease_scope_fk
    FOREIGN KEY (
      execution_lease_id,
      tenant_id,
      location_id,
      review_session_id,
      generation_id
    )
    REFERENCES execution_leases(
      id,
      tenant_id,
      location_id,
      review_session_id,
      generation_id
    )
    ON DELETE RESTRICT;

ALTER TABLE execution_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_leases FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON execution_leases
  FOR ALL
  USING (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE ON execution_leases TO generation_svc;
