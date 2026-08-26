-- Reviewer runtime capability hardening. Opaque browser bindings and the
-- platform reconciliation queue are pre-scope indexes; direct table scans
-- would let one buggy code path enumerate every Tenant. Only fixed, bounded
-- SECURITY DEFINER operations remain callable by context_runtime_svc.

-- A managed-database CREATEROLE owner cannot toggle SUPERUSER/BYPASSRLS,
-- including toggling them off. Fail closed if an existing service role is
-- unsafe, then alter only the ordinary login/inheritance attributes.
DO $service_role_security$
DECLARE
  role record;
BEGIN
  FOR role IN
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_catalog.pg_roles
    WHERE rolname IN (
      'context_runtime_svc',
      'console_control_svc',
      'generation_svc'
    )
  LOOP
    IF role.rolsuper OR role.rolbypassrls THEN
      RAISE EXCEPTION USING
        MESSAGE = 'SERVICE_ROLE_SECURITY_ATTRIBUTES_INVALID',
        DETAIL = format(
          'Role %I must already be NOSUPERUSER and NOBYPASSRLS; the migration owner will not attempt a privileged attribute change.',
          role.rolname
        );
    END IF;
  END LOOP;
END
$service_role_security$;

ALTER ROLE context_runtime_svc LOGIN NOINHERIT;
ALTER ROLE console_control_svc LOGIN NOINHERIT;
ALTER ROLE generation_svc LOGIN NOINHERIT;

ALTER TABLE review_session_browser_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_session_browser_bindings FORCE ROW LEVEL SECURITY;

DO $policy$
DECLARE
  owner_name text;
BEGIN
  SELECT role.rolname INTO owner_name
  FROM pg_class AS class
  JOIN pg_roles AS role ON role.oid = class.relowner
  WHERE class.oid = 'public.review_session_browser_bindings'::regclass;
  EXECUTE format(
    'CREATE POLICY review_session_binding_owner_policy ON public.review_session_browser_bindings FOR ALL TO %I USING (current_user = %L) WITH CHECK (current_user = %L)',
    owner_name,
    owner_name,
    owner_name
  );
END
$policy$;

