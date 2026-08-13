-- TS-05: Row-Level Security (RLS) policies and service roles migration.
-- FORCE ROW LEVEL SECURITY ensures that even table owners (such as developer connections)
-- are subject to RLS enforcement, preventing accidental leakage.

-- 1. Tenants table policy
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON tenants
  FOR ALL
  USING (id = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), ''));

-- 2. Tenant-scoped child tables
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tenant_access_grants',
    'tenant_action_enablements',
    'locations',
    'posting_destination_bindings',
    'fact_option_categories',
    'fact_option_versions',
    'review_format_enablements',
    'prompt_versions',
    'experiments',
    'experiment_variants',
    'visits',
    'invitation_tokens',
    'review_sessions',
    'experiment_assignments',
    'source_text_revisions',
    'assertions',
    'effective_configuration_snapshots',
    'budget_reservations',
    'generation_batches',
    'generation_batch_assertions',
    'generations',
    'provider_attempts',
    'claims',
    'claim_groundings',
    'unsupported_outputs',
    'drafts',
    'draft_revisions',
    'dispositions'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %I FOR ALL USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), ''''));',
      tbl
    );
  END LOOP;
END $$;

-- 3. Service roles and disjoint grants
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'context_svc') THEN
    CREATE ROLE context_svc WITH LOGIN PASSWORD 'context_svc_secret';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'generation_svc') THEN
    CREATE ROLE generation_svc WITH LOGIN PASSWORD 'generation_svc_secret';
  END IF;
END $$;

-- Context Service Grants (Control Plane):
GRANT USAGE ON SCHEMA public TO context_svc;
GRANT SELECT ON platform_settings, providers, provider_models, price_rates, feature_flags, action_definitions, review_format_versions, posting_destination_types, entry_mode_definitions, operator_role_definitions, prompt_template_versions TO context_svc;
GRANT SELECT, INSERT, UPDATE ON tenants, tenant_access_grants, tenant_action_enablements, locations, posting_destination_bindings, fact_option_categories, fact_option_versions, review_format_enablements, prompt_versions, experiments, experiment_variants, effective_configuration_snapshots TO context_svc;

-- Generation Service Grants (Execution Plane):
GRANT USAGE ON SCHEMA public TO generation_svc;
GRANT SELECT ON platform_settings, providers, provider_models, price_rates, review_format_versions, effective_configuration_snapshots TO generation_svc;
GRANT SELECT, INSERT, UPDATE ON budget_reservations, generation_batches, generation_batch_assertions, generations, provider_attempts, claims, claim_groundings, unsupported_outputs, drafts, draft_revisions, dispositions TO generation_svc;
