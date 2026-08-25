-- Console execution reads are authorized twice: Context first resolves the
-- current Operator Grants under console_control_svc, then this migration stores
-- the exact short-lived read in PostgreSQL. Generation receives only the opaque
-- authorization id. It cannot supply a Tenant list, Location, time window or
-- raw-content boolean to a projection function.

CREATE TABLE console_execution_read_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
  scope_type varchar(20) NOT NULL CHECK (scope_type IN ('platform', 'tenant', 'location')),
  tenant_ids uuid[] NOT NULL,
  location_id uuid,
  query jsonb NOT NULL CHECK (jsonb_typeof(query) = 'object'),
  may_read_raw boolean NOT NULL DEFAULT false,
  issued_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz(6) NOT NULL,
  CONSTRAINT console_execution_read_authorizations_scope_shape CHECK (
    (scope_type = 'platform' AND location_id IS NULL) OR
    (scope_type = 'tenant' AND cardinality(tenant_ids) = 1 AND location_id IS NULL) OR
    (scope_type = 'location' AND cardinality(tenant_ids) = 1 AND location_id IS NOT NULL)
  ),
  CONSTRAINT console_execution_read_authorizations_expiry CHECK (
    expires_at > issued_at AND expires_at <= issued_at + interval '60 seconds'
  )
);

CREATE INDEX console_execution_read_authorizations_expiry_idx
  ON console_execution_read_authorizations (expires_at, id);

ALTER TABLE console_execution_read_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE console_execution_read_authorizations FORCE ROW LEVEL SECURITY;

-- FORCE RLS applies to the table owner too. Give only that exact migration
-- owner a maintenance policy; service roles still have no table privilege.
DO $policy$
DECLARE
  owner_name text;
BEGIN
  SELECT role.rolname
    INTO owner_name
    FROM pg_class AS class
    JOIN pg_roles AS role ON role.oid = class.relowner
    WHERE class.oid = 'public.console_execution_read_authorizations'::regclass;
  EXECUTE format(
    'CREATE POLICY console_execution_authorization_owner_policy ON public.console_execution_read_authorizations FOR ALL TO %I USING (current_user = %L) WITH CHECK (current_user = %L)',
    owner_name,
    owner_name,
    owner_name
  );
END
$policy$;

REVOKE ALL ON console_execution_read_authorizations FROM PUBLIC, context_runtime_svc, console_control_svc, generation_svc;

