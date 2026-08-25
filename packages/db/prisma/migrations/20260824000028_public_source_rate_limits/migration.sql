-- Exact public-source limits live behind one Context-only database function.
-- The caller supplies only a daily-HMAC bucket and a policy name; limits,
-- windows and time are server-owned.
CREATE TABLE public_source_rate_limit_events (
  id bigserial PRIMARY KEY,
  source_bucket_hash char(64) NOT NULL
    CHECK (source_bucket_hash ~ '^[0-9a-f]{64}$'),
  policy text NOT NULL
    CHECK (policy IN ('entry-prepare', 'entry-start', 'generation')),
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX public_source_rate_limit_events_window_idx
  ON public_source_rate_limit_events (source_bucket_hash, policy, consumed_at);
CREATE INDEX public_source_rate_limit_events_cleanup_idx
  ON public_source_rate_limit_events (consumed_at);

REVOKE ALL ON public_source_rate_limit_events
  FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc;
REVOKE ALL ON SEQUENCE public_source_rate_limit_events_id_seq
  FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc;

ALTER TABLE public_source_rate_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_source_rate_limit_events FORCE ROW LEVEL SECURITY;

-- FORCE RLS also applies to a non-BYPASS migration owner. The sealed
-- SECURITY DEFINER function runs as this exact owner; application roles gain
-- no table policy and no direct privilege.
DO $$
DECLARE
  owner_name name;
BEGIN
  SELECT role.rolname
  INTO owner_name
  FROM pg_catalog.pg_class AS class
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = class.relnamespace
  JOIN pg_catalog.pg_roles AS role
    ON role.oid = class.relowner
  WHERE namespace.nspname = 'public'
    AND class.relname = 'public_source_rate_limit_events';

  EXECUTE format(
    'CREATE POLICY public_source_rate_limit_owner_policy ON public_source_rate_limit_events FOR ALL TO %I USING (current_user = %L) WITH CHECK (current_user = %L)',
    owner_name,
    owner_name,
    owner_name
  );
END $$;

CREATE FUNCTION cleanup_expired_public_source_rate_limits()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  -- The scheduled reconciliation runs hourly. Deleting at 23 hours keeps the
  -- physical retention target within 24 hours while remaining far outside the
  -- longest one-hour enforcement window.
  DELETE FROM public_source_rate_limit_events
  WHERE consumed_at <= clock_timestamp() - interval '23 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION cleanup_expired_public_source_rate_limits()
  FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc;
GRANT EXECUTE ON FUNCTION cleanup_expired_public_source_rate_limits()
  TO context_runtime_svc;

CREATE FUNCTION purge_public_source_rate_limits()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public_source_rate_limit_events;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION purge_public_source_rate_limits()
  FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc;

CREATE FUNCTION consume_public_source_rate_limit(
  p_source_bucket_hash text,
  p_policy text
) RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_limit integer;
  v_window interval;
  v_now timestamptz;
  v_count bigint;
  v_earliest timestamptz;
  v_retry_after integer;
BEGIN
  IF p_source_bucket_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_PUBLIC_SOURCE_BUCKET' USING ERRCODE = '22023';
  END IF;

  CASE p_policy
    WHEN 'entry-prepare' THEN
      v_limit := 60;
      v_window := interval '5 minutes';
    WHEN 'entry-start' THEN
      v_limit := 10;
      v_window := interval '5 minutes';
    WHEN 'generation' THEN
      v_limit := 10;
      v_window := interval '1 hour';
    ELSE
      RAISE EXCEPTION 'INVALID_PUBLIC_SOURCE_POLICY' USING ERRCODE = '22023';
  END CASE;

  -- The old wire cannot submit the preceding day's bucket. Keep it available
  -- for an immutable rollback version, but fail closed under one global
  -- per-policy allowance so changing the caller-selected bucket cannot reset
  -- the window.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'legacy-public-source-rate-limit-global:' || p_policy,
      0
    )
  );
  v_now := clock_timestamp();

  PERFORM cleanup_expired_public_source_rate_limits();

  SELECT count(*), min(consumed_at)
  INTO v_count, v_earliest
  FROM public_source_rate_limit_events
  WHERE policy = p_policy
    AND consumed_at > v_now - v_window;

  IF v_count >= v_limit THEN
    v_retry_after := greatest(
      1,
      ceil(extract(epoch FROM (v_earliest + v_window - v_now)))::integer
    );
    RETURN QUERY SELECT false, v_retry_after;
    RETURN;
  END IF;

  INSERT INTO public_source_rate_limit_events (
    source_bucket_hash,
    policy,
    consumed_at
  ) VALUES (
    p_source_bucket_hash,
    p_policy,
    v_now
  );

  RETURN QUERY SELECT true, NULL::integer;
