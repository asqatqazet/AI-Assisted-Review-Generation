-- Configuration publication is two-phase. An immutable Release captures the
-- exact Location snapshots exercised by a candidate BFF; only a CAS promotion
-- advances the live pointers. Restore is an append-only compensation event.

CREATE TYPE configuration_release_pointer_event_kind AS ENUM (
  'PROMOTE',
  'RESTORE'
);

CREATE TABLE configuration_releases (
  id uuid PRIMARY KEY,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT configuration_releases_actor_fk FOREIGN KEY (created_by)
    REFERENCES operators(id) ON DELETE RESTRICT
);

CREATE TABLE configuration_release_snapshots (
  release_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  CONSTRAINT configuration_release_snapshots_pk
    PRIMARY KEY (release_id, tenant_id, location_id),
  CONSTRAINT configuration_release_snapshots_release_fk
    FOREIGN KEY (release_id) REFERENCES configuration_releases(id)
    ON DELETE RESTRICT,
  CONSTRAINT configuration_release_snapshots_snapshot_fk
    FOREIGN KEY (snapshot_id, tenant_id, location_id)
    REFERENCES effective_configuration_snapshots(id, tenant_id, location_id)
    ON DELETE RESTRICT,
  CONSTRAINT configuration_release_snapshots_identity_unique
    UNIQUE (release_id, tenant_id, location_id, snapshot_id)
);

CREATE TABLE configuration_release_previous_pointers (
  release_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  previous_release_id uuid,
  previous_snapshot_id uuid,
  previous_revision bigint,
  CONSTRAINT configuration_release_previous_pointers_pk
    PRIMARY KEY (release_id, tenant_id, location_id),
  CONSTRAINT configuration_release_previous_pointers_release_fk
    FOREIGN KEY (release_id, tenant_id, location_id)
    REFERENCES configuration_release_snapshots(release_id, tenant_id, location_id)
    ON DELETE RESTRICT,
  CONSTRAINT configuration_release_previous_pointers_null_pair CHECK (
    (previous_release_id IS NULL) = (previous_snapshot_id IS NULL)
    AND (previous_release_id IS NULL) = (previous_revision IS NULL)
  ),
  CONSTRAINT configuration_release_previous_pointers_revision_positive CHECK (
    previous_revision IS NULL OR previous_revision > 0
  ),
  CONSTRAINT configuration_release_previous_pointers_target_fk
    FOREIGN KEY (
      previous_release_id, tenant_id, location_id, previous_snapshot_id
    ) REFERENCES configuration_release_snapshots(
      release_id, tenant_id, location_id, snapshot_id
    ) ON DELETE RESTRICT
);

CREATE TABLE configuration_live_pointers (
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  release_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT configuration_live_pointers_pk PRIMARY KEY (tenant_id, location_id),
  CONSTRAINT configuration_live_pointers_revision_positive CHECK (revision > 0),
  CONSTRAINT configuration_live_pointers_release_snapshot_fk
    FOREIGN KEY (release_id, tenant_id, location_id, snapshot_id)
    REFERENCES configuration_release_snapshots(
      release_id, tenant_id, location_id, snapshot_id
    ) ON DELETE RESTRICT
);

CREATE TABLE configuration_release_pointer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  previous_release_id uuid,
  previous_snapshot_id uuid,
  next_release_id uuid,
  next_snapshot_id uuid,
  kind configuration_release_pointer_event_kind NOT NULL,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT configuration_release_pointer_events_release_fk
    FOREIGN KEY (release_id) REFERENCES configuration_releases(id)
    ON DELETE RESTRICT,
  CONSTRAINT configuration_release_pointer_events_actor_fk
    FOREIGN KEY (actor_id) REFERENCES operators(id) ON DELETE RESTRICT,
  CONSTRAINT configuration_release_pointer_events_previous_null_pair CHECK (
    (previous_release_id IS NULL) = (previous_snapshot_id IS NULL)
  ),
  CONSTRAINT configuration_release_pointer_events_next_null_pair CHECK (
    (next_release_id IS NULL) = (next_snapshot_id IS NULL)
  ),
  CONSTRAINT configuration_release_pointer_events_direction CHECK (
    (kind = 'PROMOTE' AND next_release_id = release_id AND next_snapshot_id IS NOT NULL)
    OR
    (kind = 'RESTORE' AND previous_release_id = release_id AND previous_snapshot_id IS NOT NULL)
  )
);

CREATE INDEX configuration_release_pointer_events_scope_idx
  ON configuration_release_pointer_events(
    tenant_id, location_id, occurred_at DESC, id DESC
  );

CREATE TRIGGER configuration_releases_append_only
BEFORE UPDATE OR DELETE ON configuration_releases
FOR EACH ROW EXECUTE FUNCTION reject_published_configuration_mutation();
CREATE TRIGGER configuration_release_snapshots_append_only
BEFORE UPDATE OR DELETE ON configuration_release_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_published_configuration_mutation();
CREATE TRIGGER configuration_release_previous_pointers_append_only
BEFORE UPDATE OR DELETE ON configuration_release_previous_pointers
FOR EACH ROW EXECUTE FUNCTION reject_published_configuration_mutation();
CREATE TRIGGER configuration_release_pointer_events_append_only
BEFORE UPDATE OR DELETE ON configuration_release_pointer_events
FOR EACH ROW EXECUTE FUNCTION reject_published_configuration_mutation();

