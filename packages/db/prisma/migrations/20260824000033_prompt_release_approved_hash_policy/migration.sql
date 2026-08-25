-- The deterministic strict-$0 suite measures composition and grounding only;
-- it is not provider-behaviour evidence and therefore cannot establish that an
-- arbitrary Prompt body is good. The student release may qualify only the one
-- immutable Prompt content artifact reviewed with this release. A new hash
-- needs a later checked-in approval policy (or a separate provider-behaviour
-- evidence boundary) rather than inheriting this approval.

CREATE FUNCTION public.strict_zero_prompt_content_is_approved(
  requested_tenant_id uuid,
  requested_prompt_version_id uuid,
  requested_prompt_version_hash text,
  requested_action generation_action
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT
    requested_tenant_id = '00000000-0000-4000-8000-000000000101'::uuid
    AND requested_prompt_version_id = '00000000-0000-4000-8000-000000000136'::uuid
    AND requested_prompt_version_hash =
      'sha256:faf385e0cafc00a1b456dbedaa29828486d5fc2f2da8cb16a6debf871ae4fbeb'
    AND requested_action = 'GENERATE'::generation_action;
$function$;

COMMENT ON FUNCTION public.strict_zero_prompt_content_is_approved(
  uuid, uuid, text, generation_action
) IS 'Checked-in strict-$0 student Prompt content approval; deterministic reports do not measure provider behaviour.';

REVOKE ALL ON FUNCTION public.strict_zero_prompt_content_is_approved(
  uuid, uuid, text, generation_action
) FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

-- Snapshots copy immutable Prompt content into the runtime read plane. An
-- absent Prompt list is non-executable and therefore safe; every present entry
-- must be the exact reviewed artifact, including the content fields that
-- admission will compose without another Prompt-table lookup.
CREATE FUNCTION public.strict_zero_snapshot_prompts_are_approved(
  requested_tenant_id uuid,
  requested_payload jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT
    NOT (requested_payload ? 'promptVersions')
    OR (
      jsonb_typeof(requested_payload -> 'promptVersions') = 'array'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(requested_payload -> 'promptVersions') = 'array'
            THEN requested_payload -> 'promptVersions'
            ELSE '[]'::jsonb
          END
        ) AS prompt(entry)
        WHERE requested_tenant_id IS DISTINCT FROM
                '00000000-0000-4000-8000-000000000101'::uuid
           OR prompt.entry ->> 'id' IS DISTINCT FROM
                '00000000-0000-4000-8000-000000000136'
           OR prompt.entry ->> 'hash' IS DISTINCT FROM
                'sha256:faf385e0cafc00a1b456dbedaa29828486d5fc2f2da8cb16a6debf871ae4fbeb'
           OR prompt.entry ->> 'commandKind' IS DISTINCT FROM 'generate'
           OR prompt.entry ->> 'key' IS DISTINCT FROM 'review.generate.release'
           OR prompt.entry ->> 'body' IS DISTINCT FROM 'Use only supplied Assertions.'
           OR prompt.entry -> 'variables' IS DISTINCT FROM '["locale", "tone"]'::jsonb
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.strict_zero_snapshot_prompts_are_approved(
  uuid, jsonb
) FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

-- This migration is an upgrade boundary, not a retroactive rewrite. It takes
-- the same global release lock as publication, rejects unsafe current state,
-- and leaves all immutable Evaluation/Candidacy/Snapshot history untouched.
CREATE FUNCTION public.assert_strict_zero_prompt_executable_state()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM public.console_lock_prompt_release_set(NULL::uuid);

  IF EXISTS (
    SELECT 1
    FROM public.prompt_candidacy_decisions AS candidacy
    JOIN public.prompt_versions AS prompt
      ON prompt.id = candidacy.prompt_version_id
     AND prompt.tenant_id = candidacy.tenant_id
     AND prompt.content_hash = candidacy.prompt_version_hash
    WHERE candidacy.decision = 'CANDIDATE'
      AND prompt.status <> 'RETIRED'
      AND prompt.retired_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.prompt_candidacy_decisions AS retirement
        WHERE retirement.tenant_id = candidacy.tenant_id
          AND retirement.prompt_version_id = candidacy.prompt_version_id
          AND retirement.decision = 'RETIRED'
      )
      AND public.strict_zero_prompt_content_is_approved(
        prompt.tenant_id,
        prompt.id,
        prompt.content_hash,
        prompt.action
      ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'STRICT_ZERO_PROMPT_UPGRADE_CANDIDATE_NOT_APPROVED'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.prompt_deployments AS deployment
    JOIN public.prompt_versions AS prompt
      ON prompt.id = deployment.prompt_version_id
     AND prompt.tenant_id = deployment.tenant_id
     AND prompt.action = deployment.action
    WHERE public.strict_zero_prompt_content_is_approved(
      prompt.tenant_id,
      prompt.id,
      prompt.content_hash,
      prompt.action
    ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'STRICT_ZERO_PROMPT_UPGRADE_DEPLOYMENT_NOT_APPROVED'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.experiments AS experiment
    JOIN public.experiment_variants AS variant
      ON variant.experiment_id = experiment.id
     AND variant.tenant_id = experiment.tenant_id
    JOIN public.prompt_versions AS prompt
      ON prompt.id = variant.prompt_version_id
     AND prompt.tenant_id = variant.tenant_id
    WHERE experiment.status = 'RUNNING'
      AND public.strict_zero_prompt_content_is_approved(
        prompt.tenant_id,
        prompt.id,
        prompt.content_hash,
        prompt.action
      ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'STRICT_ZERO_PROMPT_UPGRADE_EXPERIMENT_NOT_APPROVED'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    WITH latest_active_location_snapshot AS (
      SELECT DISTINCT ON (snapshot.tenant_id, snapshot.location_id)
        snapshot.tenant_id,
        snapshot.payload
      FROM public.effective_configuration_snapshots AS snapshot
      JOIN public.tenants AS tenant
        ON tenant.id = snapshot.tenant_id
       AND tenant.status = 'ACTIVE'
      JOIN public.locations AS location
        ON location.id = snapshot.location_id
       AND location.tenant_id = snapshot.tenant_id
       AND location.status = 'ACTIVE'
      WHERE snapshot.schema_version = 2
        AND snapshot.payload ->> 'tenantId' = snapshot.tenant_id::text
        AND snapshot.payload ->> 'locationId' = snapshot.location_id::text
        AND snapshot.payload ->> 'snapshotId' = snapshot.id::text
      ORDER BY
        snapshot.tenant_id,
        snapshot.location_id,
        snapshot.created_at DESC,
        snapshot.id DESC
    )
    SELECT 1
    FROM latest_active_location_snapshot AS snapshot
    WHERE public.strict_zero_snapshot_prompts_are_approved(
      snapshot.tenant_id,
      snapshot.payload
    ) IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'STRICT_ZERO_PROMPT_UPGRADE_SNAPSHOT_NOT_APPROVED'
      USING ERRCODE = '23514';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_strict_zero_prompt_executable_state()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

-- The global advisory transaction lock is held until the migration commits.
-- Concurrent release mutations wait and then encounter the new row triggers.
SELECT public.assert_strict_zero_prompt_executable_state();

CREATE FUNCTION public.enforce_strict_zero_prompt_candidacy_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  IF NEW.decision = 'CANDIDATE'
     AND public.strict_zero_prompt_content_is_approved(
       NEW.tenant_id,
       NEW.prompt_version_id,
       NEW.prompt_version_hash,
       (
         SELECT prompt.action
         FROM public.prompt_versions AS prompt
         WHERE prompt.id = NEW.prompt_version_id
           AND prompt.tenant_id = NEW.tenant_id
           AND prompt.content_hash = NEW.prompt_version_hash
       )
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_candidacy_strict_zero_content_gate';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_strict_zero_prompt_candidacy_content()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE TRIGGER prompt_candidacy_decisions_01_strict_zero_content_gate
BEFORE INSERT ON prompt_candidacy_decisions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_strict_zero_prompt_candidacy_content();

CREATE FUNCTION public.enforce_strict_zero_prompt_deployment_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  target_action generation_action;
  target_hash text;
BEGIN
  SELECT prompt.action, prompt.content_hash
  INTO target_action, target_hash
  FROM public.prompt_versions AS prompt
  WHERE prompt.id = NEW.prompt_version_id
    AND prompt.tenant_id = NEW.tenant_id;

  IF NOT FOUND
     OR target_action IS DISTINCT FROM NEW.action
     OR NOT public.strict_zero_prompt_content_is_approved(
       NEW.tenant_id,
       NEW.prompt_version_id,
       target_hash,
       target_action
     ) THEN
    RAISE EXCEPTION 'STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_deployment_strict_zero_content_gate';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_strict_zero_prompt_deployment_content()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE TRIGGER prompt_deployments_01_strict_zero_content_gate
BEFORE INSERT OR UPDATE ON prompt_deployments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_strict_zero_prompt_deployment_content();

CREATE FUNCTION public.enforce_strict_zero_running_experiment_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  unapproved_count integer;
BEGIN
  IF NEW.status <> 'RUNNING'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'RUNNING') THEN
    RETURN NEW;
  END IF;

  SELECT count(*) FILTER (
    WHERE NOT public.strict_zero_prompt_content_is_approved(
      variant.tenant_id,
      variant.prompt_version_id,
      prompt.content_hash,
      prompt.action
    )
  )::integer
  INTO unapproved_count
  FROM public.experiment_variants AS variant
  JOIN public.prompt_versions AS prompt
    ON prompt.id = variant.prompt_version_id
   AND prompt.tenant_id = variant.tenant_id
  WHERE variant.experiment_id = NEW.id
    AND variant.tenant_id = NEW.tenant_id;

  IF unapproved_count <> 0 THEN
    RAISE EXCEPTION 'STRICT_ZERO_PROMPT_CONTENT_NOT_APPROVED'
      USING ERRCODE = '23514',
            CONSTRAINT = 'experiment_strict_zero_prompt_content_gate';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_strict_zero_running_experiment_content()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE TRIGGER experiments_running_01_strict_zero_content_gate
BEFORE INSERT OR UPDATE OF status ON experiments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_strict_zero_running_experiment_content();