END;
$$;

REVOKE ALL ON FUNCTION consume_public_source_rate_limit(text, text)
  FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc;
GRANT EXECUTE ON FUNCTION consume_public_source_rate_limit(text, text)
  TO context_runtime_svc, context_svc;

-- New Reviewer versions submit all three rotating buckets that can overlap a
-- transaction crossing midnight and the longest sliding window. The
-- legacy two-argument function above remains available only for
-- expand/contract compatibility with an old live version.
CREATE FUNCTION consume_public_source_rate_limit(
  p_current_source_bucket_hash text,
  p_previous_source_bucket_hash text,
  p_next_source_bucket_hash text,
  p_policy text
) RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_limit integer;
  v_window interval;
  v_now timestamptz;
  v_count bigint;
  v_earliest timestamptz;
  v_retry_after integer;
  v_bucket_hash text;
BEGIN
  IF p_current_source_bucket_hash !~ '^[0-9a-f]{64}$'
     OR p_previous_source_bucket_hash !~ '^[0-9a-f]{64}$'
     OR p_next_source_bucket_hash !~ '^[0-9a-f]{64}$'
     OR p_current_source_bucket_hash = p_previous_source_bucket_hash
     OR p_current_source_bucket_hash = p_next_source_bucket_hash
     OR p_previous_source_bucket_hash = p_next_source_bucket_hash THEN
    RAISE EXCEPTION 'INVALID_PUBLIC_SOURCE_BUCKET' USING ERRCODE = '22023';
  END IF;

  CASE p_policy
    WHEN 'entry-prepare' THEN
      v_limit := 60;
      v_window := interval '5 minutes';
    WHEN 'entry-start' THEN
      v_limit := 10;
      v_window := interval '5 minutes';
    WHEN 'generation' THEN
      v_limit := 10;
      v_window := interval '1 hour';
    ELSE
      RAISE EXCEPTION 'INVALID_PUBLIC_SOURCE_POLICY' USING ERRCODE = '22023';
  END CASE;

  -- Serialize with an in-flight immutable Reviewer that still uses the
  -- fail-closed legacy overload. The later contract migration removes this
  -- compatibility lock together with that overload.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'legacy-public-source-rate-limit-global:' || p_policy,
      0
    )
  );

  -- Every caller locks the same triple in one global order. Even if a
  -- post-midnight transaction commits before a delayed pre-midnight one, both
  -- count the same adjacent-day buckets and cannot both win.
  FOR v_bucket_hash IN
    SELECT bucket_hash
    FROM unnest(
      ARRAY[
        p_previous_source_bucket_hash,
        p_current_source_bucket_hash,
        p_next_source_bucket_hash
      ]
    ) AS bucket(bucket_hash)
    ORDER BY bucket_hash
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(v_bucket_hash || ':' || p_policy, 0)
    );
  END LOOP;

  v_now := clock_timestamp();

  PERFORM cleanup_expired_public_source_rate_limits();

  SELECT count(*), min(consumed_at)
  INTO v_count, v_earliest
  FROM public_source_rate_limit_events
  WHERE source_bucket_hash IN (
      p_previous_source_bucket_hash,
      p_current_source_bucket_hash,
      p_next_source_bucket_hash
    )
    AND policy = p_policy
    AND consumed_at > v_now - v_window;

  IF v_count >= v_limit THEN
    v_retry_after := greatest(
      1,
      ceil(extract(epoch FROM (v_earliest + v_window - v_now)))::integer
    );
    RETURN QUERY SELECT false, v_retry_after;
    RETURN;
  END IF;

  INSERT INTO public_source_rate_limit_events (
    source_bucket_hash,
    policy,
    consumed_at
  ) VALUES (
    p_current_source_bucket_hash,
    p_policy,
    v_now
  );

  RETURN QUERY SELECT true, NULL::integer;
END;
$$;

REVOKE ALL ON FUNCTION consume_public_source_rate_limit(text, text, text, text)
  FROM PUBLIC, context_runtime_svc, context_svc, console_control_svc, generation_svc;
GRANT EXECUTE ON FUNCTION consume_public_source_rate_limit(text, text, text, text)
  TO context_runtime_svc;