CREATE FUNCTION console_execution_mint_authorization(
  p_scope_type text,
  p_tenant_id uuid,
  p_location_id uuid,
  p_query jsonb,
  p_expires_at timestamptz
) RETURNS TABLE (
  authorization_id uuid,
  expires_at timestamptz,
  read_mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  current_operator_id uuid;
  required_capability text;
  query_view text;
  authorized_tenant_ids uuid[];
  raw_authorized boolean := false;
BEGIN
  IF session_user <> 'console_control_svc' THEN
    RAISE EXCEPTION 'Console execution authorization unavailable' USING ERRCODE = '42501';
  END IF;

  current_operator_id := NULLIF(current_setting('app.operator_id', true), '')::uuid;
  IF current_operator_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.operators AS operator
    WHERE operator.id = current_operator_id AND operator.status = 'ACTIVE'
  ) THEN
    RETURN;
  END IF;
  IF p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '60 seconds' THEN
    RAISE EXCEPTION 'invalid Console execution authorization expiry' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'invalid Console execution query' USING ERRCODE = '22023';
  END IF;

  query_view := p_query->>'view';
  required_capability := CASE query_view
    WHEN 'overview' THEN 'console:read'
    WHEN 'analytics' THEN 'analytics:read'
    WHEN 'generation-detail' THEN 'analytics:read'
    ELSE NULL
  END;
  IF required_capability IS NULL THEN
    RAISE EXCEPTION 'invalid Console execution query' USING ERRCODE = '22023';
  END IF;

  -- Keep the stored query narrow and fully parseable before it becomes an
  -- authority record. The public Zod contract is not the database's proof.
  IF query_view = 'overview' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_query)) <> 3
       OR NOT (p_query ?& ARRAY['view', 'from', 'to'])
       OR (p_query->>'from')::timestamptz >= (p_query->>'to')::timestamptz
       OR (p_query->>'to')::timestamptz - (p_query->>'from')::timestamptz > interval '366 days' THEN
      RAISE EXCEPTION 'invalid Console execution query' USING ERRCODE = '22023';
    END IF;
  ELSIF query_view = 'analytics' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(p_query)) <> 2
       OR NOT (p_query ?& ARRAY['view', 'query'])
       OR jsonb_typeof(p_query->'query') <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(p_query->'query')) <> 4
       OR NOT ((p_query->'query') ?& ARRAY['from', 'to', 'sortKey', 'sortDirection'])
       OR (p_query#>>'{query,from}')::timestamptz >= (p_query#>>'{query,to}')::timestamptz
       OR (p_query#>>'{query,to}')::timestamptz - (p_query#>>'{query,from}')::timestamptz > interval '366 days'
       OR p_query#>>'{query,sortKey}' NOT IN (
         'generations', 'acceptanceRate', 'averageEditDistance',
         'p95LatencyMs', 'totalCost', 'costPerAccepted'
       )
       OR p_query#>>'{query,sortDirection}' NOT IN ('asc', 'desc') THEN
      RAISE EXCEPTION 'invalid Console execution query' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF (SELECT count(*) FROM jsonb_object_keys(p_query)) <> 2
       OR (p_query->>'generationId')::uuid IS NULL THEN
      RAISE EXCEPTION 'invalid Console execution query' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_scope_type = 'platform' THEN
    IF p_tenant_id IS NOT NULL OR p_location_id IS NOT NULL
       OR NOT public.review_operator_has_platform_capability_privileged('platform:admin')
       OR NOT public.review_operator_has_platform_capability_privileged(required_capability) THEN
      RETURN;
    END IF;
    SELECT COALESCE(array_agg(tenant.id ORDER BY tenant.id), ARRAY[]::uuid[])
      INTO authorized_tenant_ids
      FROM public.tenants AS tenant;
    raw_authorized := query_view = 'generation-detail'
      AND public.review_operator_has_platform_capability_privileged('audit:read-raw');
  ELSIF p_scope_type IN ('tenant', 'location') THEN
    IF p_tenant_id IS NULL
       OR NOT public.review_operator_has_tenant_capability_privileged(
         p_tenant_id,
         required_capability
       )
       OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id)
       OR (p_scope_type = 'tenant' AND p_location_id IS NOT NULL)
       OR (p_scope_type = 'location' AND (
         p_location_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM public.locations
           WHERE id = p_location_id AND tenant_id = p_tenant_id
         )
       )) THEN
      RETURN;
    END IF;
    authorized_tenant_ids := ARRAY[p_tenant_id];
    raw_authorized := query_view = 'generation-detail'
      AND public.review_operator_has_tenant_capability_privileged(
        p_tenant_id,
        'audit:read-raw'
      );
  ELSE
    RAISE EXCEPTION 'Console execution authorization unavailable' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.console_execution_read_authorizations AS stale
  WHERE stale.id IN (
    SELECT candidate.id
    FROM public.console_execution_read_authorizations AS candidate
    WHERE candidate.expires_at <= clock_timestamp()
    ORDER BY candidate.expires_at, candidate.id
    LIMIT 100
  );

  RETURN QUERY
  INSERT INTO public.console_execution_read_authorizations AS created (
    operator_id, scope_type, tenant_ids, location_id, query,
    may_read_raw, expires_at
  ) VALUES (
    current_operator_id, p_scope_type, authorized_tenant_ids, p_location_id, p_query,
    raw_authorized, p_expires_at
  )
  RETURNING created.id, created.expires_at,
    CASE WHEN created.may_read_raw THEN 'audit' ELSE 'redacted' END;
END;
$$;

REVOKE ALL ON FUNCTION console_execution_mint_authorization(
  text, uuid, uuid, jsonb, timestamptz
) FROM PUBLIC, context_runtime_svc, generation_svc;
GRANT EXECUTE ON FUNCTION console_execution_mint_authorization(
  text, uuid, uuid, jsonb, timestamptz
) TO console_control_svc;

