-- A PostgreSQL custom setting is caller-controlled. It may carry scope after
-- authentication, but it cannot itself prove which Operator authenticated.
-- Bind each Console transaction to a short-lived, single-use HMAC proof whose
-- key is available to the Console runtime and migration owner, never to the
-- console_control_svc login.

CREATE TABLE console_database_authority_keys (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  secret bytea NOT NULL CHECK (octet_length(secret) = 32),
  rotated_at timestamptz(6) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE console_operator_authority_nonces (
  nonce uuid PRIMARY KEY,
  consumed_at timestamptz(6) NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE console_operator_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  issued_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz(6) NOT NULL,
  CONSTRAINT console_operator_authorizations_expiry CHECK (
    expires_at > issued_at
    AND expires_at <= issued_at + interval '30 seconds'
  )
);

CREATE INDEX console_operator_authorizations_expiry_idx
  ON console_operator_authorizations (expires_at, id);

REVOKE ALL ON console_database_authority_keys,
  console_operator_authority_nonces,
  console_operator_authorizations
FROM PUBLIC, context_runtime_svc, console_control_svc, generation_svc;

CREATE FUNCTION review_console_authority_proof_is_valid(
  p_payload text,
  p_issued_at_ms bigint,
  p_nonce uuid,
  p_mac text
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  authority_secret bytea;
  expected_mac text;
  now_value timestamptz := clock_timestamp();
  inserted_count integer;
  authority_owner name;
BEGIN
  IF p_payload IS NULL OR p_nonce IS NULL OR p_mac IS NULL THEN
    RETURN false;
  END IF;
  SELECT pg_get_userbyid(class.relowner)
    INTO authority_owner
    FROM pg_catalog.pg_class AS class
    WHERE class.oid = 'public.console_database_authority_keys'::regclass;
  IF session_user <> 'console_control_svc'
     AND session_user <> authority_owner THEN
    RETURN false;
  END IF;
  IF p_issued_at_ms IS NULL
     OR to_timestamp(p_issued_at_ms::double precision / 1000.0)
          < now_value - interval '30 seconds'
     OR to_timestamp(p_issued_at_ms::double precision / 1000.0)
          > now_value + interval '5 seconds'
     OR p_mac !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  SELECT key.secret
    INTO authority_secret
    FROM public.console_database_authority_keys AS key
    WHERE key.singleton;
  IF authority_secret IS NULL THEN
    RETURN false;
  END IF;
  expected_mac := encode(
    public.hmac(
      convert_to(p_payload, 'UTF8'),
      authority_secret,
      'sha256'
    ),
    'hex'
  );
  IF expected_mac <> p_mac THEN
    RETURN false;
  END IF;

  DELETE FROM public.console_operator_authority_nonces AS stale
  WHERE stale.nonce IN (
    SELECT candidate.nonce
    FROM public.console_operator_authority_nonces AS candidate
    WHERE candidate.consumed_at < now_value - interval '5 minutes'
    ORDER BY candidate.consumed_at, candidate.nonce
    LIMIT 100
  );
  INSERT INTO public.console_operator_authority_nonces (nonce, consumed_at)
  VALUES (p_nonce, now_value)
  ON CONFLICT (nonce) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

CREATE FUNCTION review_activate_console_operator(
  p_operator_id uuid
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  authorization_id uuid;
  now_value timestamptz := clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.operators AS operator
    WHERE operator.id = p_operator_id
      AND operator.status = 'ACTIVE'
  ) THEN
    RETURN false;
  END IF;

  DELETE FROM public.console_operator_authorizations AS stale
  WHERE stale.id IN (
    SELECT candidate.id
    FROM public.console_operator_authorizations AS candidate
    WHERE candidate.expires_at <= now_value
    ORDER BY candidate.expires_at, candidate.id
    LIMIT 100
  );
  INSERT INTO public.console_operator_authorizations (
    operator_id, issued_at, expires_at
  ) VALUES (
    p_operator_id, now_value, now_value + interval '30 seconds'
  )
  RETURNING id INTO authorization_id;
  PERFORM set_config('app.operator_id', p_operator_id::text, true);
  PERFORM set_config(
    'app.console_operator_authorization_id',
    authorization_id::text,
    true
  );
  RETURN true;
END;
$$;

CREATE FUNCTION review_current_bound_console_operator()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  bound_operator_id uuid;
  authority_owner name;
BEGIN
  -- Expand-phase compatibility for the immutable combined Context version.
  -- Only its sealed legacy login may use the historical raw Operator GUC;
  -- the new Console login still requires the short-lived HMAC binding below.
  IF session_user = 'context_svc' THEN
    SELECT operator.id
      INTO bound_operator_id
      FROM public.operators AS operator
      WHERE operator.id = NULLIF(
          current_setting('app.operator_id', true),
          ''
        )::uuid
        AND operator.status = 'ACTIVE';
    RETURN bound_operator_id;
  END IF;
  SELECT pg_get_userbyid(class.relowner)
    INTO authority_owner
    FROM pg_catalog.pg_class AS class
    WHERE class.oid = 'public.console_operator_authorizations'::regclass;
  IF session_user <> 'console_control_svc'
     AND session_user <> authority_owner THEN
    RETURN NULL;
  END IF;
  SELECT bound_auth.operator_id
    INTO bound_operator_id
    FROM public.console_operator_authorizations AS bound_auth
    JOIN public.operators AS operator
      ON operator.id = bound_auth.operator_id
    WHERE bound_auth.id = NULLIF(
        current_setting('app.console_operator_authorization_id', true),
        ''
      )::uuid
      AND bound_auth.operator_id = NULLIF(
        current_setting('app.operator_id', true),
        ''
      )::uuid
      AND bound_auth.expires_at > clock_timestamp()
      AND operator.status = 'ACTIVE';
  RETURN bound_operator_id;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

CREATE FUNCTION console_bind_operator_authorization(
  p_operator_id uuid,
  p_issued_at_ms bigint,
  p_nonce uuid,
  p_mac text
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  payload text;
BEGIN
  payload := 'operator|' || p_operator_id::text || '|'
    || p_issued_at_ms::text || '|' || p_nonce::text;
  IF NOT public.review_console_authority_proof_is_valid(
    payload,
    p_issued_at_ms,
    p_nonce,
    p_mac
  ) THEN
    RETURN false;
  END IF;
  RETURN public.review_activate_console_operator(p_operator_id);
END;
$$;

CREATE FUNCTION console_resolve_operator_identity(
  p_issuer text,
  p_subject text,
  p_email text,
  p_issued_at_ms bigint,
  p_nonce uuid,
  p_mac text
) RETURNS TABLE (operator_id uuid, email text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  payload text;
  resolved_operator_id uuid;
  resolved_email text;
BEGIN
  payload := 'identity|'
    || octet_length(p_issuer)::text || ':' || p_issuer || '|'
    || octet_length(p_subject)::text || ':' || p_subject || '|'
    || octet_length(p_email)::text || ':' || p_email || '|'
    || p_issued_at_ms::text || '|' || p_nonce::text;
  IF NOT public.review_console_authority_proof_is_valid(
    payload,
    p_issued_at_ms,
    p_nonce,
    p_mac
  ) THEN
    RETURN;
  END IF;

  SELECT operator.id, operator.email::text
    INTO resolved_operator_id, resolved_email
    FROM public.operators AS operator
    WHERE operator.external_issuer = p_issuer
      AND operator.external_subject = p_subject
      AND operator.status = 'ACTIVE'
    LIMIT 1;
  IF resolved_operator_id IS NULL THEN
    UPDATE public.operators AS operator
    SET external_issuer = p_issuer,
        external_subject = p_subject
    WHERE operator.email = p_email
      AND operator.status = 'ACTIVE'
      AND operator.external_issuer IS NULL
      AND operator.external_subject IS NULL
    RETURNING operator.id, operator.email::text
      INTO resolved_operator_id, resolved_email;
  END IF;
  IF resolved_operator_id IS NULL THEN
    SELECT operator.id, operator.email::text
      INTO resolved_operator_id, resolved_email
      FROM public.operators AS operator
      WHERE operator.external_issuer = p_issuer
        AND operator.external_subject = p_subject
        AND operator.status = 'ACTIVE'
      LIMIT 1;
  END IF;
  IF resolved_operator_id IS NULL
     OR NOT public.review_activate_console_operator(resolved_operator_id) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT resolved_operator_id, resolved_email;
END;
$$;

-- New Console requests derive identity only from the unforgeable binding.
-- The context_svc exception above exists solely for rollback to the already
-- published combined Context version and is removed by a later contract.
CREATE OR REPLACE FUNCTION review_operator_has_tenant_capability_privileged(
  target_tenant_id uuid,
  required_capability text
) RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_access_grants AS access_grant
    JOIN public.operators AS operator ON operator.id = access_grant.operator_id
    JOIN public.operator_role_definitions AS role ON role.key = access_grant.role_key
    WHERE access_grant.tenant_id = target_tenant_id
      AND access_grant.operator_id = public.review_current_bound_console_operator()
      AND access_grant.status = 'ACTIVE'
      AND access_grant.valid_from <= clock_timestamp()
      AND (access_grant.valid_until IS NULL OR access_grant.valid_until > clock_timestamp())
      AND operator.status = 'ACTIVE'
      AND role.status = 'ACTIVE'
      AND required_capability = ANY(role.capabilities)
  ) OR EXISTS (
    SELECT 1
    FROM public.platform_access_grants AS platform_grant
    JOIN public.operators AS operator ON operator.id = platform_grant.operator_id
    JOIN public.operator_role_definitions AS role ON role.key = platform_grant.role_key
    WHERE platform_grant.operator_id = public.review_current_bound_console_operator()
      AND platform_grant.status = 'ACTIVE'
      AND platform_grant.valid_from <= clock_timestamp()
      AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
      AND operator.status = 'ACTIVE'
      AND role.status = 'ACTIVE'
      AND required_capability = ANY(role.capabilities)
  );
$$;

CREATE OR REPLACE FUNCTION review_operator_has_platform_capability_privileged(
  required_capability text
) RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_access_grants AS platform_grant
    JOIN public.operators AS operator ON operator.id = platform_grant.operator_id
    JOIN public.operator_role_definitions AS role ON role.key = platform_grant.role_key
    WHERE platform_grant.operator_id = public.review_current_bound_console_operator()
      AND platform_grant.status = 'ACTIVE'
      AND platform_grant.valid_from <= clock_timestamp()
      AND (platform_grant.valid_until IS NULL OR platform_grant.valid_until > clock_timestamp())
      AND operator.status = 'ACTIVE'
      AND role.status = 'ACTIVE'
      AND required_capability = ANY(role.capabilities)
  );
$$;

CREATE OR REPLACE FUNCTION review_operator_has_tenant_capability(
  target_tenant_id uuid,
  required_capability text
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('console_control_svc', 'context_svc') THEN
    RETURN false;
  END IF;
  RETURN review_operator_has_tenant_capability_privileged(
    target_tenant_id,
    required_capability
  );
END;
$$;

CREATE OR REPLACE FUNCTION review_operator_has_platform_capability(
  required_capability text
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('console_control_svc', 'context_svc') THEN
    RETURN false;
  END IF;
  RETURN review_operator_has_platform_capability_privileged(
    required_capability
  );
END;
$$;

-- A Console login no longer enumerates or mutates identity rows. The only
-- allowed rebind is the exact proof-checked function above.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON operators
FROM console_control_svc;

DROP POLICY own_or_service_tenant_grant_read_policy ON tenant_access_grants;
CREATE POLICY own_or_service_tenant_grant_read_policy ON tenant_access_grants
  FOR SELECT
  USING (
    (
      current_user IN ('context_runtime_svc', 'context_svc')
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    ) OR operator_id = review_current_bound_console_operator()
      OR review_operator_has_platform_capability('platform:admin')
  );

DROP POLICY own_platform_grant_read_policy ON platform_access_grants;
CREATE POLICY own_platform_grant_read_policy ON platform_access_grants
  FOR SELECT
  USING (
    operator_id = review_current_bound_console_operator()
    OR review_operator_has_platform_capability('platform:admin')
  );

REVOKE ALL ON FUNCTION review_console_authority_proof_is_valid(
  text, bigint, uuid, text
) FROM PUBLIC, context_runtime_svc, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION review_activate_console_operator(uuid)
FROM PUBLIC, context_runtime_svc, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION review_current_bound_console_operator()
FROM PUBLIC, context_runtime_svc, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION console_bind_operator_authorization(
  uuid, bigint, uuid, text
) FROM PUBLIC, context_runtime_svc, generation_svc;
REVOKE ALL ON FUNCTION console_resolve_operator_identity(
  text, text, text, bigint, uuid, text
) FROM PUBLIC, context_runtime_svc, generation_svc;
GRANT EXECUTE ON FUNCTION console_bind_operator_authorization(
  uuid, bigint, uuid, text
) TO console_control_svc;
GRANT EXECUTE ON FUNCTION console_resolve_operator_identity(
  text, text, text, bigint, uuid, text
) TO console_control_svc;
-- RLS expressions are privilege-checked even when the runtime branch is the
-- only possible match. The helper itself returns NULL unless the session is a
-- proof-bound Console login, so this grant conveys no runtime identity oracle.
GRANT EXECUTE ON FUNCTION review_current_bound_console_operator()
TO context_runtime_svc, console_control_svc, context_svc;