REVOKE ALL ON
  configuration_releases,
  configuration_release_snapshots,
  configuration_release_previous_pointers,
  configuration_live_pointers,
  configuration_release_pointer_events
FROM PUBLIC, context_svc, context_runtime_svc, console_control_svc, generation_svc;

-- Preserve the currently observable read plane when this migration expands an
-- existing database. Each historical live pointer gets an immutable one-scope
-- Release whose id is the selected snapshot id.
WITH latest AS (
  SELECT DISTINCT ON (snapshot.tenant_id, snapshot.location_id)
    snapshot.id AS snapshot_id,
    snapshot.tenant_id,
    snapshot.location_id
  FROM effective_configuration_snapshots AS snapshot
  JOIN tenants AS tenant
    ON tenant.id = snapshot.tenant_id
   AND tenant.status = 'ACTIVE'
  JOIN locations AS location
    ON location.id = snapshot.location_id
   AND location.tenant_id = snapshot.tenant_id
   AND location.status = 'ACTIVE'
  WHERE snapshot.schema_version = 2
    AND snapshot.payload ->> 'tenantId' = snapshot.tenant_id::text
    AND snapshot.payload ->> 'locationId' = snapshot.location_id::text
    AND snapshot.payload ->> 'snapshotId' = snapshot.id::text
    AND public.strict_zero_snapshot_prompts_are_approved(
      snapshot.tenant_id, snapshot.payload
    )
  ORDER BY
    snapshot.tenant_id,
    snapshot.location_id,
    snapshot.created_at DESC,
    snapshot.id DESC
)
INSERT INTO configuration_releases (id)
SELECT DISTINCT snapshot_id FROM latest;

WITH latest AS (
  SELECT DISTINCT ON (snapshot.tenant_id, snapshot.location_id)
    snapshot.id AS snapshot_id,
    snapshot.tenant_id,
    snapshot.location_id
  FROM effective_configuration_snapshots AS snapshot
  JOIN tenants AS tenant
    ON tenant.id = snapshot.tenant_id
   AND tenant.status = 'ACTIVE'
  JOIN locations AS location
    ON location.id = snapshot.location_id
   AND location.tenant_id = snapshot.tenant_id
   AND location.status = 'ACTIVE'
  WHERE snapshot.schema_version = 2
    AND snapshot.payload ->> 'tenantId' = snapshot.tenant_id::text
    AND snapshot.payload ->> 'locationId' = snapshot.location_id::text
    AND snapshot.payload ->> 'snapshotId' = snapshot.id::text
    AND public.strict_zero_snapshot_prompts_are_approved(
      snapshot.tenant_id, snapshot.payload
    )
  ORDER BY
    snapshot.tenant_id,
    snapshot.location_id,
    snapshot.created_at DESC,
    snapshot.id DESC
)
INSERT INTO configuration_release_snapshots (
  release_id, tenant_id, location_id, snapshot_id
)
SELECT snapshot_id, tenant_id, location_id, snapshot_id FROM latest;

INSERT INTO configuration_release_previous_pointers (
  release_id, tenant_id, location_id,
  previous_release_id, previous_snapshot_id, previous_revision
)
SELECT release_id, tenant_id, location_id, NULL, NULL, NULL
FROM configuration_release_snapshots;

INSERT INTO configuration_live_pointers (
  tenant_id, location_id, release_id, snapshot_id
)
SELECT tenant_id, location_id, release_id, snapshot_id
FROM configuration_release_snapshots;

INSERT INTO configuration_release_pointer_events (
  release_id, tenant_id, location_id,
  previous_release_id, previous_snapshot_id,
  next_release_id, next_snapshot_id, kind
)
SELECT
  release_id, tenant_id, location_id,
  NULL, NULL, release_id, snapshot_id, 'PROMOTE'
FROM configuration_release_snapshots;

-- Migration 33 validates the Prompt catalogue and the raw newest snapshot.
-- After this migration the data plane follows an explicit pointer, so retain
-- the catalogue checks and extend the public assertion to the actual live set.
ALTER FUNCTION public.assert_strict_zero_prompt_executable_state()
RENAME TO assert_strict_zero_prompt_catalog_state;