-- Retire the legacy callable shapes. They remain private implementation
-- helpers for this migration's fixed wrappers, but generation_svc cannot pass
-- a Tenant list or raw flag to them any more.
REVOKE EXECUTE ON FUNCTION public.console_execution_overview(
  jsonb, uuid, timestamptz, timestamptz
) FROM generation_svc;
REVOKE EXECUTE ON FUNCTION public.console_execution_analytics(
  jsonb, uuid, timestamptz, timestamptz, text, text
) FROM generation_svc;
REVOKE EXECUTE ON FUNCTION public.console_execution_generation_detail(
  jsonb, uuid, uuid, boolean
) FROM generation_svc;

CREATE OR REPLACE FUNCTION public.console_execution_overview(
  p_authorization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  auth_record public.console_execution_read_authorizations%ROWTYPE;
BEGIN
  SELECT * INTO auth_record
  FROM public.console_execution_read_authorizations
  WHERE id = p_authorization_id
    AND expires_at > clock_timestamp()
    AND query->>'view' = 'overview';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;
  RETURN public.console_execution_overview(
    to_jsonb(auth_record.tenant_ids),
    auth_record.location_id,
    (auth_record.query->>'from')::timestamptz,
    (auth_record.query->>'to')::timestamptz
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.console_execution_analytics(
  p_authorization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  auth_record public.console_execution_read_authorizations%ROWTYPE;
BEGIN
  SELECT * INTO auth_record
  FROM public.console_execution_read_authorizations
  WHERE id = p_authorization_id
    AND expires_at > clock_timestamp()
    AND query->>'view' = 'analytics';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;
  RETURN public.console_execution_analytics(
    to_jsonb(auth_record.tenant_ids),
    auth_record.location_id,
    (auth_record.query#>>'{query,from}')::timestamptz,
    (auth_record.query#>>'{query,to}')::timestamptz,
    auth_record.query#>>'{query,sortKey}',
    auth_record.query#>>'{query,sortDirection}'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.console_execution_generation_detail(
  p_authorization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  auth_record public.console_execution_read_authorizations%ROWTYPE;
  projection jsonb;
  redacted_claims jsonb;
BEGIN
  SELECT * INTO auth_record
  FROM public.console_execution_read_authorizations
  WHERE id = p_authorization_id
    AND expires_at > clock_timestamp()
    AND query->>'view' = 'generation-detail';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;
  projection := public.console_execution_generation_detail(
    to_jsonb(auth_record.tenant_ids),
    auth_record.location_id,
    (auth_record.query->>'generationId')::uuid,
    false
  );
  IF projection->>'status' <> 'generation-detail' THEN
    RETURN projection;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_set(claim, '{supportedBy}', '[]'::jsonb, true)
  ), '[]'::jsonb)
  INTO redacted_claims
  FROM jsonb_array_elements(
    COALESCE(projection#>'{generation,claims}', '[]'::jsonb)
  ) AS claim;

  projection := jsonb_set(projection, '{generation,freeTextAssertions}', '[]'::jsonb, true);
  projection := jsonb_set(projection, '{generation,sourceText}', 'null'::jsonb, true);
  projection := jsonb_set(projection, '{generation,removedClaims}', 'null'::jsonb, true);
  projection := jsonb_set(projection, '{generation,claims}', redacted_claims, true);
  RETURN projection;
END;
$$;

CREATE OR REPLACE FUNCTION public.console_execution_generation_detail_audit(
  p_authorization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  auth_record public.console_execution_read_authorizations%ROWTYPE;
BEGIN
  SELECT * INTO auth_record
  FROM public.console_execution_read_authorizations
  WHERE id = p_authorization_id
    AND expires_at > clock_timestamp()
    AND query->>'view' = 'generation-detail';
  IF NOT FOUND OR NOT auth_record.may_read_raw THEN
    RETURN jsonb_build_object('status', 'not-found');
  END IF;
  RETURN public.console_execution_generation_detail(
    to_jsonb(auth_record.tenant_ids),
    auth_record.location_id,
    (auth_record.query->>'generationId')::uuid,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.console_execution_overview(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.console_execution_analytics(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.console_execution_generation_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.console_execution_generation_detail_audit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.console_execution_overview(uuid) TO generation_svc;
GRANT EXECUTE ON FUNCTION public.console_execution_analytics(uuid) TO generation_svc;
GRANT EXECUTE ON FUNCTION public.console_execution_generation_detail(uuid) TO generation_svc;
GRANT EXECUTE ON FUNCTION public.console_execution_generation_detail_audit(uuid) TO generation_svc;
