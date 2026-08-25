-- Prompt publication and Experiment activation consume append-only evaluation
-- evidence. Context performs the same checks for useful errors; these
-- constraints are the final authority when a handler is wrong or concurrent.

ALTER TABLE prompt_versions
  ADD CONSTRAINT prompt_versions_evaluation_owner_unique
    UNIQUE (id, tenant_id, content_hash);

CREATE TABLE prompt_evaluation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  prompt_version_id uuid NOT NULL,
  prompt_version_hash varchar(128) NOT NULL,
  report_hash varchar(128) NOT NULL,
  evaluated_cases integer NOT NULL,
  passed_cases integer NOT NULL,
  evaluator_release_sha varchar(64),
  evaluated_at timestamptz(6) NOT NULL,
  recorded_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prompt_evaluation_results_prompt_hash_shape CHECK (
    prompt_version_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT prompt_evaluation_results_report_hash_shape CHECK (
    report_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT prompt_evaluation_results_nonempty_suite CHECK (
    evaluated_cases > 0
  ),
  CONSTRAINT prompt_evaluation_results_passed_range CHECK (
    passed_cases >= 0 AND passed_cases <= evaluated_cases
  ),
  CONSTRAINT prompt_evaluation_results_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  CONSTRAINT prompt_evaluation_results_prompt_fk
    FOREIGN KEY (prompt_version_id, tenant_id, prompt_version_hash)
    REFERENCES prompt_versions(id, tenant_id, content_hash) ON DELETE RESTRICT,
  CONSTRAINT prompt_evaluation_results_report_unique
    UNIQUE (tenant_id, prompt_version_id, report_hash)
);

CREATE INDEX prompt_evaluation_results_latest_idx
  ON prompt_evaluation_results (
    tenant_id,
    prompt_version_id,
    evaluated_at DESC,
    recorded_at DESC
  );

ALTER TABLE prompt_evaluation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_evaluation_results FORCE ROW LEVEL SECURITY;

CREATE POLICY prompt_evaluation_results_operator_read_policy
  ON prompt_evaluation_results
  FOR SELECT
  USING (
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
  WHERE class.oid = 'prompt_evaluation_results'::regclass;

  EXECUTE format(
    'CREATE POLICY migration_owner_maintenance_policy ON prompt_evaluation_results FOR ALL TO %I USING (current_user = %L) WITH CHECK (current_user = %L)',
    migration_owner,
    migration_owner,
    migration_owner
  );
END
$migration_owner_policy$;

CREATE TRIGGER prompt_evaluation_results_append_only
BEFORE UPDATE OR DELETE ON prompt_evaluation_results
FOR EACH ROW
EXECUTE FUNCTION reject_published_configuration_mutation();

GRANT SELECT ON prompt_evaluation_results TO console_control_svc;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON prompt_evaluation_results FROM console_control_svc;
REVOKE ALL ON prompt_evaluation_results FROM context_runtime_svc, generation_svc;

-- Forward-fix installations that applied the original role migration before
-- Prompt and Snapshot immutability was tightened.
GRANT SELECT, INSERT ON prompt_versions, effective_configuration_snapshots
TO console_control_svc;
REVOKE UPDATE, DELETE, TRUNCATE ON
  prompt_versions, effective_configuration_snapshots
FROM console_control_svc;

CREATE FUNCTION enforce_prompt_deployment_quality_gate()
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
    evaluation.evaluated_cases,
    evaluation.passed_cases
  INTO
    prompt_status,
    prompt_retired_at,
    latest_evaluated_cases,
    latest_passed_cases
  FROM public.prompt_versions AS prompt
  LEFT JOIN LATERAL (
    SELECT result.evaluated_cases, result.passed_cases
    FROM public.prompt_evaluation_results AS result
    WHERE result.tenant_id = prompt.tenant_id
      AND result.prompt_version_id = prompt.id
      AND result.prompt_version_hash = prompt.content_hash
    ORDER BY result.evaluated_at DESC, result.recorded_at DESC, result.id DESC
    LIMIT 1
  ) AS evaluation ON true
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

REVOKE ALL ON FUNCTION enforce_prompt_deployment_quality_gate() FROM PUBLIC;

CREATE TRIGGER prompt_deployments_quality_gate
BEFORE INSERT OR UPDATE ON prompt_deployments
FOR EACH ROW
EXECUTE FUNCTION enforce_prompt_deployment_quality_gate();

ALTER TABLE experiment_variants
  DROP CONSTRAINT experiment_variants_weight_range,
  ADD CONSTRAINT experiment_variants_weight_range CHECK (
    weight_basis_points > 0 AND weight_basis_points < 10000
  ) NOT VALID;

CREATE UNIQUE INDEX experiments_one_running_per_tenant_action
  ON experiments (tenant_id, action)
  WHERE status = 'RUNNING';

CREATE FUNCTION enforce_running_experiment_quality_gate()
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
         OR evaluation.evaluated_cases IS NULL
         OR evaluation.evaluated_cases <= 0
         OR evaluation.passed_cases IS DISTINCT FROM evaluation.evaluated_cases
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
    SELECT result.evaluated_cases, result.passed_cases
    FROM public.prompt_evaluation_results AS result
    WHERE result.tenant_id = prompt.tenant_id
      AND result.prompt_version_id = prompt.id
      AND result.prompt_version_hash = prompt.content_hash
    ORDER BY result.evaluated_at DESC, result.recorded_at DESC, result.id DESC
    LIMIT 1
  ) AS evaluation ON true
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

REVOKE ALL ON FUNCTION enforce_running_experiment_quality_gate() FROM PUBLIC;

CREATE TRIGGER experiments_running_quality_gate
BEFORE INSERT OR UPDATE OF status ON experiments
FOR EACH ROW
EXECUTE FUNCTION enforce_running_experiment_quality_gate();