CREATE FUNCTION public.assert_strict_zero_prompt_executable_state()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM public.assert_strict_zero_prompt_catalog_state();
  IF EXISTS (
    SELECT 1
    FROM public.configuration_live_pointers AS pointer
    JOIN public.effective_configuration_snapshots AS snapshot
      ON snapshot.id = pointer.snapshot_id
     AND snapshot.tenant_id = pointer.tenant_id
     AND snapshot.location_id = pointer.location_id
    WHERE public.strict_zero_snapshot_prompts_are_approved(
      snapshot.tenant_id, snapshot.payload
    ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'STRICT_ZERO_PROMPT_LIVE_POINTER_NOT_APPROVED'
      USING ERRCODE = '23514';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_strict_zero_prompt_catalog_state()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;
REVOKE ALL ON FUNCTION public.assert_strict_zero_prompt_executable_state()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;
SELECT public.assert_strict_zero_prompt_executable_state();

CREATE FUNCTION public.resolve_configuration_snapshot(
  requested_tenant_id uuid,
  requested_location_id uuid,
  requested_release_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT CASE
    WHEN requested_release_id IS NULL THEN (
      SELECT pointer.snapshot_id
      FROM public.configuration_live_pointers AS pointer
      WHERE pointer.tenant_id = requested_tenant_id
        AND pointer.location_id = requested_location_id
    )
    ELSE (
      SELECT member.snapshot_id
      FROM public.configuration_release_snapshots AS member
      WHERE member.release_id = requested_release_id
        AND member.tenant_id = requested_tenant_id
        AND member.location_id = requested_location_id
    )
  END
  WHERE (
    (
      session_user IN ('context_svc', 'context_runtime_svc')
      AND requested_tenant_id = NULLIF(
        current_setting('app.tenant_id', true), ''
      )::uuid
      AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
    ) OR (
      session_user = 'console_control_svc'
      AND (
        public.review_operator_has_tenant_capability_privileged(
          requested_tenant_id, 'console:read'
        )
        OR public.review_operator_has_tenant_capability_privileged(
          requested_tenant_id, 'tenant:configure'
        )
        OR public.review_operator_has_platform_capability_privileged(
          'platform:admin'
        )
      )
    ) OR session_user = (
      SELECT pg_get_userbyid(class.relowner)
      FROM pg_catalog.pg_class AS class
      WHERE class.oid = 'public.configuration_live_pointers'::regclass
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.resolve_configuration_snapshot(uuid, uuid, uuid)
FROM PUBLIC, generation_svc;
GRANT EXECUTE ON FUNCTION public.resolve_configuration_snapshot(uuid, uuid, uuid)
TO context_svc, context_runtime_svc, console_control_svc;

CREATE FUNCTION public.promote_configuration_release(
  requested_release_id uuid,
  requested_actor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  member_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('configuration-live-pointer', 340034));

  SELECT count(*)::integer INTO member_count
  FROM public.configuration_release_snapshots AS member
  WHERE member.release_id = requested_release_id;
  IF member_count = 0 AND NOT EXISTS (
    SELECT 1 FROM public.configuration_releases
    WHERE id = requested_release_id
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF member_count = 0 THEN
    RETURN true;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.configuration_release_snapshots AS member
    JOIN public.effective_configuration_snapshots AS snapshot
      ON snapshot.id = member.snapshot_id
     AND snapshot.tenant_id = member.tenant_id
     AND snapshot.location_id = member.location_id
    WHERE member.release_id = requested_release_id
      AND public.strict_zero_snapshot_prompts_are_approved(
        snapshot.tenant_id, snapshot.payload
      ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_PROMPT_NOT_APPROVED'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.configuration_release_snapshots AS member
    LEFT JOIN public.configuration_live_pointers AS live
      ON live.tenant_id = member.tenant_id
     AND live.location_id = member.location_id
    JOIN public.configuration_release_previous_pointers AS previous
      ON previous.release_id = member.release_id
     AND previous.tenant_id = member.tenant_id
     AND previous.location_id = member.location_id
    WHERE member.release_id = requested_release_id
      AND NOT (
        live.release_id IS NOT DISTINCT FROM member.release_id
        AND live.snapshot_id IS NOT DISTINCT FROM member.snapshot_id
        AND live.revision IS NOT DISTINCT FROM COALESCE(
          previous.previous_revision + 1, 1
        )
      )
  ) THEN
    RETURN true;
  END IF;

  -- A Release is a one-shot CAS token. Once it has emitted a promotion event,
  -- it may only be retried while that exact promoted revision is still live.
  -- This also closes the revision-reset ABA when the previous pointer was NULL.
  IF EXISTS (
    SELECT 1
    FROM public.configuration_release_pointer_events AS event
    WHERE event.release_id = requested_release_id
      AND event.kind = 'PROMOTE'
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_POINTER_CONFLICT' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.configuration_release_snapshots AS member
    JOIN public.configuration_release_previous_pointers AS previous
      ON previous.release_id = member.release_id
     AND previous.tenant_id = member.tenant_id
     AND previous.location_id = member.location_id
    LEFT JOIN public.configuration_live_pointers AS live
      ON live.tenant_id = member.tenant_id
     AND live.location_id = member.location_id
    WHERE member.release_id = requested_release_id
      AND NOT (
        live.release_id IS NOT DISTINCT FROM previous.previous_release_id
        AND live.snapshot_id IS NOT DISTINCT FROM previous.previous_snapshot_id
        AND live.revision IS NOT DISTINCT FROM previous.previous_revision
      )
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_POINTER_CONFLICT' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.configuration_release_pointer_events (
    release_id, tenant_id, location_id,
    previous_release_id, previous_snapshot_id,
    next_release_id, next_snapshot_id, kind, actor_id
  )
  SELECT
    member.release_id, member.tenant_id, member.location_id,
    previous.previous_release_id, previous.previous_snapshot_id,
    member.release_id, member.snapshot_id, 'PROMOTE', requested_actor_id
  FROM public.configuration_release_snapshots AS member
  JOIN public.configuration_release_previous_pointers AS previous
    ON previous.release_id = member.release_id
   AND previous.tenant_id = member.tenant_id
   AND previous.location_id = member.location_id
  WHERE member.release_id = requested_release_id;

  INSERT INTO public.configuration_live_pointers (
    tenant_id, location_id, release_id, snapshot_id
  )
  SELECT tenant_id, location_id, release_id, snapshot_id
  FROM public.configuration_release_snapshots
  WHERE release_id = requested_release_id
  ON CONFLICT (tenant_id, location_id) DO UPDATE SET
    release_id = EXCLUDED.release_id,
    snapshot_id = EXCLUDED.snapshot_id,
    revision = configuration_live_pointers.revision + 1,
    updated_at = clock_timestamp();
  RETURN true;
END
$function$;

CREATE FUNCTION public.register_configuration_release(
  requested_release_id uuid,
  requested_snapshot_ids uuid[],
  requested_actor_id uuid,
  promote_immediately boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  requested_count integer;
  matched_count integer;
  matched_scope_count integer;
  inserted_release_id uuid;
  bound_operator_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('configuration-live-pointer', 340034));
  requested_count := cardinality(requested_snapshot_ids);
  IF requested_count IS NULL OR requested_release_id IS NULL THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_EMPTY' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT snapshot_id) FROM unnest(requested_snapshot_ids) AS snapshot_id)
     <> requested_count THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_DUPLICATE_SNAPSHOT' USING ERRCODE = '22023';
  END IF;

  IF session_user = 'console_control_svc' THEN
    bound_operator_id := public.review_current_bound_console_operator();
    IF bound_operator_id IS NULL
       OR requested_actor_id IS DISTINCT FROM bound_operator_id THEN
      RAISE EXCEPTION 'CONFIGURATION_RELEASE_ACTOR_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
    -- Missing and foreign Snapshot ids deliberately collapse to one result.
    -- Capability is checked before Prompt content so the function is not an
    -- approval/existence oracle across Tenants.
    SELECT count(*)::integer INTO matched_count
    FROM public.effective_configuration_snapshots AS snapshot
    WHERE snapshot.id = ANY(requested_snapshot_ids)
      AND (
        public.review_operator_has_tenant_capability_privileged(
          snapshot.tenant_id, 'tenant:configure'
        )
        OR public.review_operator_has_platform_capability_privileged(
          'platform:admin'
        )
      );
    IF matched_count <> requested_count THEN
      RAISE EXCEPTION 'CONFIGURATION_RELEASE_SCOPE_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT count(*)::integer INTO matched_count
    FROM public.effective_configuration_snapshots AS snapshot
    WHERE snapshot.id = ANY(requested_snapshot_ids);
    IF matched_count <> requested_count THEN
      RAISE EXCEPTION 'CONFIGURATION_RELEASE_SNAPSHOT_NOT_FOUND'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT count(DISTINCT (snapshot.tenant_id, snapshot.location_id))::integer
  INTO matched_scope_count
  FROM public.effective_configuration_snapshots AS snapshot
  WHERE snapshot.id = ANY(requested_snapshot_ids);
  IF matched_scope_count <> requested_count THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_DUPLICATE_SCOPE'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.effective_configuration_snapshots AS snapshot
    WHERE snapshot.id = ANY(requested_snapshot_ids)
      AND public.strict_zero_snapshot_prompts_are_approved(
        snapshot.tenant_id, snapshot.payload
      ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_PROMPT_NOT_APPROVED'
      USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.configuration_releases (id, created_by)
  VALUES (requested_release_id, requested_actor_id)
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO inserted_release_id;

  IF inserted_release_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.configuration_releases AS release
      WHERE release.id = requested_release_id
        AND release.created_by IS DISTINCT FROM requested_actor_id
    ) OR (
      SELECT count(*)
      FROM public.configuration_release_snapshots AS member
      WHERE member.release_id = requested_release_id
    ) <> requested_count OR EXISTS (
      SELECT 1
      FROM public.configuration_release_snapshots AS member
      WHERE member.release_id = requested_release_id
        AND NOT (member.snapshot_id = ANY(requested_snapshot_ids))
    ) THEN
      RAISE EXCEPTION 'CONFIGURATION_RELEASE_ID_REUSED' USING ERRCODE = '23505';
    END IF;
    IF promote_immediately THEN
      PERFORM public.promote_configuration_release(
        requested_release_id, requested_actor_id
      );
    END IF;
    RETURN true;
  END IF;

  INSERT INTO public.configuration_release_snapshots (
    release_id, tenant_id, location_id, snapshot_id
  )
  SELECT requested_release_id, snapshot.tenant_id, snapshot.location_id, snapshot.id
  FROM public.effective_configuration_snapshots AS snapshot
  WHERE snapshot.id = ANY(requested_snapshot_ids)
  ;

  INSERT INTO public.configuration_release_previous_pointers (
    release_id, tenant_id, location_id,
    previous_release_id, previous_snapshot_id, previous_revision
  )
  SELECT
    member.release_id, member.tenant_id, member.location_id,
    live.release_id, live.snapshot_id, live.revision
  FROM public.configuration_release_snapshots AS member
  LEFT JOIN public.configuration_live_pointers AS live
    ON live.tenant_id = member.tenant_id
   AND live.location_id = member.location_id
  WHERE member.release_id = requested_release_id
  ON CONFLICT (release_id, tenant_id, location_id) DO NOTHING;

  IF promote_immediately THEN
    PERFORM public.promote_configuration_release(
      requested_release_id, requested_actor_id
    );
  END IF;
  RETURN true;
END
$function$;

CREATE FUNCTION public.restore_configuration_release(
  requested_release_id uuid,
  requested_actor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('configuration-live-pointer', 340034));
  IF NOT EXISTS (
    SELECT 1 FROM public.configuration_releases
    WHERE id = requested_release_id
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_NOT_LIVE' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.configuration_release_snapshots
    WHERE release_id = requested_release_id
  ) THEN
    RETURN true;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.configuration_release_snapshots AS member
    JOIN public.configuration_release_previous_pointers AS previous
      ON previous.release_id = member.release_id
     AND previous.tenant_id = member.tenant_id
     AND previous.location_id = member.location_id
    LEFT JOIN public.configuration_live_pointers AS live
      ON live.tenant_id = member.tenant_id
     AND live.location_id = member.location_id
    WHERE member.release_id = requested_release_id
      AND (
        live.release_id IS DISTINCT FROM member.release_id
        OR live.snapshot_id IS DISTINCT FROM member.snapshot_id
        OR live.revision IS DISTINCT FROM COALESCE(
          previous.previous_revision + 1, 1
        )
      )
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_NOT_LIVE' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.configuration_release_previous_pointers AS previous
    JOIN public.effective_configuration_snapshots AS snapshot
      ON snapshot.id = previous.previous_snapshot_id
     AND snapshot.tenant_id = previous.tenant_id
     AND snapshot.location_id = previous.location_id
    WHERE previous.release_id = requested_release_id
      AND public.strict_zero_snapshot_prompts_are_approved(
        snapshot.tenant_id, snapshot.payload
      ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_RESTORE_PROMPT_NOT_APPROVED'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.configuration_release_pointer_events (
    release_id, tenant_id, location_id,
    previous_release_id, previous_snapshot_id,
    next_release_id, next_snapshot_id, kind, actor_id
  )
  SELECT
    member.release_id, member.tenant_id, member.location_id,
    member.release_id, member.snapshot_id,
    previous.previous_release_id, previous.previous_snapshot_id,
    'RESTORE', requested_actor_id
  FROM public.configuration_release_snapshots AS member
  JOIN public.configuration_release_previous_pointers AS previous
    ON previous.release_id = member.release_id
   AND previous.tenant_id = member.tenant_id
   AND previous.location_id = member.location_id
  WHERE member.release_id = requested_release_id;

  DELETE FROM public.configuration_live_pointers AS live
  USING public.configuration_release_previous_pointers AS previous
  WHERE previous.release_id = requested_release_id
    AND previous.previous_release_id IS NULL
    AND live.tenant_id = previous.tenant_id
    AND live.location_id = previous.location_id;

  INSERT INTO public.configuration_live_pointers (
    tenant_id, location_id, release_id, snapshot_id
  )
  SELECT
    tenant_id, location_id, previous_release_id, previous_snapshot_id
  FROM public.configuration_release_previous_pointers
  WHERE release_id = requested_release_id
    AND previous_release_id IS NOT NULL
  ON CONFLICT (tenant_id, location_id) DO UPDATE SET
    release_id = EXCLUDED.release_id,
    snapshot_id = EXCLUDED.snapshot_id,
    revision = configuration_live_pointers.revision + 1,
    updated_at = clock_timestamp();
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.register_configuration_release(uuid, uuid[], uuid, boolean)
FROM PUBLIC, context_svc, context_runtime_svc, generation_svc;
GRANT EXECUTE ON FUNCTION public.register_configuration_release(uuid, uuid[], uuid, boolean)
TO console_control_svc;
REVOKE ALL ON FUNCTION public.promote_configuration_release(uuid, uuid)
FROM PUBLIC, context_svc, context_runtime_svc, console_control_svc, generation_svc;
REVOKE ALL ON FUNCTION public.restore_configuration_release(uuid, uuid)
FROM PUBLIC, context_svc, context_runtime_svc, console_control_svc, generation_svc;

-- Rollback creates a fresh activation Release rather than rewriting the
-- historical target's captured previous pointers. The target membership stays
-- immutable; the activation captures the current pointers and is itself
-- compensatable if the rollback smoke fails.
CREATE FUNCTION public.activate_configuration_release(
  activation_release_id uuid,
  target_release_id uuid,
  requested_actor_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  target_snapshot_ids uuid[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.configuration_releases
    WHERE id = target_release_id
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_RELEASE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(
    array_agg(snapshot_id ORDER BY tenant_id, location_id),
    ARRAY[]::uuid[]
  )
  INTO target_snapshot_ids
  FROM public.configuration_release_snapshots
  WHERE release_id = target_release_id;
  PERFORM public.register_configuration_release(
    activation_release_id, target_snapshot_ids, requested_actor_id, false
  );
  PERFORM public.promote_configuration_release(
    activation_release_id, requested_actor_id
  );
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.activate_configuration_release(uuid, uuid, uuid)
FROM PUBLIC, context_svc, context_runtime_svc, console_control_svc, generation_svc;

ALTER TABLE entry_challenges
  ADD COLUMN configuration_release_id uuid,
  ADD COLUMN configuration_snapshot_id uuid,
  ADD CONSTRAINT entry_challenges_configuration_release_snapshot_null_pair CHECK (
    (configuration_release_id IS NULL) = (configuration_snapshot_id IS NULL)
  ),
  ADD CONSTRAINT entry_challenges_configuration_release_snapshot_fk
    FOREIGN KEY (
      configuration_release_id, tenant_id, location_id, configuration_snapshot_id
    ) REFERENCES configuration_release_snapshots(
      release_id, tenant_id, location_id, snapshot_id
    ) ON DELETE RESTRICT;

ALTER TABLE review_sessions
  ADD COLUMN configuration_snapshot_id uuid,
  ADD CONSTRAINT review_sessions_configuration_snapshot_fk
    FOREIGN KEY (configuration_snapshot_id, tenant_id, location_id)
    REFERENCES effective_configuration_snapshots(id, tenant_id, location_id)
    ON DELETE RESTRICT;

-- Preserve historical provenance only where persisted execution evidence is
-- unambiguous. Never label a closed legacy Session with the migration-time
-- live pointer merely because the original binding predates this column.
DO $block$
BEGIN
  IF EXISTS (
    WITH evidence AS (
      SELECT tenant_id, location_id, review_session_id, snapshot_id
      FROM public.generation_batches
      UNION
      SELECT tenant_id, location_id, review_session_id, snapshot_id
      FROM public.budget_reservations
      UNION
      SELECT tenant_id, location_id, review_session_id, snapshot_id
      FROM public.generations
    )
    SELECT 1
    FROM evidence
    GROUP BY tenant_id, location_id, review_session_id
    HAVING count(DISTINCT evidence.snapshot_id) > 1
  ) THEN
    RAISE EXCEPTION 'REVIEW_SESSION_CONFIGURATION_SNAPSHOT_AMBIGUOUS'
      USING ERRCODE = '23514';
  END IF;
END
$block$;

WITH evidence AS (
  SELECT tenant_id, location_id, review_session_id, snapshot_id
  FROM public.generation_batches
  UNION
  SELECT tenant_id, location_id, review_session_id, snapshot_id
  FROM public.budget_reservations
  UNION
  SELECT tenant_id, location_id, review_session_id, snapshot_id
  FROM public.generations
), resolved AS (
  SELECT
    evidence.tenant_id,
    evidence.location_id,
    evidence.review_session_id,
    max(evidence.snapshot_id::text)::uuid AS snapshot_id
  FROM evidence
  GROUP BY evidence.tenant_id, evidence.location_id, evidence.review_session_id
  HAVING count(DISTINCT evidence.snapshot_id) = 1
)
UPDATE public.review_sessions AS session
SET configuration_snapshot_id = resolved.snapshot_id
FROM resolved
WHERE session.id = resolved.review_session_id
  AND session.tenant_id = resolved.tenant_id
  AND session.location_id = resolved.location_id;

UPDATE public.review_sessions AS session
SET configuration_snapshot_id = live.snapshot_id
FROM public.configuration_live_pointers AS live
WHERE live.tenant_id = session.tenant_id
  AND live.location_id = session.location_id
  AND session.status = 'OPEN'
  AND session.configuration_snapshot_id IS NULL;

DO $block$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.review_sessions
    WHERE status = 'OPEN' AND configuration_snapshot_id IS NULL
  ) THEN
    RAISE EXCEPTION 'OPEN_REVIEW_SESSION_CONFIGURATION_SNAPSHOT_UNKNOWN'
      USING ERRCODE = '23514';
  END IF;
END
$block$;

-- Immutable pre-expand Context versions omit the new column when they create a
-- Review Session. Bind those inserts to the then-live pointer once, before the
-- row is visible; later pointer promotions cannot make the session drift.
CREATE FUNCTION public.bind_legacy_review_session_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NEW.configuration_snapshot_id IS NULL THEN
    SELECT pointer.snapshot_id
    INTO NEW.configuration_snapshot_id
    FROM public.configuration_live_pointers AS pointer
    WHERE pointer.tenant_id = NEW.tenant_id
      AND pointer.location_id = NEW.location_id;
  END IF;
  IF NEW.configuration_snapshot_id IS NULL THEN
    RAISE EXCEPTION 'REVIEW_SESSION_CONFIGURATION_SNAPSHOT_REQUIRED'
      USING ERRCODE = '23502';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.bind_legacy_review_session_snapshot()
FROM PUBLIC, context_svc, context_runtime_svc, console_control_svc, generation_svc;
CREATE TRIGGER bind_legacy_review_session_snapshot
BEFORE INSERT ON review_sessions
FOR EACH ROW
EXECUTE FUNCTION public.bind_legacy_review_session_snapshot();

-- New Reviewer code may read a staged snapshot selected by its release pin.
-- The retained immutable Context version remains bounded to the current live
-- pointer, so a rollback never observes a newer staged snapshot by ordering.
DROP POLICY operator_or_service_read_policy
ON effective_configuration_snapshots;
CREATE POLICY operator_or_service_read_policy
ON effective_configuration_snapshots FOR SELECT
USING (
  (
    current_user = 'context_runtime_svc'
    AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ) OR (
    current_user = 'context_svc'
    AND NULLIF(current_setting('app.operator_id', true), '') IS NULL
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND id = public.resolve_configuration_snapshot(
      tenant_id, location_id, NULL::uuid
    )
  ) OR review_operator_has_tenant_capability(tenant_id, 'console:read')
);

CREATE FUNCTION public.prepare_entry_challenge_for_release(
  p_tenant_slug varchar,
  p_location_slug varchar,
  p_invitation_token_hash varchar,
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar,
  p_table_ref_hash varchar,
  p_expires_at timestamptz,
  p_configuration_release_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
  v_location_id uuid;
  v_release_id uuid;
  v_snapshot_id uuid;
  v_entry_mode_key varchar(80);
  v_requires_verification boolean;
  v_invitation_token_id uuid;
  v_visit_id uuid;
BEGIN
  SELECT
    tenant.id,
    location.id,
    member.release_id,
    snapshot.id,
    snapshot.payload #>> '{settings,entryMode}',
    (snapshot.payload #>> '{settings,requireVerifiedExperience}')::boolean
  INTO
    v_tenant_id,
    v_location_id,
    v_release_id,
    v_snapshot_id,
    v_entry_mode_key,
    v_requires_verification
  FROM public.tenants AS tenant
  JOIN public.locations AS location ON location.tenant_id = tenant.id
  JOIN public.configuration_release_snapshots AS member
    ON member.tenant_id = tenant.id
   AND member.location_id = location.id
  JOIN public.effective_configuration_snapshots AS snapshot
    ON snapshot.id = member.snapshot_id
   AND snapshot.tenant_id = member.tenant_id
   AND snapshot.location_id = member.location_id
  JOIN public.entry_mode_definitions AS mode
    ON mode.key = snapshot.payload #>> '{settings,entryMode}'
  WHERE tenant.slug = p_tenant_slug
    AND tenant.status = 'ACTIVE'
    AND location.slug = p_location_slug
    AND location.status = 'ACTIVE'
    AND mode.status = 'ACTIVE'
    AND member.release_id = COALESCE(
      p_configuration_release_id,
      (
        SELECT live.release_id
        FROM public.configuration_live_pointers AS live
        WHERE live.tenant_id = tenant.id
          AND live.location_id = location.id
      )
    )
    AND snapshot.schema_version = 2
    AND snapshot.payload ->> 'tenantId' = tenant.id::text
    AND snapshot.payload ->> 'locationId' = location.id::text
    AND snapshot.payload ->> 'snapshotId' = snapshot.id::text
    AND jsonb_typeof(
      snapshot.payload #> '{settings,requireVerifiedExperience}'
    ) = 'boolean'
  LIMIT 1;

  IF v_tenant_id IS NULL OR p_expires_at <= clock_timestamp() THEN
    RETURN false;
  END IF;
  IF p_invitation_token_hash IS NULL THEN
    IF v_entry_mode_key = 'invite' OR v_requires_verification THEN
      RETURN false;
    END IF;
  ELSE
    IF v_entry_mode_key = 'open-qr' THEN
      RETURN false;
    END IF;
    SELECT token.id, token.visit_id
    INTO v_invitation_token_id, v_visit_id
    FROM public.invitation_tokens AS token
    WHERE token.token_hash = p_invitation_token_hash
      AND token.tenant_id = v_tenant_id
      AND token.location_id = v_location_id
      AND token.consumed_at IS NULL
      AND token.expires_at > clock_timestamp()
    LIMIT 1;
    IF v_invitation_token_id IS NULL OR
       (v_requires_verification AND v_visit_id IS NULL) THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO public.entry_challenges (
    tenant_id, location_id, invitation_token_id, visit_id, entry_mode_key,
    route_handle_hash, browser_capability_hash, table_ref_hash,
    verification_required, expires_at,
    configuration_release_id, configuration_snapshot_id
  ) VALUES (
    v_tenant_id, v_location_id, v_invitation_token_id, v_visit_id,
    v_entry_mode_key, p_route_handle_hash, p_browser_capability_hash,
    p_table_ref_hash,
    v_requires_verification AND v_invitation_token_id IS NOT NULL,
    p_expires_at, v_release_id, v_snapshot_id
  );
  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RETURN false;
END
$function$;

REVOKE ALL ON FUNCTION public.prepare_entry_challenge_for_release(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz, uuid
) FROM PUBLIC, context_svc, context_runtime_svc, console_control_svc, generation_svc;

CREATE OR REPLACE FUNCTION public.prepare_entry_challenge(
  p_tenant_slug varchar,
  p_location_slug varchar,
  p_invitation_token_hash varchar,
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar,
  p_table_ref_hash varchar,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT public.prepare_entry_challenge_for_release(
    p_tenant_slug, p_location_slug, p_invitation_token_hash,
    p_route_handle_hash, p_browser_capability_hash, p_table_ref_hash,
    p_expires_at, NULL::uuid
  );
$function$;

REVOKE ALL ON FUNCTION public.prepare_entry_challenge(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz
) FROM PUBLIC, console_control_svc, generation_svc;
GRANT EXECUTE ON FUNCTION public.prepare_entry_challenge(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz
) TO context_svc, context_runtime_svc;

CREATE FUNCTION public.prepare_entry_challenge(
  p_tenant_slug varchar,
  p_location_slug varchar,
  p_invitation_token_hash varchar,
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar,
  p_table_ref_hash varchar,
  p_expires_at timestamptz,
  p_configuration_release_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT public.prepare_entry_challenge_for_release(
    p_tenant_slug, p_location_slug, p_invitation_token_hash,
    p_route_handle_hash, p_browser_capability_hash, p_table_ref_hash,
    p_expires_at, p_configuration_release_id
  );
$function$;

REVOKE ALL ON FUNCTION public.prepare_entry_challenge(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz, uuid
) FROM PUBLIC, context_svc, console_control_svc, generation_svc;
GRANT EXECUTE ON FUNCTION public.prepare_entry_challenge(
  varchar, varchar, varchar, varchar, varchar, varchar, timestamptz, uuid
) TO context_runtime_svc;

DROP FUNCTION public.resolve_live_entry_challenge(varchar, varchar);
CREATE FUNCTION public.resolve_live_entry_challenge(
  p_route_handle_hash varchar,
  p_browser_capability_hash varchar
)
RETURNS TABLE (
  challenge_id uuid,
  tenant_id uuid,
  location_id uuid,
  invitation_token_id uuid,
  visit_id uuid,
  entry_mode_key varchar,
  verification_required boolean,
  provisional_rating integer,
  provisional_action generation_action,
  verification_failed_at timestamptz,
  configuration_release_id uuid,
  configuration_snapshot_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT
    challenge.id,
    challenge.tenant_id,
    challenge.location_id,
    challenge.invitation_token_id,
    challenge.visit_id,
    challenge.entry_mode_key,
    challenge.verification_required,
    challenge.provisional_rating,
    challenge.provisional_action,
    challenge.verification_failed_at,
    challenge.configuration_release_id,
    challenge.configuration_snapshot_id
  FROM public.entry_challenges AS challenge
  LEFT JOIN public.invitation_tokens AS token
    ON token.id = challenge.invitation_token_id
   AND token.tenant_id = challenge.tenant_id
   AND token.location_id = challenge.location_id
  WHERE challenge.route_handle_hash = p_route_handle_hash
    AND challenge.browser_capability_hash = p_browser_capability_hash
    AND challenge.consumed_at IS NULL
    AND challenge.expires_at > clock_timestamp()
    AND (
      challenge.invitation_token_id IS NULL OR
      (token.consumed_at IS NULL AND token.expires_at > clock_timestamp())
    )
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.resolve_live_entry_challenge(varchar, varchar)
FROM PUBLIC, console_control_svc, generation_svc;
GRANT EXECUTE ON FUNCTION public.resolve_live_entry_challenge(varchar, varchar)
TO context_svc, context_runtime_svc;

ALTER TABLE configuration_audit_events
  ADD COLUMN configuration_release_id uuid,
  ADD CONSTRAINT configuration_audit_events_release_fk
    FOREIGN KEY (configuration_release_id) REFERENCES configuration_releases(id)
    ON DELETE RESTRICT;
ALTER TABLE platform_configuration_publications
  ADD COLUMN configuration_release_id uuid,
  ADD CONSTRAINT platform_configuration_publications_release_fk
    FOREIGN KEY (configuration_release_id) REFERENCES configuration_releases(id)
    ON DELETE RESTRICT;