CREATE POLICY review_session_binding_runtime_insert_policy
ON review_session_browser_bindings
FOR INSERT TO context_runtime_svc
WITH CHECK (
  NULLIF(current_setting('app.operator_id', true), '') IS NULL
  AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

CREATE OR REPLACE FUNCTION lookup_live_review_session_browser_binding(
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar
)
RETURNS TABLE (
  tenant_id uuid,
  location_id uuid,
  review_session_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'context_runtime_svc' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT binding.tenant_id, binding.location_id, binding.review_session_id
  FROM public.review_session_browser_bindings AS binding
  JOIN public.review_sessions AS session
    ON session.id = binding.review_session_id
   AND session.tenant_id = binding.tenant_id
   AND session.location_id = binding.location_id
  WHERE binding.route_handle_hash = p_route_handle_hash
    AND binding.browser_capability_hash = p_browser_capability_hash
    AND binding.revoked_at IS NULL
    AND binding.expires_at > clock_timestamp()
    AND session.status = 'OPEN'
    AND session.expires_at > clock_timestamp()
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION touch_live_review_session_browser_binding(
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar
)
RETURNS TABLE (
  tenant_id uuid,
  location_id uuid,
  review_session_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'context_runtime_svc' THEN
    RETURN;
  END IF;
  RETURN QUERY
  UPDATE public.review_session_browser_bindings AS binding
  SET expires_at = LEAST(
    session.expires_at,
    clock_timestamp() + interval '24 hours'
  )
  FROM public.review_sessions AS session
  WHERE binding.route_handle_hash = p_route_handle_hash
    AND binding.browser_capability_hash = p_browser_capability_hash
    AND binding.revoked_at IS NULL
    AND binding.expires_at > clock_timestamp()
    AND session.id = binding.review_session_id
    AND session.tenant_id = binding.tenant_id
    AND session.location_id = binding.location_id
    AND session.status = 'OPEN'
    AND session.expires_at > clock_timestamp()
  RETURNING binding.tenant_id, binding.location_id, binding.review_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_live_review_session_browser_binding(
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar
)
RETURNS TABLE (
  tenant_id uuid,
  location_id uuid,
  review_session_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'context_runtime_svc' THEN
    RETURN;
  END IF;
  RETURN QUERY
  UPDATE public.review_session_browser_bindings AS binding
  SET revoked_at = clock_timestamp()
  WHERE binding.route_handle_hash = p_route_handle_hash
    AND binding.browser_capability_hash = p_browser_capability_hash
    AND binding.revoked_at IS NULL
    AND binding.expires_at > clock_timestamp()
  RETURNING binding.tenant_id, binding.location_id, binding.review_session_id;
END;
$$;

REVOKE SELECT, UPDATE, DELETE ON review_session_browser_bindings FROM context_runtime_svc;
GRANT INSERT ON review_session_browser_bindings TO context_runtime_svc;
REVOKE ALL ON FUNCTION lookup_live_review_session_browser_binding(varchar, varchar) FROM PUBLIC, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION touch_live_review_session_browser_binding(varchar, varchar) FROM PUBLIC, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION revoke_live_review_session_browser_binding(varchar, varchar) FROM PUBLIC, console_control_svc, generation_svc;
GRANT EXECUTE ON FUNCTION lookup_live_review_session_browser_binding(varchar, varchar) TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION touch_live_review_session_browser_binding(varchar, varchar) TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION revoke_live_review_session_browser_binding(varchar, varchar) TO context_runtime_svc;

ALTER TABLE reconciliation_queue_items
  ADD COLUMN claim_token uuid,
  ADD COLUMN claim_expires_at timestamptz(6),
  ADD COLUMN claim_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT reconciliation_queue_claim_shape CHECK (
    (claim_token IS NULL AND claim_expires_at IS NULL) OR
    (claim_token IS NOT NULL AND claim_expires_at IS NOT NULL)
  ),
  ADD CONSTRAINT reconciliation_queue_claim_count_nonnegative CHECK (
    claim_count >= 0
  );

ALTER TABLE reconciliation_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_queue_items FORCE ROW LEVEL SECURITY;

DO $policy$
DECLARE
  owner_name text;
BEGIN
  SELECT role.rolname INTO owner_name
  FROM pg_class AS class
  JOIN pg_roles AS role ON role.oid = class.relowner
  WHERE class.oid = 'public.reconciliation_queue_items'::regclass;
  EXECUTE format(
    'CREATE POLICY reconciliation_queue_owner_policy ON public.reconciliation_queue_items FOR ALL TO %I USING (current_user = %L) WITH CHECK (current_user = %L)',
    owner_name,
    owner_name,
    owner_name
  );
END
$policy$;

CREATE OR REPLACE FUNCTION enqueue_reconciliation_queue_item(
  p_reservation_id uuid,
  p_tenant_id uuid,
  p_due_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'context_runtime_svc'
     OR p_tenant_id <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
     OR NOT EXISTS (
       SELECT 1 FROM public.budget_reservations AS reservation
       WHERE reservation.id = p_reservation_id
         AND reservation.tenant_id = p_tenant_id
         AND reservation.status IN ('RESERVED', 'REDEEMED')
     ) THEN
    RETURN false;
  END IF;
  INSERT INTO public.reconciliation_queue_items (
    reservation_id, tenant_id, due_at
  ) VALUES (p_reservation_id, p_tenant_id, p_due_at)
  ON CONFLICT (reservation_id) DO NOTHING;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION reschedule_reconciliation_queue_item(
  p_reservation_id uuid,
  p_tenant_id uuid,
  p_execution_lease_id uuid,
  p_due_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'context_runtime_svc'
     OR p_tenant_id <> NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RETURN false;
  END IF;
  UPDATE public.reconciliation_queue_items AS queue
  SET execution_lease_id = p_execution_lease_id,
      due_at = p_due_at,
      claim_token = NULL,
      claim_expires_at = NULL
  WHERE queue.reservation_id = p_reservation_id
    AND queue.tenant_id = p_tenant_id
    AND EXISTS (
      SELECT 1 FROM public.budget_reservations AS reservation
      WHERE reservation.id = queue.reservation_id
        AND reservation.tenant_id = queue.tenant_id
        AND reservation.execution_lease_id = p_execution_lease_id
        AND reservation.status = 'REDEEMED'
    );
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION remove_reconciliation_queue_item(
  p_reservation_id uuid,
  p_tenant_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'context_runtime_svc'
     OR p_tenant_id <> NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RETURN false;
  END IF;
  DELETE FROM public.reconciliation_queue_items AS queue
  WHERE queue.reservation_id = p_reservation_id
    AND queue.tenant_id = p_tenant_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION reconciliation_queue_item_is_releasable(
  p_reservation_id uuid,
  p_tenant_id uuid,
  p_execution_lease_id uuid,
  p_outcome text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'context_runtime_svc'
     OR p_tenant_id <> NULLIF(current_setting('app.tenant_id', true), '')::uuid
     OR p_outcome NOT IN ('cancelled', 'never-leased') THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.reconciliation_queue_items AS queue
    WHERE queue.reservation_id = p_reservation_id
      AND queue.tenant_id = p_tenant_id
      AND queue.due_at <= clock_timestamp()
      AND (
        (p_outcome = 'cancelled' AND p_execution_lease_id IS NOT NULL
          AND queue.execution_lease_id = p_execution_lease_id) OR
        (p_outcome = 'never-leased' AND p_execution_lease_id IS NULL
          AND queue.execution_lease_id IS NULL)
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION claim_due_reconciliation_queue(
  p_claim_token uuid,
  p_limit integer
) RETURNS TABLE (
  reservation_id uuid,
  tenant_id uuid,
  execution_lease_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'context_runtime_svc' THEN
    RETURN;
  END IF;
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Reconciliation claim limit is invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT queue.reservation_id
    FROM public.reconciliation_queue_items AS queue
    WHERE queue.due_at <= clock_timestamp()
      AND (
        queue.claim_expires_at IS NULL OR
        queue.claim_expires_at <= clock_timestamp()
      )
    ORDER BY queue.due_at, queue.reservation_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.reconciliation_queue_items AS queue
  SET claim_token = p_claim_token,
      claim_expires_at = clock_timestamp() + interval '2 minutes',
      claim_count = queue.claim_count + 1
  FROM due
  WHERE queue.reservation_id = due.reservation_id
  RETURNING queue.reservation_id, queue.tenant_id, queue.execution_lease_id;
END;
$$;

REVOKE ALL ON reconciliation_queue_items FROM context_runtime_svc;
REVOKE ALL ON FUNCTION enqueue_reconciliation_queue_item(uuid, uuid, timestamptz) FROM PUBLIC, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION reschedule_reconciliation_queue_item(uuid, uuid, uuid, timestamptz) FROM PUBLIC, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION remove_reconciliation_queue_item(uuid, uuid) FROM PUBLIC, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION reconciliation_queue_item_is_releasable(uuid, uuid, uuid, text) FROM PUBLIC, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION claim_due_reconciliation_queue(uuid, integer) FROM PUBLIC, console_control_svc, generation_svc;
GRANT EXECUTE ON FUNCTION enqueue_reconciliation_queue_item(uuid, uuid, timestamptz) TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION reschedule_reconciliation_queue_item(uuid, uuid, uuid, timestamptz) TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION remove_reconciliation_queue_item(uuid, uuid) TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION reconciliation_queue_item_is_releasable(uuid, uuid, uuid, text) TO context_runtime_svc;
GRANT EXECUTE ON FUNCTION claim_due_reconciliation_queue(uuid, integer) TO context_runtime_svc;
