-- Evaluation evidence and lifecycle decisions are distinct facts. A perfect
-- evaluation does not silently make immutable Prompt content deployable.

CREATE TYPE prompt_candidacy_decision_kind AS ENUM ('CANDIDATE', 'RETIRED');

ALTER TABLE prompt_evaluation_results
  ADD CONSTRAINT prompt_evaluation_results_candidacy_owner_unique
    UNIQUE (id, tenant_id, prompt_version_id, prompt_version_hash);

CREATE TABLE prompt_candidacy_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  prompt_version_id uuid NOT NULL,
  prompt_version_hash varchar(128) NOT NULL,
  decision prompt_candidacy_decision_kind NOT NULL,
  evaluation_result_id uuid,
  decided_by uuid,
  reason varchar(500),
  decided_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prompt_candidacy_decisions_prompt_hash_shape CHECK (
    prompt_version_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT prompt_candidacy_decisions_candidate_evidence CHECK (
    decision <> 'CANDIDATE' OR evaluation_result_id IS NOT NULL
  ),
  CONSTRAINT prompt_candidacy_decisions_one_kind_per_prompt
    UNIQUE (tenant_id, prompt_version_id, decision),
  CONSTRAINT prompt_candidacy_decisions_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT prompt_candidacy_decisions_prompt_fk
    FOREIGN KEY (prompt_version_id, tenant_id, prompt_version_hash)
    REFERENCES prompt_versions(id, tenant_id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT prompt_candidacy_decisions_evaluation_fk
    FOREIGN KEY (
      evaluation_result_id,
      tenant_id,
      prompt_version_id,
      prompt_version_hash
    ) REFERENCES prompt_evaluation_results (
      id,
      tenant_id,
      prompt_version_id,
      prompt_version_hash
    ) ON DELETE RESTRICT,
  CONSTRAINT prompt_candidacy_decisions_operator_fk
    FOREIGN KEY (decided_by) REFERENCES operators(id) ON DELETE RESTRICT
);

CREATE INDEX prompt_candidacy_decisions_latest_idx
  ON prompt_candidacy_decisions (tenant_id, prompt_version_id, decided_at DESC);

ALTER TABLE prompt_candidacy_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_candidacy_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY prompt_candidacy_decisions_operator_read_policy
  ON prompt_candidacy_decisions
  FOR SELECT
  TO console_control_svc
  USING (
    review_operator_has_tenant_capability(tenant_id, 'ai:operate')
    OR review_operator_has_platform_capability('platform:admin')
  );

CREATE POLICY prompt_candidacy_decisions_operator_insert_policy
  ON prompt_candidacy_decisions
  FOR INSERT
  TO console_control_svc
  WITH CHECK (
    review_operator_has_tenant_capability(tenant_id, 'ai:operate')
    OR review_operator_has_platform_capability('platform:admin')
  );

DO $migration_owner_policy$
DECLARE
  migration_owner name;
BEGIN
  SELECT role.rolname
  INTO STRICT migration_owner
  FROM pg_class AS class
  JOIN pg_roles AS role ON role.oid = class.relowner
  WHERE class.oid = 'prompt_candidacy_decisions'::regclass;

  EXECUTE format(
    'CREATE POLICY migration_owner_maintenance_policy ON prompt_candidacy_decisions FOR ALL TO %I USING (current_user = %L) WITH CHECK (current_user = %L)',
    migration_owner,
    migration_owner,
    migration_owner
  );
END
$migration_owner_policy$;

GRANT SELECT, INSERT ON prompt_candidacy_decisions TO console_control_svc;
REVOKE UPDATE, DELETE, TRUNCATE ON prompt_candidacy_decisions
FROM console_control_svc;
REVOKE ALL ON prompt_candidacy_decisions
FROM context_runtime_svc, generation_svc;

CREATE TRIGGER prompt_candidacy_decisions_append_only
BEFORE UPDATE OR DELETE ON prompt_candidacy_decisions
FOR EACH ROW
EXECUTE FUNCTION reject_published_configuration_mutation();

CREATE FUNCTION canonical_prompt_version_hash(prompt public.prompt_versions)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  command_kind text;
  canonical_variables text;
  canonical_payload text;
BEGIN
  command_kind := CASE prompt.action
    WHEN 'GENERATE' THEN 'generate'
    WHEN 'PARAPHRASE' THEN 'paraphrase'
    WHEN 'REGENERATE' THEN 'generate'
    WHEN 'REFORMAT' THEN 'reformat'
    WHEN 'CONDENSE' THEN 'condense'
    WHEN 'EXPAND' THEN 'expand'
    WHEN 'REVISE_WORDING' THEN 'revise-wording'
    WHEN 'ADD_FACT' THEN 'generate'
  END;

  SELECT coalesce(string_agg(to_json(variable)::text, ',' ORDER BY variable), '')
  INTO canonical_variables
  FROM unnest(prompt.variables) AS variable;

  canonical_payload :=
    '{"body":' || to_json(prompt.body)::text ||
    ',"commandKind":' || to_json(command_kind)::text ||
    ',"key":' || to_json(prompt.prompt_key)::text ||
    ',"variables":[' || canonical_variables || ']}';

  RETURN 'sha256:' || encode(
    digest(convert_to(canonical_payload, 'UTF8'), 'sha256'),
    'hex'
  );
END
$function$;

REVOKE ALL ON FUNCTION canonical_prompt_version_hash(public.prompt_versions)
FROM PUBLIC;

CREATE FUNCTION enforce_prompt_candidacy_decision()
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

REVOKE ALL ON FUNCTION enforce_prompt_candidacy_decision() FROM PUBLIC;

CREATE TRIGGER prompt_candidacy_decisions_quality_gate
BEFORE INSERT ON prompt_candidacy_decisions
FOR EACH ROW
EXECUTE FUNCTION enforce_prompt_candidacy_decision();

CREATE FUNCTION prompt_is_effective_candidate(
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
    AND EXISTS (
      SELECT 1
      FROM public.prompt_candidacy_decisions AS decision
      WHERE decision.tenant_id = prompt.tenant_id
        AND decision.prompt_version_id = prompt.id
        AND decision.prompt_version_hash = prompt.content_hash
        AND decision.decision = 'CANDIDATE'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.prompt_candidacy_decisions AS decision
      WHERE decision.tenant_id = prompt.tenant_id
        AND decision.prompt_version_id = prompt.id
        AND decision.decision = 'RETIRED'
    )
  FROM public.prompt_versions AS prompt
  WHERE prompt.tenant_id = requested_tenant_id
    AND prompt.id = requested_prompt_version_id
    AND prompt.content_hash = requested_prompt_version_hash
    AND prompt.status <> 'RETIRED'
    AND prompt.retired_at IS NULL;
$function$;

REVOKE ALL ON FUNCTION prompt_is_effective_candidate(uuid, uuid, text)
FROM PUBLIC;

CREATE FUNCTION enforce_prompt_deployment_candidacy_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  prompt_hash text;
BEGIN
  SELECT prompt.content_hash
  INTO prompt_hash
  FROM public.prompt_versions AS prompt
  WHERE prompt.id = NEW.prompt_version_id
    AND prompt.tenant_id = NEW.tenant_id
    AND prompt.action = NEW.action;

  IF prompt_hash IS NULL OR NOT coalesce(
    prompt_is_effective_candidate(
      NEW.tenant_id,
      NEW.prompt_version_id,
      prompt_hash
    ),
    false
  ) THEN
    RAISE EXCEPTION 'PROMPT_DEPLOYMENT_CANDIDACY_GATE_REJECTED'
      USING ERRCODE = '23514',
            CONSTRAINT = 'prompt_deployments_candidacy_gate';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION enforce_prompt_deployment_candidacy_gate() FROM PUBLIC;

CREATE TRIGGER prompt_deployments_candidacy_gate
BEFORE INSERT OR UPDATE ON prompt_deployments
FOR EACH ROW
EXECUTE FUNCTION enforce_prompt_deployment_candidacy_gate();

CREATE FUNCTION enforce_running_experiment_candidacy_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  invalid_variant_count integer;
BEGIN
  IF NEW.status <> 'RUNNING'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'RUNNING') THEN
    RETURN NEW;
  END IF;

  SELECT count(*) FILTER (
    WHERE NOT coalesce(
      prompt_is_effective_candidate(
        prompt.tenant_id,
        prompt.id,
        prompt.content_hash
      ),
      false
    )
  )::integer
  INTO invalid_variant_count
  FROM public.experiment_variants AS variant
  JOIN public.prompt_versions AS prompt
    ON prompt.id = variant.prompt_version_id
   AND prompt.tenant_id = variant.tenant_id
  WHERE variant.experiment_id = NEW.id
    AND variant.tenant_id = NEW.tenant_id;

  IF coalesce(invalid_variant_count, 0) <> 0 THEN
    RAISE EXCEPTION 'EXPERIMENT_VARIANTS_CANDIDACY_GATE_REJECTED'
      USING ERRCODE = '23514',
            CONSTRAINT = 'experiments_running_candidacy_gate';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION enforce_running_experiment_candidacy_gate() FROM PUBLIC;

CREATE TRIGGER experiments_running_prompt_candidacy_gate
BEFORE INSERT OR UPDATE OF status ON experiments
FOR EACH ROW
EXECUTE FUNCTION enforce_running_experiment_candidacy_gate();
