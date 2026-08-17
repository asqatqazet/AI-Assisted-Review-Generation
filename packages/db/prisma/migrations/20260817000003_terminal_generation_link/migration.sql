-- A Generation is an immutable terminal execution record. Lease and Attempt
-- evidence must therefore be able to exist before that terminal row is built.
ALTER TABLE provider_attempts
  DROP CONSTRAINT provider_attempts_generation_fk;

ALTER TABLE execution_leases
  DROP CONSTRAINT execution_leases_generation_scope_fk;

ALTER TABLE generations
  ADD COLUMN execution_lease_id uuid NOT NULL UNIQUE,
  ADD CONSTRAINT generations_execution_lease_scope_unique
    UNIQUE (
      execution_lease_id,
      tenant_id,
      location_id,
      review_session_id,
      id
    ),
  ADD CONSTRAINT generations_execution_lease_scope_fk
    FOREIGN KEY (
      execution_lease_id,
      tenant_id,
      location_id,
      review_session_id,
      id
    )
    REFERENCES execution_leases(
      id,
      tenant_id,
      location_id,
      review_session_id,
      generation_id
    )
    ON DELETE RESTRICT;
