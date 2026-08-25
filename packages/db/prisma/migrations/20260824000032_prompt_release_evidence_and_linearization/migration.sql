-- Prompt release evidence must be independently replayable, and publication
-- must observe one stable release state. Summary-only expand-phase rows remain
-- immutable audit facts, but cannot qualify a Prompt without a complete report.

ALTER TABLE prompt_evaluation_results
  ADD COLUMN suite_name varchar(200),
  ADD COLUMN suite_manifest_hash varchar(128),
  ADD COLUMN report_document jsonb,
  ADD COLUMN report_canonical text;

ALTER TABLE prompt_evaluation_results
  ADD CONSTRAINT prompt_evaluation_results_suite_name_shape CHECK (
    suite_name IS NULL
    OR (suite_name = btrim(suite_name) AND length(suite_name) BETWEEN 1 AND 200)
  ),
  ADD CONSTRAINT prompt_evaluation_results_suite_manifest_hash_shape CHECK (
    suite_manifest_hash IS NULL
    OR suite_manifest_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT prompt_evaluation_results_report_document_shape CHECK (
    report_document IS NULL OR jsonb_typeof(report_document) = 'object'
  ),
  ADD CONSTRAINT prompt_evaluation_results_complete_columns CHECK (
    suite_name IS NOT NULL
    AND suite_manifest_hash IS NOT NULL
    AND report_document IS NOT NULL
    AND report_canonical IS NOT NULL
    AND evaluator_release_sha IS NOT NULL
    AND evaluator_release_sha ~ '^[0-9a-f]{40}$'
    AND evaluator_release_sha <> repeat('0', 40)
  ) NOT VALID;

-- A strict re-evaluation may append a new Candidate fact for the same Prompt.
-- Retirement remains unique and permanently dominates every Candidate.
ALTER TABLE prompt_candidacy_decisions
  DROP CONSTRAINT prompt_candidacy_decisions_one_kind_per_prompt;

CREATE UNIQUE INDEX prompt_candidacy_decisions_candidate_evidence_unique
  ON prompt_candidacy_decisions (
    tenant_id,
    prompt_version_id,
    evaluation_result_id
  )
  WHERE decision = 'CANDIDATE';

CREATE UNIQUE INDEX prompt_candidacy_decisions_one_retirement_per_prompt
  ON prompt_candidacy_decisions (tenant_id, prompt_version_id)
  WHERE decision = 'RETIRED';

CREATE INDEX prompt_evaluation_results_release_latest_idx
  ON prompt_evaluation_results (
    tenant_id,
    prompt_version_id,
    evaluated_at DESC,
    recorded_at DESC,
    id DESC
  );

-- Every Prompt release participant obtains advisory locks through this one
-- namespace. The global shared lock preserves cross-Tenant concurrency while
-- allowing a Platform publication to take an exclusive all-Tenant barrier.
CREATE FUNCTION public.acquire_prompt_release_advisory_lock(
  lock_scope text,
  lock_tenant_id uuid,
  lock_subject_id uuid,
  shared_lock boolean
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  lock_identity text;
  lock_key bigint;
BEGIN
  lock_identity := CASE lock_scope
    WHEN 'global' THEN
      CASE
        WHEN lock_tenant_id IS NULL AND lock_subject_id IS NULL
        THEN 'prompt-release:global'
      END
    WHEN 'tenant' THEN
      CASE
        WHEN lock_tenant_id IS NOT NULL AND lock_subject_id IS NULL
        THEN 'prompt-release:tenant:' || lock_tenant_id::text
      END
    WHEN 'prompt' THEN
      CASE
        WHEN lock_tenant_id IS NOT NULL AND lock_subject_id IS NOT NULL
        THEN 'prompt-release:prompt:' || lock_tenant_id::text || ':' ||
             lock_subject_id::text
      END
    WHEN 'experiment' THEN
      CASE
        WHEN lock_tenant_id IS NOT NULL AND lock_subject_id IS NOT NULL
        THEN 'prompt-release:experiment:' || lock_tenant_id::text || ':' ||
             lock_subject_id::text
      END
  END;

  IF lock_identity IS NULL THEN
    RAISE EXCEPTION 'PROMPT_RELEASE_LOCK_IDENTITY_INVALID'
      USING ERRCODE = '22023';
  END IF;

  lock_key := hashtextextended(lock_identity, 752840032);
  IF shared_lock THEN
    PERFORM pg_advisory_xact_lock_shared(lock_key);
  ELSE
    PERFORM pg_advisory_xact_lock(lock_key);
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.acquire_prompt_release_advisory_lock(
  text, uuid, uuid, boolean
) FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE FUNCTION public.lock_prompt_evaluation_release_identity()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM public.acquire_prompt_release_advisory_lock(
    'global', NULL, NULL, true
  );
  PERFORM public.acquire_prompt_release_advisory_lock(
    'prompt', NEW.tenant_id, NEW.prompt_version_id, false
  );
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.lock_prompt_evaluation_release_identity()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE TRIGGER prompt_evaluation_results_00_release_lock
BEFORE INSERT ON prompt_evaluation_results
FOR EACH ROW
EXECUTE FUNCTION public.lock_prompt_evaluation_release_identity();

CREATE FUNCTION public.lock_prompt_candidacy_release_identity()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM public.acquire_prompt_release_advisory_lock(
    'global', NULL, NULL, true
  );
  PERFORM public.acquire_prompt_release_advisory_lock(
    'prompt', NEW.tenant_id, NEW.prompt_version_id, false
  );
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.lock_prompt_candidacy_release_identity()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE TRIGGER prompt_candidacy_decisions_00_release_lock
BEFORE INSERT ON prompt_candidacy_decisions
FOR EACH ROW
EXECUTE FUNCTION public.lock_prompt_candidacy_release_identity();

CREATE FUNCTION public.lock_prompt_deployment_release_identities()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  target record;
BEGIN
  PERFORM public.acquire_prompt_release_advisory_lock(
    'global', NULL, NULL, true
  );

  IF TG_OP = 'INSERT' THEN
    PERFORM public.acquire_prompt_release_advisory_lock(
      'tenant', NEW.tenant_id, NULL, false
    );
    PERFORM public.acquire_prompt_release_advisory_lock(
      'prompt', NEW.tenant_id, NEW.prompt_version_id, false
    );
    RETURN NEW;
  END IF;

  FOR target IN
    SELECT lock_target.tenant_id
    FROM (
      SELECT DISTINCT candidate.tenant_id
      FROM (VALUES (OLD.tenant_id), (NEW.tenant_id)) AS candidate(tenant_id)
    ) AS lock_target
    ORDER BY lock_target.tenant_id
  LOOP
    PERFORM public.acquire_prompt_release_advisory_lock(
      'tenant', target.tenant_id, NULL, false
    );
  END LOOP;

  FOR target IN
    SELECT lock_target.tenant_id, lock_target.prompt_version_id
    FROM (
      SELECT DISTINCT candidate.tenant_id, candidate.prompt_version_id
      FROM (VALUES
        (OLD.tenant_id, OLD.prompt_version_id),
        (NEW.tenant_id, NEW.prompt_version_id)
      ) AS candidate(tenant_id, prompt_version_id)
    ) AS lock_target
    ORDER BY lock_target.tenant_id, lock_target.prompt_version_id
  LOOP
    PERFORM public.acquire_prompt_release_advisory_lock(
      'prompt', target.tenant_id, target.prompt_version_id, false
    );
  END LOOP;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.lock_prompt_deployment_release_identities()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE TRIGGER prompt_deployments_00_release_lock
BEFORE INSERT OR UPDATE ON prompt_deployments
FOR EACH ROW
EXECUTE FUNCTION public.lock_prompt_deployment_release_identities();

CREATE FUNCTION public.lock_running_experiment_prompt_release_identities()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  target record;
BEGIN
  IF NEW.status <> 'RUNNING'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'RUNNING') THEN
    RETURN NEW;
  END IF;

  PERFORM public.acquire_prompt_release_advisory_lock(
    'global', NULL, NULL, true
  );
  PERFORM public.acquire_prompt_release_advisory_lock(
    'experiment', NEW.tenant_id, NEW.id, false
  );
  FOR target IN
    SELECT DISTINCT
      variant.tenant_id,
      variant.prompt_version_id
    FROM public.experiment_variants AS variant
    WHERE variant.experiment_id = NEW.id
      AND variant.tenant_id = NEW.tenant_id
    ORDER BY variant.tenant_id, variant.prompt_version_id
  LOOP
    PERFORM public.acquire_prompt_release_advisory_lock(
      'prompt', target.tenant_id, target.prompt_version_id, false
    );
  END LOOP;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.lock_running_experiment_prompt_release_identities()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE TRIGGER experiments_running_00_prompt_release_lock
BEFORE INSERT OR UPDATE OF status ON experiments
FOR EACH ROW
EXECUTE FUNCTION public.lock_running_experiment_prompt_release_identities();

CREATE FUNCTION public.guard_experiment_variant_release_mutation()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  target record;
  invalid_parent_count integer;
BEGIN
  PERFORM public.acquire_prompt_release_advisory_lock(
    'global', NULL, NULL, true
  );

  IF TG_OP = 'INSERT' THEN
    PERFORM public.acquire_prompt_release_advisory_lock(
      'experiment', NEW.tenant_id, NEW.experiment_id, false
    );
    PERFORM public.acquire_prompt_release_advisory_lock(
      'prompt', NEW.tenant_id, NEW.prompt_version_id, false
    );

    SELECT count(*) FILTER (
      WHERE experiment.status IS DISTINCT FROM 'DRAFT'
    )::integer
    INTO invalid_parent_count
    FROM public.experiments AS experiment
    WHERE experiment.id = NEW.experiment_id
      AND experiment.tenant_id = NEW.tenant_id;

    IF invalid_parent_count IS DISTINCT FROM 0
       OR NOT EXISTS (
         SELECT 1
         FROM public.experiments AS experiment
         WHERE experiment.id = NEW.experiment_id
           AND experiment.tenant_id = NEW.tenant_id
       ) THEN
      RAISE EXCEPTION 'EXPERIMENT_VARIANTS_IMMUTABLE_AFTER_DRAFT'
        USING ERRCODE = '23514',
              CONSTRAINT = 'experiment_variants_draft_only';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.acquire_prompt_release_advisory_lock(
      'experiment', OLD.tenant_id, OLD.experiment_id, false
    );
    PERFORM public.acquire_prompt_release_advisory_lock(
      'prompt', OLD.tenant_id, OLD.prompt_version_id, false
    );

    IF NOT EXISTS (
      SELECT 1
      FROM public.experiments AS experiment
      WHERE experiment.id = OLD.experiment_id
        AND experiment.tenant_id = OLD.tenant_id
        AND experiment.status = 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'EXPERIMENT_VARIANTS_IMMUTABLE_AFTER_DRAFT'
        USING ERRCODE = '23514',
              CONSTRAINT = 'experiment_variants_draft_only';
    END IF;
    RETURN OLD;
  END IF;

  FOR target IN
    SELECT lock_target.tenant_id, lock_target.experiment_id
    FROM (
      SELECT DISTINCT candidate.tenant_id, candidate.experiment_id
      FROM (VALUES
        (OLD.tenant_id, OLD.experiment_id),
        (NEW.tenant_id, NEW.experiment_id)
      ) AS candidate(tenant_id, experiment_id)
    ) AS lock_target
    ORDER BY lock_target.tenant_id, lock_target.experiment_id
  LOOP
    PERFORM public.acquire_prompt_release_advisory_lock(
      'experiment', target.tenant_id, target.experiment_id, false
    );
  END LOOP;

  FOR target IN
    SELECT lock_target.tenant_id, lock_target.prompt_version_id
    FROM (
      SELECT DISTINCT candidate.tenant_id, candidate.prompt_version_id
      FROM (VALUES
        (OLD.tenant_id, OLD.prompt_version_id),
        (NEW.tenant_id, NEW.prompt_version_id)
      ) AS candidate(tenant_id, prompt_version_id)
    ) AS lock_target
    ORDER BY lock_target.tenant_id, lock_target.prompt_version_id
  LOOP
    PERFORM public.acquire_prompt_release_advisory_lock(
      'prompt', target.tenant_id, target.prompt_version_id, false
    );
  END LOOP;

  SELECT count(*) FILTER (
    WHERE parent.status IS DISTINCT FROM 'DRAFT'
  )::integer
  INTO invalid_parent_count
  FROM (
    SELECT DISTINCT candidate.tenant_id, candidate.experiment_id
    FROM (VALUES
      (OLD.tenant_id, OLD.experiment_id),
      (NEW.tenant_id, NEW.experiment_id)
    ) AS candidate(tenant_id, experiment_id)
  ) AS target_parent
  LEFT JOIN public.experiments AS parent
    ON parent.id = target_parent.experiment_id
   AND parent.tenant_id = target_parent.tenant_id;

  IF invalid_parent_count <> 0 THEN
    RAISE EXCEPTION 'EXPERIMENT_VARIANTS_IMMUTABLE_AFTER_DRAFT'
      USING ERRCODE = '23514',
            CONSTRAINT = 'experiment_variants_draft_only';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_experiment_variant_release_mutation()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE TRIGGER experiment_variants_00_release_guard
BEFORE INSERT OR UPDATE OR DELETE ON experiment_variants
FOR EACH ROW
EXECUTE FUNCTION public.guard_experiment_variant_release_mutation();

CREATE FUNCTION public.enforce_complete_prompt_evaluation_evidence()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  prompt public.prompt_versions%ROWTYPE;
  parsed_report jsonb;
  report_cases jsonb;
  report_evaluated_at timestamptz;
  passed_case_count integer;
  distinct_case_count integer;
  invalid_case_count integer;
  expected_report_hash text;
BEGIN
  IF NEW.suite_name IS NULL
     OR NEW.suite_manifest_hash IS NULL
     OR NEW.report_document IS NULL
     OR NEW.report_canonical IS NULL
     OR NEW.evaluator_release_sha IS NULL
     OR NEW.evaluator_release_sha !~ '^[0-9a-f]{40}$'
     OR NEW.evaluator_release_sha = repeat('0', 40)
     OR NEW.suite_name <> btrim(NEW.suite_name)
     OR length(NEW.suite_name) NOT BETWEEN 1 AND 200
     OR NEW.suite_manifest_hash !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PROMPT_EVALUATION_EVIDENCE_INVALID'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_evaluation_results_complete_evidence';
  END IF;

  BEGIN
    parsed_report := NEW.report_canonical::jsonb;
    report_evaluated_at :=
      (parsed_report ->> 'evaluatedAt')::timestamptz;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'PROMPT_EVALUATION_EVIDENCE_INVALID'
        USING ERRCODE = '23514',
              CONSTRAINT = 'prompt_evaluation_results_complete_evidence';
  END;

  expected_report_hash := 'sha256:' || encode(
    digest(convert_to(NEW.report_canonical, 'UTF8'), 'sha256'),
    'hex'
  );
  report_cases := parsed_report #> '{suite,cases}';

  IF NEW.report_document IS DISTINCT FROM parsed_report
     OR NEW.report_hash IS DISTINCT FROM expected_report_hash
     OR jsonb_typeof(parsed_report) IS DISTINCT FROM 'object'
     OR parsed_report ->> 'schemaVersion' IS DISTINCT FROM '1'
     OR parsed_report ->> 'evaluatorReleaseSha'
          IS DISTINCT FROM NEW.evaluator_release_sha
     OR report_evaluated_at IS DISTINCT FROM NEW.evaluated_at
     OR parsed_report #>> '{suite,kind}'
          IS DISTINCT FROM 'deterministic-compose-request-grounding-gate'
     OR parsed_report #>> '{suite,name}' IS DISTINCT FROM NEW.suite_name
     OR parsed_report #>> '{suite,manifestHash}'
          IS DISTINCT FROM NEW.suite_manifest_hash
     OR parsed_report #> '{suite,providerBehaviorMeasured}'
          IS DISTINCT FROM 'false'::jsonb
     OR jsonb_typeof(report_cases) IS DISTINCT FROM 'array'
     OR jsonb_array_length(report_cases) <> NEW.evaluated_cases THEN
    RAISE EXCEPTION 'PROMPT_EVALUATION_EVIDENCE_INVALID'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_evaluation_results_complete_evidence';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE case_value -> 'passed' = 'true'::jsonb
    )::integer,
    count(DISTINCT case_value ->> 'id')::integer,
    count(*) FILTER (
      WHERE jsonb_typeof(case_value) IS DISTINCT FROM 'object'
         OR jsonb_typeof(case_value -> 'id') IS DISTINCT FROM 'string'
         OR length(btrim(case_value ->> 'id')) NOT BETWEEN 1 AND 200
         OR jsonb_typeof(case_value -> 'scenarioHash')
              IS DISTINCT FROM 'string'
         OR (case_value ->> 'scenarioHash')
              !~ '^sha256:[0-9a-f]{64}$'
         OR jsonb_typeof(case_value -> 'composedRequestHash')
              IS DISTINCT FROM 'string'
         OR (case_value ->> 'composedRequestHash')
              !~ '^sha256:[0-9a-f]{64}$'
         OR jsonb_typeof(case_value -> 'passed') IS DISTINCT FROM 'boolean'
         OR (
           case_value ? 'failureReason'
           AND jsonb_typeof(case_value -> 'failureReason')
                 IS DISTINCT FROM 'string'
         )
    )::integer
  INTO passed_case_count, distinct_case_count, invalid_case_count
  FROM jsonb_array_elements(report_cases) AS report_case(case_value);

  IF NEW.evaluated_cases <= 0
     OR passed_case_count IS DISTINCT FROM NEW.passed_cases
     OR distinct_case_count IS DISTINCT FROM NEW.evaluated_cases
     OR invalid_case_count <> 0 THEN
    RAISE EXCEPTION 'PROMPT_EVALUATION_EVIDENCE_INVALID'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_evaluation_results_complete_evidence';
  END IF;

  SELECT stored_prompt.*
  INTO prompt
  FROM public.prompt_versions AS stored_prompt
  WHERE stored_prompt.id = NEW.prompt_version_id
    AND stored_prompt.tenant_id = NEW.tenant_id
    AND stored_prompt.content_hash = NEW.prompt_version_hash;

  IF NOT FOUND
     OR parsed_report #>> '{promptVersion,id}'
          IS DISTINCT FROM prompt.id::text
     OR parsed_report #>> '{promptVersion,tenantId}'
          IS DISTINCT FROM prompt.tenant_id::text
     OR parsed_report #>> '{promptVersion,action}'
          IS DISTINCT FROM prompt.action::text
     OR parsed_report #>> '{promptVersion,key}'
          IS DISTINCT FROM prompt.prompt_key
     OR parsed_report #>> '{promptVersion,hash}'
          IS DISTINCT FROM prompt.content_hash
     OR parsed_report #>> '{promptVersion,body}'
          IS DISTINCT FROM prompt.body
     OR parsed_report #> '{promptVersion,variables}'
          IS DISTINCT FROM to_jsonb(prompt.variables) THEN
    RAISE EXCEPTION 'PROMPT_EVALUATION_EVIDENCE_INVALID'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_evaluation_results_complete_evidence';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_complete_prompt_evaluation_evidence()
FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

CREATE TRIGGER prompt_evaluation_results_complete_evidence
BEFORE INSERT ON prompt_evaluation_results
FOR EACH ROW
EXECUTE FUNCTION public.enforce_complete_prompt_evaluation_evidence();

-- Gates share this predicate rather than accepting summary counts. Rows can
-- only reach the table through the stricter trigger above.
CREATE FUNCTION public.prompt_evaluation_evidence_is_complete(
  evaluation public.prompt_evaluation_results
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT
    evaluation.suite_name IS NOT NULL
    AND evaluation.suite_manifest_hash IS NOT NULL
    AND evaluation.report_document IS NOT NULL
    AND evaluation.report_canonical IS NOT NULL
    AND evaluation.evaluator_release_sha ~ '^[0-9a-f]{40}$'
    AND evaluation.evaluator_release_sha <> repeat('0', 40)
    AND evaluation.suite_manifest_hash ~ '^sha256:[0-9a-f]{64}$'
    AND evaluation.report_document = evaluation.report_canonical::jsonb
    AND evaluation.report_hash = 'sha256:' || encode(
      digest(convert_to(evaluation.report_canonical, 'UTF8'), 'sha256'),
      'hex'
    );
$function$;

REVOKE ALL ON FUNCTION public.prompt_evaluation_evidence_is_complete(
  public.prompt_evaluation_results
) FROM PUBLIC, console_control_svc, context_svc, context_runtime_svc, generation_svc;

-- Tenant publication takes the global lock in shared mode and a Tenant lock;
-- Platform publication takes the global lock exclusively. The current deployed
-- Prompt ids are then locked in deterministic order. Callers must re-read and
-- validate after this function returns, within the same transaction.
CREATE FUNCTION public.console_lock_prompt_release_set(
  requested_tenant_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  migration_owner name;
  locked_deployment record;
  locked_prompt_count integer := 0;
BEGIN
  SELECT pg_get_userbyid(class.relowner)
  INTO STRICT migration_owner
  FROM pg_class AS class
  WHERE class.oid = 'public.prompt_deployments'::regclass;

  IF requested_tenant_id IS NULL THEN
    IF session_user <> migration_owner
       AND NOT public.review_operator_has_platform_capability_privileged(
         'platform:admin'
       ) THEN
      RAISE EXCEPTION 'PROMPT_RELEASE_SET_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
    PERFORM public.acquire_prompt_release_advisory_lock(
      'global', NULL, NULL, false
    );
  ELSE
    IF session_user <> migration_owner
       AND NOT (
         public.review_operator_has_tenant_capability_privileged(
           requested_tenant_id,
           'tenant:configure'
         )
         OR public.review_operator_has_platform_capability_privileged(
           'platform:admin'
         )
       ) THEN
      RAISE EXCEPTION 'PROMPT_RELEASE_SET_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
    PERFORM public.acquire_prompt_release_advisory_lock(
      'global', NULL, NULL, true
    );
    PERFORM public.acquire_prompt_release_advisory_lock(
      'tenant', requested_tenant_id, NULL, false
    );
  END IF;

  FOR locked_deployment IN
    SELECT DISTINCT
      deployment.tenant_id,
      deployment.prompt_version_id
    FROM public.prompt_deployments AS deployment
    WHERE requested_tenant_id IS NULL
       OR deployment.tenant_id = requested_tenant_id
    ORDER BY deployment.tenant_id, deployment.prompt_version_id
  LOOP
    PERFORM public.acquire_prompt_release_advisory_lock(
      'prompt',
      locked_deployment.tenant_id,
      locked_deployment.prompt_version_id,
      false
    );
    locked_prompt_count := locked_prompt_count + 1;
  END LOOP;

  RETURN locked_prompt_count;
END
$function$;

REVOKE ALL ON FUNCTION public.console_lock_prompt_release_set(uuid)
FROM PUBLIC, context_svc, context_runtime_svc, generation_svc;
GRANT EXECUTE ON FUNCTION public.console_lock_prompt_release_set(uuid)
TO console_control_svc;

CREATE OR REPLACE FUNCTION enforce_prompt_deployment_quality_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  prompt_status prompt_version_status;
  prompt_retired_at timestamptz;
  latest_evaluated_cases integer;
  latest_passed_cases integer;
BEGIN
  SELECT
    prompt.status,
    prompt.retired_at,
    latest.evaluated_cases,
    latest.passed_cases
  INTO
    prompt_status,
    prompt_retired_at,
    latest_evaluated_cases,
    latest_passed_cases
  FROM public.prompt_versions AS prompt
  LEFT JOIN LATERAL (
    SELECT evaluation.evaluated_cases, evaluation.passed_cases
    FROM public.prompt_evaluation_results AS evaluation
    WHERE evaluation.tenant_id = prompt.tenant_id
      AND evaluation.prompt_version_id = prompt.id
      AND evaluation.prompt_version_hash = prompt.content_hash
      AND public.prompt_evaluation_evidence_is_complete(evaluation)
    ORDER BY
      evaluation.evaluated_at DESC,
      evaluation.recorded_at DESC,
      evaluation.id DESC
    LIMIT 1
  ) AS latest ON true
  WHERE prompt.id = NEW.prompt_version_id
    AND prompt.tenant_id = NEW.tenant_id
    AND prompt.action = NEW.action;

  IF NOT FOUND
     OR prompt_status = 'RETIRED'
     OR prompt_retired_at IS NOT NULL
     OR latest_evaluated_cases IS NULL
     OR latest_evaluated_cases <= 0
     OR latest_passed_cases <> latest_evaluated_cases THEN
    RAISE EXCEPTION 'PROMPT_DEPLOYMENT_QUALITY_GATE_REJECTED'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_deployments_quality_gate';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION enforce_prompt_candidacy_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  latest_evaluation_id uuid;
  qualifying_evaluation boolean;
  prompt_is_canonical boolean;
BEGIN
  SELECT
    prompt.content_hash = canonical_prompt_version_hash(prompt),
    latest.id
  INTO prompt_is_canonical, latest_evaluation_id
  FROM public.prompt_versions AS prompt
  LEFT JOIN LATERAL (
    SELECT evaluation.id
    FROM public.prompt_evaluation_results AS evaluation
    WHERE evaluation.tenant_id = prompt.tenant_id
      AND evaluation.prompt_version_id = prompt.id
      AND evaluation.prompt_version_hash = prompt.content_hash
      AND public.prompt_evaluation_evidence_is_complete(evaluation)
    ORDER BY
      evaluation.evaluated_at DESC,
      evaluation.recorded_at DESC,
      evaluation.id DESC
    LIMIT 1
  ) AS latest ON true
  WHERE prompt.id = NEW.prompt_version_id
    AND prompt.tenant_id = NEW.tenant_id
    AND prompt.content_hash = NEW.prompt_version_hash
    AND prompt.status <> 'RETIRED'
    AND prompt.retired_at IS NULL;

  IF NOT FOUND OR NOT coalesce(prompt_is_canonical, false) THEN
    RAISE EXCEPTION 'PROMPT_CANDIDACY_QUALITY_GATE_REJECTED'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_candidacy_decisions_quality_gate';
  END IF;

  IF NEW.decision = 'CANDIDATE' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.prompt_evaluation_results AS evaluation
      WHERE evaluation.id = NEW.evaluation_result_id
        AND evaluation.tenant_id = NEW.tenant_id
        AND evaluation.prompt_version_id = NEW.prompt_version_id
        AND evaluation.prompt_version_hash = NEW.prompt_version_hash
        AND public.prompt_evaluation_evidence_is_complete(evaluation)
        AND evaluation.evaluated_cases > 0
        AND evaluation.passed_cases = evaluation.evaluated_cases
    ) INTO qualifying_evaluation;

    IF NOT qualifying_evaluation
       OR latest_evaluation_id IS DISTINCT FROM NEW.evaluation_result_id
       OR EXISTS (
         SELECT 1
         FROM public.prompt_candidacy_decisions AS decision
         WHERE decision.tenant_id = NEW.tenant_id
           AND decision.prompt_version_id = NEW.prompt_version_id
           AND decision.decision = 'RETIRED'
       ) THEN
      RAISE EXCEPTION 'PROMPT_CANDIDACY_QUALITY_GATE_REJECTED'
        USING ERRCODE = '23514',
              CONSTRAINT = 'prompt_candidacy_decisions_quality_gate';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.prompt_candidacy_decisions AS decision
    WHERE decision.tenant_id = NEW.tenant_id
      AND decision.prompt_version_id = NEW.prompt_version_id
      AND decision.decision = 'CANDIDATE'
  ) THEN
    RAISE EXCEPTION 'PROMPT_CANDIDACY_TRANSITION_REJECTED'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_candidacy_decisions_transition';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION prompt_is_effective_candidate(
  requested_tenant_id uuid,
  requested_prompt_version_id uuid,
  requested_prompt_version_hash text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT
    prompt.content_hash = canonical_prompt_version_hash(prompt)
    AND latest.id IS NOT NULL
    AND latest.evaluated_cases > 0
    AND latest.passed_cases = latest.evaluated_cases
    AND EXISTS (
      SELECT 1
      FROM public.prompt_candidacy_decisions AS decision
      WHERE decision.tenant_id = prompt.tenant_id
        AND decision.prompt_version_id = prompt.id
        AND decision.prompt_version_hash = prompt.content_hash
        AND decision.decision = 'CANDIDATE'
        AND decision.evaluation_result_id = latest.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.prompt_candidacy_decisions AS decision
      WHERE decision.tenant_id = prompt.tenant_id
        AND decision.prompt_version_id = prompt.id
        AND decision.decision = 'RETIRED'
    )
  FROM public.prompt_versions AS prompt
  LEFT JOIN LATERAL (
    SELECT
      evaluation.id,
      evaluation.evaluated_cases,
      evaluation.passed_cases
    FROM public.prompt_evaluation_results AS evaluation
    WHERE evaluation.tenant_id = prompt.tenant_id
      AND evaluation.prompt_version_id = prompt.id
      AND evaluation.prompt_version_hash = prompt.content_hash
      AND public.prompt_evaluation_evidence_is_complete(evaluation)
    ORDER BY
      evaluation.evaluated_at DESC,
      evaluation.recorded_at DESC,
      evaluation.id DESC
    LIMIT 1
  ) AS latest ON true
  WHERE prompt.tenant_id = requested_tenant_id
    AND prompt.id = requested_prompt_version_id
    AND prompt.content_hash = requested_prompt_version_hash
    AND prompt.status <> 'RETIRED'
    AND prompt.retired_at IS NULL;
$function$;

CREATE OR REPLACE FUNCTION enforce_running_experiment_quality_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  variant_count integer;
  distinct_prompt_count integer;
  weight_total integer;
  invalid_variant_count integer;
BEGIN
  IF NEW.status <> 'RUNNING' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'RUNNING' THEN
    RETURN NEW;
  END IF;

  SELECT
    count(*)::integer,
    count(DISTINCT variant.prompt_version_id)::integer,
    coalesce(sum(variant.weight_basis_points), 0)::integer,
    count(*) FILTER (
      WHERE variant.weight_basis_points <= 0
         OR variant.weight_basis_points >= 10000
         OR prompt.action IS DISTINCT FROM NEW.action
         OR prompt.status = 'RETIRED'
         OR prompt.retired_at IS NOT NULL
         OR latest.evaluated_cases IS NULL
         OR latest.evaluated_cases <= 0
         OR latest.passed_cases IS DISTINCT FROM latest.evaluated_cases
    )::integer
  INTO
    variant_count,
    distinct_prompt_count,
    weight_total,
    invalid_variant_count
  FROM public.experiment_variants AS variant
  JOIN public.prompt_versions AS prompt
    ON prompt.id = variant.prompt_version_id
   AND prompt.tenant_id = variant.tenant_id
  LEFT JOIN LATERAL (
    SELECT evaluation.evaluated_cases, evaluation.passed_cases
    FROM public.prompt_evaluation_results AS evaluation
    WHERE evaluation.tenant_id = prompt.tenant_id
      AND evaluation.prompt_version_id = prompt.id
      AND evaluation.prompt_version_hash = prompt.content_hash
      AND public.prompt_evaluation_evidence_is_complete(evaluation)
    ORDER BY
      evaluation.evaluated_at DESC,
      evaluation.recorded_at DESC,
      evaluation.id DESC
    LIMIT 1
  ) AS latest ON true
  WHERE variant.experiment_id = NEW.id
    AND variant.tenant_id = NEW.tenant_id;

  IF variant_count < 2
     OR distinct_prompt_count <> variant_count
     OR weight_total <> 10000
     OR invalid_variant_count <> 0 THEN
    RAISE EXCEPTION 'EXPERIMENT_VARIANTS_QUALITY_GATE_REJECTED'
      USING ERRCODE = '23514',
            CONSTRAINT = 'experiments_running_quality_gate';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION enforce_prompt_deployment_quality_gate() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_prompt_candidacy_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION prompt_is_effective_candidate(uuid, uuid, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_running_experiment_quality_gate() FROM PUBLIC;
