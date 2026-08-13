-- TS-04 initial persistence model.
-- RLS policies, FORCE ROW LEVEL SECURITY, and runtime grants are deliberately
-- deferred to TS-05. This migration does establish relational ownership.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE catalog_status AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE tenant_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE location_status AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE operator_status AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE grant_status AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE generation_action AS ENUM (
  'GENERATE',
  'PARAPHRASE',
  'REGENERATE',
  'REFORMAT',
  'CONDENSE',
  'EXPAND',
  'REVISE_WORDING',
  'ADD_FACT'
);
CREATE TYPE fact_option_owner_scope AS ENUM ('TENANT', 'LOCATION');
CREATE TYPE fact_polarity AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');
CREATE TYPE experiment_status AS ENUM ('DRAFT', 'RUNNING', 'STOPPED');
CREATE TYPE review_session_status AS ENUM ('OPEN', 'CLOSED', 'EXPIRED', 'REVOKED');
CREATE TYPE assertion_source AS ENUM ('FACT_OPTION', 'SOURCE_TEXT', 'RATING', 'CONFIRMED_FACT');
CREATE TYPE reservation_status AS ENUM ('RESERVED', 'REDEEMED', 'SETTLED', 'RELEASED', 'EXPIRED');
CREATE TYPE generation_status AS ENUM ('SUCCEEDED', 'REJECTED', 'PROVIDER_ERROR', 'CANCELLED');
CREATE TYPE provider_attempt_status AS ENUM ('SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED');
CREATE TYPE grounding_verdict AS ENUM ('PASSED', 'STRIPPED', 'REJECTED');
CREATE TYPE grounding_source_kind AS ENUM ('ASSERTION', 'VERIFIED_CONTEXT');
CREATE TYPE draft_status AS ENUM ('ACTIVE', 'ACCEPTED', 'DISCARDED');
CREATE TYPE draft_revision_author AS ENUM ('GENERATION', 'REVIEWER');
CREATE TYPE disposition_kind AS ENUM ('ACCEPTED', 'EDITED', 'DISCARDED');

CREATE TABLE platform_settings (
  id varchar(32) PRIMARY KEY DEFAULT 'platform',
  default_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  log_retention_days integer NOT NULL DEFAULT 7,
  config_revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT platform_settings_singleton CHECK (id = 'platform'),
  CONSTRAINT platform_settings_retention_nonnegative CHECK (log_retention_days >= 0),
  CONSTRAINT platform_settings_revision_positive CHECK (config_revision > 0)
);

CREATE TABLE providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(80) NOT NULL UNIQUE,
  display_name varchar(160) NOT NULL,
  credential_reference varchar(255) NOT NULL,
  status catalog_status NOT NULL DEFAULT 'ACTIVE',
  is_default boolean NOT NULL DEFAULT false,
  is_fallback boolean NOT NULL DEFAULT false,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  model_key varchar(160) NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  status catalog_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT provider_models_provider_model_unique UNIQUE (provider_id, model_key)
);

CREATE TABLE price_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_model_id uuid NOT NULL,
  currency char(3) NOT NULL,
  input_per_million_micros bigint NOT NULL,
  output_per_million_micros bigint NOT NULL,
  effective_from timestamptz(6) NOT NULL,
  effective_to timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT price_rates_model_start_unique UNIQUE (provider_model_id, effective_from),
  CONSTRAINT price_rates_id_model_unique UNIQUE (id, provider_model_id),
  CONSTRAINT price_rates_input_nonnegative CHECK (input_per_million_micros >= 0),
  CONSTRAINT price_rates_output_nonnegative CHECK (output_per_million_micros >= 0),
  CONSTRAINT price_rates_effective_interval CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(120) NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE action_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action generation_action NOT NULL UNIQUE,
  input_contract jsonb NOT NULL,
  status catalog_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE review_format_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  format_key varchar(100) NOT NULL,
  version integer NOT NULL,
  locale varchar(35) NOT NULL,
  target_platform varchar(100) NOT NULL,
  constraints jsonb NOT NULL,
  localized_text jsonb NOT NULL,
  supported_actions generation_action[] NOT NULL,
  content_hash varchar(128) NOT NULL UNIQUE,
  status catalog_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT review_format_versions_key_version_unique UNIQUE (format_key, version),
  CONSTRAINT review_format_versions_version_positive CHECK (version > 0)
);

CREATE TABLE posting_destination_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(80) NOT NULL UNIQUE,
  external_id_schema jsonb NOT NULL,
  status catalog_status NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE entry_mode_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(80) NOT NULL UNIQUE,
  semantics jsonb NOT NULL,
  status catalog_status NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE operator_role_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(80) NOT NULL UNIQUE,
  capabilities text[] NOT NULL,
  status catalog_status NOT NULL DEFAULT 'ACTIVE'
);

CREATE TABLE prompt_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key varchar(100) NOT NULL,
  action generation_action NOT NULL,
  content_hash varchar(128) NOT NULL,
  body text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prompt_template_versions_identity_unique UNIQUE (template_key, action, content_hash)
);

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(100) NOT NULL UNIQUE,
  name varchar(200) NOT NULL,
  locale varchar(35) NOT NULL,
  category varchar(100),
  status tenant_status NOT NULL DEFAULT 'ACTIVE',
  business_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  tone_guidelines text,
  banned_terms text[] NOT NULL DEFAULT '{}'::text[],
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  monthly_budget_micros bigint NOT NULL DEFAULT 0,
  alert_threshold_percent integer NOT NULL DEFAULT 80,
  config_revision bigint NOT NULL DEFAULT 1,
  default_entry_mode_key varchar(80),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenants_budget_nonnegative CHECK (monthly_budget_micros >= 0),
  CONSTRAINT tenants_alert_threshold_range CHECK (alert_threshold_percent BETWEEN 0 AND 100),
  CONSTRAINT tenants_revision_positive CHECK (config_revision > 0)
);

CREATE TABLE operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  external_subject varchar(255) UNIQUE,
  password_hash text,
  status operator_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT operators_auth_identity_present CHECK (external_subject IS NOT NULL OR password_hash IS NOT NULL)
);

CREATE TABLE tenant_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  operator_id uuid NOT NULL,
  role_key varchar(80) NOT NULL,
  status grant_status NOT NULL DEFAULT 'ACTIVE',
  is_break_glass boolean NOT NULL DEFAULT false,
  valid_from timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until timestamptz(6),
  revoked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tenant_access_grants_identity_unique UNIQUE (tenant_id, operator_id, role_key),
  CONSTRAINT tenant_access_grants_interval CHECK (valid_until IS NULL OR valid_until > valid_from),
  CONSTRAINT tenant_access_grants_revocation_shape CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL) OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE tenant_action_enablements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  action generation_action NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT tenant_action_enablements_identity_unique UNIQUE (tenant_id, action)
);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slug varchar(100) NOT NULL,
  name varchar(200) NOT NULL,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  status location_status NOT NULL DEFAULT 'ACTIVE',
  config_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT locations_tenant_slug_unique UNIQUE (tenant_id, slug),
  CONSTRAINT locations_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT locations_revision_positive CHECK (config_revision > 0),
  CONSTRAINT locations_overrides_object CHECK (jsonb_typeof(overrides) = 'object')
);

CREATE TABLE posting_destination_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  destination_type_id uuid NOT NULL,
  external_id varchar(255) NOT NULL,
  target_url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  CONSTRAINT posting_destination_bindings_identity_unique UNIQUE (tenant_id, location_id, destination_type_id)
);

CREATE TABLE fact_option_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key varchar(100) NOT NULL,
  label jsonb NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fact_option_categories_tenant_key_unique UNIQUE (tenant_id, key),
  CONSTRAINT fact_option_categories_id_tenant_unique UNIQUE (id, tenant_id)
);

CREATE TABLE fact_option_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid,
  category_id uuid NOT NULL,
  fact_option_key varchar(120) NOT NULL,
  version integer NOT NULL,
  owner_scope fact_option_owner_scope NOT NULL,
  label jsonb NOT NULL,
  proposition text NOT NULL,
  polarity fact_polarity NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at timestamptz(6),
  CONSTRAINT fact_option_versions_identity_unique UNIQUE (tenant_id, fact_option_key, version),
  CONSTRAINT fact_option_versions_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT fact_option_versions_version_positive CHECK (version > 0),
  CONSTRAINT fact_option_versions_owner_shape CHECK (
    (owner_scope = 'TENANT' AND location_id IS NULL) OR
    (owner_scope = 'LOCATION' AND location_id IS NOT NULL)
  ),
  CONSTRAINT fact_option_versions_retirement_after_creation CHECK (retired_at IS NULL OR retired_at >= created_at)
);

CREATE TABLE review_format_enablements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  review_format_version_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  allowed_actions generation_action[] NOT NULL,
  CONSTRAINT review_format_enablements_identity_unique UNIQUE (tenant_id, review_format_version_id)
);

CREATE TABLE prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  prompt_key varchar(100) NOT NULL,
  action generation_action NOT NULL,
  content_hash varchar(128) NOT NULL,
  body text NOT NULL,
  derived_from_template_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at timestamptz(6),
  CONSTRAINT prompt_versions_identity_unique UNIQUE (tenant_id, prompt_key, action, content_hash),
  CONSTRAINT prompt_versions_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT prompt_versions_retirement_after_creation CHECK (retired_at IS NULL OR retired_at >= created_at)
);

CREATE TABLE experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key varchar(100) NOT NULL,
  action generation_action NOT NULL,
  status experiment_status NOT NULL DEFAULT 'DRAFT',
  started_at timestamptz(6),
  stopped_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT experiments_tenant_key_unique UNIQUE (tenant_id, key),
  CONSTRAINT experiments_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT experiments_interval CHECK (stopped_at IS NULL OR (started_at IS NOT NULL AND stopped_at > started_at))
);

CREATE TABLE experiment_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  experiment_id uuid NOT NULL,
  prompt_version_id uuid NOT NULL,
  key varchar(80) NOT NULL,
  weight_basis_points integer NOT NULL,
  CONSTRAINT experiment_variants_experiment_key_unique UNIQUE (experiment_id, key),
  CONSTRAINT experiment_variants_id_scope_unique UNIQUE (id, tenant_id, experiment_id),
  CONSTRAINT experiment_variants_weight_range CHECK (weight_basis_points BETWEEN 0 AND 10000)
);

CREATE TABLE visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  occurred_at timestamptz(6) NOT NULL,
  verification_method varchar(80),
  verification_evidence_hash varchar(128),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT visits_id_scope_unique UNIQUE (id, tenant_id, location_id),
  CONSTRAINT visits_verification_shape CHECK (
    (verification_method IS NULL AND verification_evidence_hash IS NULL) OR
    (verification_method IS NOT NULL AND verification_evidence_hash IS NOT NULL)
  )
);

CREATE TABLE invitation_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  visit_id uuid,
  token_hash varchar(128) NOT NULL UNIQUE,
  issued_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz(6) NOT NULL,
  consumed_at timestamptz(6),
  CONSTRAINT invitation_tokens_id_scope_unique UNIQUE (id, tenant_id, location_id),
  CONSTRAINT invitation_tokens_expiry_after_issue CHECK (expires_at > issued_at),
  CONSTRAINT invitation_tokens_consumption_after_issue CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);

CREATE TABLE review_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  visit_id uuid,
  invitation_token_id uuid UNIQUE,
  status review_session_status NOT NULL DEFAULT 'OPEN',
  rating integer,
  session_version integer NOT NULL DEFAULT 1,
  opened_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz(6) NOT NULL,
  closed_at timestamptz(6),
  CONSTRAINT review_sessions_id_scope_unique UNIQUE (id, tenant_id, location_id),
  CONSTRAINT review_sessions_invitation_scope_unique UNIQUE (invitation_token_id, tenant_id, location_id),
  CONSTRAINT review_sessions_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT review_sessions_version_positive CHECK (session_version > 0),
  CONSTRAINT review_sessions_expiry_after_open CHECK (expires_at > opened_at),
  CONSTRAINT review_sessions_close_after_open CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE TABLE experiment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  experiment_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  assigned_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT experiment_assignments_stable_unique UNIQUE (tenant_id, review_session_id, experiment_id)
);

CREATE TABLE source_text_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  revision integer NOT NULL,
  body text NOT NULL,
  content_hash varchar(128) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT source_text_revisions_session_revision_unique UNIQUE (tenant_id, review_session_id, revision),
  CONSTRAINT source_text_revisions_id_scope_unique UNIQUE (id, tenant_id, location_id, review_session_id),
  CONSTRAINT source_text_revisions_revision_positive CHECK (revision > 0)
);

CREATE TABLE assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  source assertion_source NOT NULL,
  proposition text NOT NULL,
  fact_option_version_id uuid,
  source_text_revision_id uuid,
  source_span_start integer,
  source_span_end integer,
  rating integer,
  confirmed_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assertions_id_scope_unique UNIQUE (id, tenant_id, location_id, review_session_id),
  CONSTRAINT assertions_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  CONSTRAINT assertions_source_shape CHECK (
    (source = 'FACT_OPTION' AND fact_option_version_id IS NOT NULL AND source_text_revision_id IS NULL AND source_span_start IS NULL AND source_span_end IS NULL AND rating IS NULL) OR
    (source = 'SOURCE_TEXT' AND fact_option_version_id IS NULL AND source_text_revision_id IS NOT NULL AND source_span_start IS NOT NULL AND source_span_end IS NOT NULL AND source_span_start >= 0 AND source_span_end > source_span_start AND rating IS NULL) OR
    (source = 'RATING' AND fact_option_version_id IS NULL AND source_text_revision_id IS NULL AND source_span_start IS NULL AND source_span_end IS NULL AND rating IS NOT NULL) OR
    (source = 'CONFIRMED_FACT' AND fact_option_version_id IS NULL AND source_text_revision_id IS NULL AND source_span_start IS NULL AND source_span_end IS NULL AND rating IS NULL)
  )
);

CREATE TABLE effective_configuration_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  schema_version integer NOT NULL,
  content_hash varchar(128) NOT NULL,
  payload jsonb NOT NULL,
  provenance jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT effective_snapshots_content_unique UNIQUE (tenant_id, location_id, schema_version, content_hash),
  CONSTRAINT effective_snapshots_id_scope_unique UNIQUE (id, tenant_id, location_id),
  CONSTRAINT effective_snapshots_schema_positive CHECK (schema_version > 0),
  CONSTRAINT effective_snapshots_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT effective_snapshots_provenance_object CHECK (jsonb_typeof(provenance) = 'object')
);

CREATE TABLE budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  permit_jti varchar(128) NOT NULL UNIQUE,
  request_hash varchar(128) NOT NULL,
  action generation_action NOT NULL,
  reserved_micros bigint NOT NULL,
  actual_cost_micros bigint,
  status reservation_status NOT NULL DEFAULT 'RESERVED',
  reserved_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz(6) NOT NULL,
  redeemed_at timestamptz(6),
  settled_at timestamptz(6),
  CONSTRAINT budget_reservations_id_scope_unique UNIQUE (id, tenant_id, location_id, review_session_id),
  CONSTRAINT budget_reservations_reserved_nonnegative CHECK (reserved_micros >= 0),
  CONSTRAINT budget_reservations_actual_nonnegative CHECK (actual_cost_micros IS NULL OR actual_cost_micros >= 0),
  CONSTRAINT budget_reservations_expiry_after_reserve CHECK (expires_at > reserved_at),
  CONSTRAINT budget_reservations_redeem_after_reserve CHECK (redeemed_at IS NULL OR redeemed_at >= reserved_at),
  CONSTRAINT budget_reservations_settle_after_reserve CHECK (settled_at IS NULL OR settled_at >= reserved_at)
);

CREATE TABLE generation_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  budget_reservation_id uuid NOT NULL UNIQUE,
  idempotency_key varchar(128) NOT NULL,
  request_hash varchar(128) NOT NULL,
  action generation_action NOT NULL,
  normalized_input jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT generation_batches_idempotency_unique UNIQUE (tenant_id, review_session_id, idempotency_key),
  CONSTRAINT generation_batches_id_scope_unique UNIQUE (id, tenant_id, location_id, review_session_id),
  CONSTRAINT generation_batches_reservation_scope_unique UNIQUE (budget_reservation_id, tenant_id, location_id, review_session_id),
  CONSTRAINT generation_batches_input_object CHECK (jsonb_typeof(normalized_input) = 'object')
);

CREATE TABLE generation_batch_assertions (
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  generation_batch_id uuid NOT NULL,
  assertion_id uuid NOT NULL,
  PRIMARY KEY (generation_batch_id, assertion_id)
);

CREATE TABLE generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  generation_batch_id uuid NOT NULL,
  source_generation_id uuid,
  snapshot_id uuid NOT NULL,
  prompt_version_id uuid NOT NULL,
  review_format_version_id uuid NOT NULL,
  action generation_action NOT NULL,
  status generation_status NOT NULL,
  provider_output text,
  grounded_output text,
  grounding_verdict grounding_verdict NOT NULL,
  policy_result jsonb NOT NULL,
  total_input_tokens integer NOT NULL DEFAULT 0,
  total_output_tokens integer NOT NULL DEFAULT 0,
  total_cost_micros bigint NOT NULL DEFAULT 0,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT generations_id_scope_unique UNIQUE (id, tenant_id, location_id, review_session_id),
  CONSTRAINT generations_not_own_source CHECK (source_generation_id IS NULL OR source_generation_id <> id),
  CONSTRAINT generations_input_tokens_nonnegative CHECK (total_input_tokens >= 0),
  CONSTRAINT generations_output_tokens_nonnegative CHECK (total_output_tokens >= 0),
  CONSTRAINT generations_cost_nonnegative CHECK (total_cost_micros >= 0)
);

CREATE TABLE provider_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  provider_model_id uuid NOT NULL,
  price_rate_id uuid,
  sequence integer NOT NULL,
  status provider_attempt_status NOT NULL,
  request_payload jsonb NOT NULL,
  provider_response jsonb,
  input_tokens integer,
  output_tokens integer,
  cost_micros bigint NOT NULL DEFAULT 0,
  error_code varchar(120),
  started_at timestamptz(6) NOT NULL,
  finished_at timestamptz(6),
  billed_at timestamptz(6),
  CONSTRAINT provider_attempts_generation_sequence_unique UNIQUE (generation_id, sequence),
  CONSTRAINT provider_attempts_sequence_positive CHECK (sequence > 0),
  CONSTRAINT provider_attempts_input_tokens_nonnegative CHECK (input_tokens IS NULL OR input_tokens >= 0),
  CONSTRAINT provider_attempts_output_tokens_nonnegative CHECK (output_tokens IS NULL OR output_tokens >= 0),
  CONSTRAINT provider_attempts_cost_nonnegative CHECK (cost_micros >= 0),
  CONSTRAINT provider_attempts_finish_after_start CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT provider_attempts_billing_shape CHECK (
    (billed_at IS NULL AND price_rate_id IS NULL AND cost_micros = 0) OR
    (billed_at IS NOT NULL AND price_rate_id IS NOT NULL)
  )
);

CREATE TABLE claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  source_claim_id uuid,
  ordinal integer NOT NULL,
  proposition text NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT claims_generation_ordinal_unique UNIQUE (generation_id, ordinal),
  CONSTRAINT claims_id_scope_unique UNIQUE (id, tenant_id, location_id, review_session_id),
  CONSTRAINT claims_id_generation_scope_unique UNIQUE (id, tenant_id, location_id, review_session_id, generation_id),
  CONSTRAINT claims_ordinal_nonnegative CHECK (ordinal >= 0),
  CONSTRAINT claims_not_own_source CHECK (source_claim_id IS NULL OR source_claim_id <> id)
);

CREATE TABLE claim_groundings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  source_kind grounding_source_kind NOT NULL,
  assertion_id uuid,
  verified_context jsonb,
  CONSTRAINT claim_groundings_claim_assertion_unique UNIQUE (claim_id, assertion_id),
  CONSTRAINT claim_groundings_source_shape CHECK (
    (source_kind = 'ASSERTION' AND assertion_id IS NOT NULL AND verified_context IS NULL) OR
    (source_kind = 'VERIFIED_CONTEXT' AND assertion_id IS NULL AND verified_context IS NOT NULL AND jsonb_typeof(verified_context) = 'object')
  )
);

CREATE TABLE unsupported_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  generation_id uuid NOT NULL,
  ordinal integer NOT NULL,
  text text NOT NULL,
  reason varchar(160) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unsupported_outputs_generation_ordinal_unique UNIQUE (generation_id, ordinal),
  CONSTRAINT unsupported_outputs_ordinal_nonnegative CHECK (ordinal >= 0)
);

CREATE TABLE drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  originating_generation_id uuid NOT NULL UNIQUE,
  status draft_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT drafts_id_scope_unique UNIQUE (id, tenant_id, location_id, review_session_id),
  CONSTRAINT drafts_generation_scope_unique UNIQUE (originating_generation_id, tenant_id, location_id, review_session_id)
);

CREATE TABLE draft_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  source_generation_id uuid,
  revision integer NOT NULL,
  author draft_revision_author NOT NULL,
  text text NOT NULL,
  content_hash varchar(128) NOT NULL,
  annotations jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT draft_revisions_draft_revision_unique UNIQUE (draft_id, revision),
  CONSTRAINT draft_revisions_id_scope_unique UNIQUE (id, draft_id, tenant_id, location_id, review_session_id),
  CONSTRAINT draft_revisions_revision_positive CHECK (revision > 0)
);

CREATE TABLE dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  review_session_id uuid NOT NULL,
  draft_id uuid NOT NULL UNIQUE,
  generation_id uuid NOT NULL,
  selected_draft_revision_id uuid,
  kind disposition_kind NOT NULL,
  normalized_edit_distance numeric(8, 6),
  created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT dispositions_draft_scope_unique UNIQUE (draft_id, tenant_id, location_id, review_session_id),
  CONSTRAINT dispositions_edit_distance_range CHECK (
    normalized_edit_distance IS NULL OR normalized_edit_distance BETWEEN 0 AND 1
  ),
  CONSTRAINT dispositions_revision_shape CHECK (
    (kind = 'DISCARDED' AND selected_draft_revision_id IS NULL) OR
    (kind IN ('ACCEPTED', 'EDITED') AND selected_draft_revision_id IS NOT NULL)
  ),
  CONSTRAINT dispositions_edited_distance_present CHECK (
    kind <> 'EDITED' OR normalized_edit_distance IS NOT NULL
  )
);

-- Platform and configuration references.
ALTER TABLE provider_models
  ADD CONSTRAINT provider_models_provider_fk
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE RESTRICT;

ALTER TABLE price_rates
  ADD CONSTRAINT price_rates_provider_model_fk
  FOREIGN KEY (provider_model_id) REFERENCES provider_models(id) ON DELETE RESTRICT;

ALTER TABLE tenants
  ADD CONSTRAINT tenants_default_entry_mode_fk
  FOREIGN KEY (default_entry_mode_key) REFERENCES entry_mode_definitions(key) ON DELETE RESTRICT;

ALTER TABLE tenant_access_grants
  ADD CONSTRAINT tenant_access_grants_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT tenant_access_grants_operator_fk
  FOREIGN KEY (operator_id) REFERENCES operators(id) ON DELETE RESTRICT,
  ADD CONSTRAINT tenant_access_grants_role_fk
  FOREIGN KEY (role_key) REFERENCES operator_role_definitions(key) ON DELETE RESTRICT;

ALTER TABLE tenant_action_enablements
  ADD CONSTRAINT tenant_action_enablements_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT tenant_action_enablements_definition_fk
  FOREIGN KEY (action) REFERENCES action_definitions(action) ON DELETE RESTRICT;

ALTER TABLE locations
  ADD CONSTRAINT locations_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

ALTER TABLE posting_destination_bindings
  ADD CONSTRAINT posting_destination_bindings_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT posting_destination_bindings_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT posting_destination_bindings_type_fk
  FOREIGN KEY (destination_type_id) REFERENCES posting_destination_types(id) ON DELETE RESTRICT;

ALTER TABLE fact_option_categories
  ADD CONSTRAINT fact_option_categories_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

ALTER TABLE fact_option_versions
  ADD CONSTRAINT fact_option_versions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fact_option_versions_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fact_option_versions_category_fk
  FOREIGN KEY (category_id, tenant_id) REFERENCES fact_option_categories(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE review_format_enablements
  ADD CONSTRAINT review_format_enablements_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT review_format_enablements_version_fk
  FOREIGN KEY (review_format_version_id) REFERENCES review_format_versions(id) ON DELETE RESTRICT;

ALTER TABLE prompt_versions
  ADD CONSTRAINT prompt_versions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT prompt_versions_template_fk
  FOREIGN KEY (derived_from_template_id) REFERENCES prompt_template_versions(id) ON DELETE RESTRICT;

ALTER TABLE experiments
  ADD CONSTRAINT experiments_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;

ALTER TABLE experiment_variants
  ADD CONSTRAINT experiment_variants_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT experiment_variants_experiment_fk
  FOREIGN KEY (experiment_id, tenant_id) REFERENCES experiments(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT experiment_variants_prompt_fk
  FOREIGN KEY (prompt_version_id, tenant_id) REFERENCES prompt_versions(id, tenant_id) ON DELETE RESTRICT;

-- Admission and reviewer-authority references.
ALTER TABLE visits
  ADD CONSTRAINT visits_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT visits_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE invitation_tokens
  ADD CONSTRAINT invitation_tokens_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT invitation_tokens_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT invitation_tokens_visit_fk
  FOREIGN KEY (visit_id, tenant_id, location_id) REFERENCES visits(id, tenant_id, location_id) ON DELETE RESTRICT;

ALTER TABLE review_sessions
  ADD CONSTRAINT review_sessions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT review_sessions_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT review_sessions_visit_fk
  FOREIGN KEY (visit_id, tenant_id, location_id) REFERENCES visits(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT review_sessions_invitation_fk
  FOREIGN KEY (invitation_token_id, tenant_id, location_id) REFERENCES invitation_tokens(id, tenant_id, location_id) ON DELETE RESTRICT;

ALTER TABLE experiment_assignments
  ADD CONSTRAINT experiment_assignments_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT experiment_assignments_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT experiment_assignments_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT experiment_assignments_experiment_fk
  FOREIGN KEY (experiment_id, tenant_id) REFERENCES experiments(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT experiment_assignments_variant_fk
  FOREIGN KEY (variant_id, tenant_id, experiment_id) REFERENCES experiment_variants(id, tenant_id, experiment_id) ON DELETE RESTRICT;

ALTER TABLE source_text_revisions
  ADD CONSTRAINT source_text_revisions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT source_text_revisions_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT source_text_revisions_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT;

ALTER TABLE assertions
  ADD CONSTRAINT assertions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT assertions_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT assertions_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT assertions_fact_option_fk
  FOREIGN KEY (fact_option_version_id, tenant_id) REFERENCES fact_option_versions(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT assertions_source_text_fk
  FOREIGN KEY (source_text_revision_id, tenant_id, location_id, review_session_id)
  REFERENCES source_text_revisions(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT;

-- Snapshot, budget, generation, grounding, and Draft references.
ALTER TABLE effective_configuration_snapshots
  ADD CONSTRAINT effective_snapshots_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT effective_snapshots_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE budget_reservations
  ADD CONSTRAINT budget_reservations_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT budget_reservations_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT budget_reservations_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT budget_reservations_snapshot_fk
  FOREIGN KEY (snapshot_id, tenant_id, location_id) REFERENCES effective_configuration_snapshots(id, tenant_id, location_id) ON DELETE RESTRICT;

ALTER TABLE generation_batches
  ADD CONSTRAINT generation_batches_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT generation_batches_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generation_batches_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generation_batches_snapshot_fk
  FOREIGN KEY (snapshot_id, tenant_id, location_id) REFERENCES effective_configuration_snapshots(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generation_batches_reservation_fk
  FOREIGN KEY (budget_reservation_id, tenant_id, location_id, review_session_id)
  REFERENCES budget_reservations(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT;

ALTER TABLE generation_batch_assertions
  ADD CONSTRAINT generation_batch_assertions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT generation_batch_assertions_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generation_batch_assertions_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generation_batch_assertions_batch_fk
  FOREIGN KEY (generation_batch_id, tenant_id, location_id, review_session_id)
  REFERENCES generation_batches(id, tenant_id, location_id, review_session_id) ON DELETE CASCADE,
  ADD CONSTRAINT generation_batch_assertions_assertion_fk
  FOREIGN KEY (assertion_id, tenant_id, location_id, review_session_id)
  REFERENCES assertions(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT;

ALTER TABLE generations
  ADD CONSTRAINT generations_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT generations_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generations_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generations_batch_fk
  FOREIGN KEY (generation_batch_id, tenant_id, location_id, review_session_id)
  REFERENCES generation_batches(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generations_source_fk
  FOREIGN KEY (source_generation_id, tenant_id, location_id, review_session_id)
  REFERENCES generations(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generations_snapshot_fk
  FOREIGN KEY (snapshot_id, tenant_id, location_id)
  REFERENCES effective_configuration_snapshots(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generations_prompt_fk
  FOREIGN KEY (prompt_version_id, tenant_id) REFERENCES prompt_versions(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT generations_review_format_fk
  FOREIGN KEY (review_format_version_id) REFERENCES review_format_versions(id) ON DELETE RESTRICT;

ALTER TABLE provider_attempts
  ADD CONSTRAINT provider_attempts_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT provider_attempts_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT provider_attempts_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT provider_attempts_generation_fk
  FOREIGN KEY (generation_id, tenant_id, location_id, review_session_id)
  REFERENCES generations(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT,
  ADD CONSTRAINT provider_attempts_model_fk
  FOREIGN KEY (provider_model_id) REFERENCES provider_models(id) ON DELETE RESTRICT,
  ADD CONSTRAINT provider_attempts_price_rate_fk
  FOREIGN KEY (price_rate_id, provider_model_id) REFERENCES price_rates(id, provider_model_id) ON DELETE RESTRICT;

ALTER TABLE claims
  ADD CONSTRAINT claims_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT claims_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT claims_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT claims_generation_fk
  FOREIGN KEY (generation_id, tenant_id, location_id, review_session_id)
  REFERENCES generations(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT,
  ADD CONSTRAINT claims_source_fk
  FOREIGN KEY (source_claim_id, tenant_id, location_id, review_session_id)
  REFERENCES claims(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT;

ALTER TABLE claim_groundings
  ADD CONSTRAINT claim_groundings_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT claim_groundings_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT claim_groundings_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT claim_groundings_claim_fk
  FOREIGN KEY (claim_id, tenant_id, location_id, review_session_id, generation_id)
  REFERENCES claims(id, tenant_id, location_id, review_session_id, generation_id) ON DELETE CASCADE,
  ADD CONSTRAINT claim_groundings_assertion_fk
  FOREIGN KEY (assertion_id, tenant_id, location_id, review_session_id)
  REFERENCES assertions(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT;

ALTER TABLE unsupported_outputs
  ADD CONSTRAINT unsupported_outputs_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT unsupported_outputs_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT unsupported_outputs_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT unsupported_outputs_generation_fk
  FOREIGN KEY (generation_id, tenant_id, location_id, review_session_id)
  REFERENCES generations(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT;

ALTER TABLE drafts
  ADD CONSTRAINT drafts_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT drafts_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT drafts_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT drafts_generation_fk
  FOREIGN KEY (originating_generation_id, tenant_id, location_id, review_session_id)
  REFERENCES generations(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT;

ALTER TABLE draft_revisions
  ADD CONSTRAINT draft_revisions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT draft_revisions_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT draft_revisions_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT draft_revisions_draft_fk
  FOREIGN KEY (draft_id, tenant_id, location_id, review_session_id)
  REFERENCES drafts(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT,
  ADD CONSTRAINT draft_revisions_generation_fk
  FOREIGN KEY (source_generation_id, tenant_id, location_id, review_session_id)
  REFERENCES generations(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT;

ALTER TABLE dispositions
  ADD CONSTRAINT dispositions_tenant_fk
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  ADD CONSTRAINT dispositions_location_fk
  FOREIGN KEY (location_id, tenant_id) REFERENCES locations(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT dispositions_session_fk
  FOREIGN KEY (review_session_id, tenant_id, location_id) REFERENCES review_sessions(id, tenant_id, location_id) ON DELETE RESTRICT,
  ADD CONSTRAINT dispositions_draft_fk
  FOREIGN KEY (draft_id, tenant_id, location_id, review_session_id)
  REFERENCES drafts(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT,
  ADD CONSTRAINT dispositions_generation_fk
  FOREIGN KEY (generation_id, tenant_id, location_id, review_session_id)
  REFERENCES generations(id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT,
  ADD CONSTRAINT dispositions_revision_fk
  FOREIGN KEY (selected_draft_revision_id, draft_id, tenant_id, location_id, review_session_id)
  REFERENCES draft_revisions(id, draft_id, tenant_id, location_id, review_session_id) ON DELETE RESTRICT;

-- Every tenant-attributed table gets a leading tenant index before TS-05 adds
-- the policies that use tenant_id. Composite indexes preserve hot-path scope.
CREATE INDEX tenant_access_grants_tenant_idx ON tenant_access_grants (tenant_id);
CREATE INDEX tenant_action_enablements_tenant_idx ON tenant_action_enablements (tenant_id);
CREATE INDEX locations_tenant_idx ON locations (tenant_id);
CREATE INDEX posting_destination_bindings_tenant_idx ON posting_destination_bindings (tenant_id);
CREATE INDEX fact_option_categories_tenant_idx ON fact_option_categories (tenant_id);
CREATE INDEX fact_option_versions_tenant_location_idx ON fact_option_versions (tenant_id, location_id);
CREATE INDEX review_format_enablements_tenant_idx ON review_format_enablements (tenant_id);
CREATE INDEX prompt_versions_tenant_idx ON prompt_versions (tenant_id);
CREATE INDEX experiments_tenant_idx ON experiments (tenant_id);
CREATE INDEX experiment_variants_tenant_idx ON experiment_variants (tenant_id);
CREATE INDEX visits_tenant_location_idx ON visits (tenant_id, location_id);
CREATE INDEX invitation_tokens_tenant_location_idx ON invitation_tokens (tenant_id, location_id);
CREATE INDEX review_sessions_tenant_location_idx ON review_sessions (tenant_id, location_id);
CREATE INDEX experiment_assignments_tenant_location_idx ON experiment_assignments (tenant_id, location_id);
CREATE INDEX source_text_revisions_tenant_location_idx ON source_text_revisions (tenant_id, location_id);
CREATE INDEX assertions_tenant_location_idx ON assertions (tenant_id, location_id);
CREATE INDEX effective_snapshots_tenant_location_idx ON effective_configuration_snapshots (tenant_id, location_id);
CREATE INDEX budget_reservations_tenant_location_idx ON budget_reservations (tenant_id, location_id);
CREATE INDEX generation_batches_tenant_location_idx ON generation_batches (tenant_id, location_id);
CREATE INDEX generation_batch_assertions_tenant_location_idx ON generation_batch_assertions (tenant_id, location_id);
CREATE INDEX generations_tenant_session_idx ON generations (tenant_id, location_id, review_session_id);
CREATE INDEX generations_source_idx ON generations (source_generation_id);
CREATE INDEX provider_attempts_tenant_session_idx ON provider_attempts (tenant_id, location_id, review_session_id);
CREATE INDEX claims_tenant_session_idx ON claims (tenant_id, location_id, review_session_id);
CREATE INDEX claim_groundings_tenant_session_idx ON claim_groundings (tenant_id, location_id, review_session_id);
CREATE INDEX unsupported_outputs_tenant_session_idx ON unsupported_outputs (tenant_id, location_id, review_session_id);
CREATE INDEX drafts_tenant_session_idx ON drafts (tenant_id, location_id, review_session_id);
CREATE INDEX draft_revisions_tenant_session_idx ON draft_revisions (tenant_id, location_id, review_session_id);
CREATE INDEX dispositions_tenant_session_idx ON dispositions (tenant_id, location_id, review_session_id);

-- Raw SQL constraints Prisma cannot describe: the invitation's Visit must be
-- identical to the Review Session's Visit, and every Claim must have at least
-- one direct Assertion or permitted verified-context grounding at commit.
CREATE FUNCTION check_review_session_invitation_visit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  invitation_visit_id uuid;
  invitation_consumed_at timestamptz;
BEGIN
  IF NEW.invitation_token_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT visit_id, consumed_at
    INTO invitation_visit_id, invitation_consumed_at
    FROM invitation_tokens
   WHERE id = NEW.invitation_token_id
     AND tenant_id = NEW.tenant_id
     AND location_id = NEW.location_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation token is outside the Review Session scope';
  END IF;

  IF invitation_visit_id IS DISTINCT FROM NEW.visit_id THEN
    RAISE EXCEPTION 'Review Session Visit does not match Invitation Token Visit';
  END IF;

  IF invitation_consumed_at IS NULL THEN
    RAISE EXCEPTION 'Invitation Token must be consumed in the admission transaction';
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER review_session_invitation_visit_guard
AFTER INSERT OR UPDATE OF invitation_token_id, visit_id, tenant_id, location_id
ON review_sessions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_review_session_invitation_visit();

CREATE FUNCTION check_claim_has_grounding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM claims WHERE id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM claim_groundings WHERE claim_id = NEW.id) THEN
    RAISE EXCEPTION 'Claim % has no direct grounding', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER claim_requires_grounding
AFTER INSERT OR UPDATE ON claims
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_claim_has_grounding();

CREATE FUNCTION prevent_last_claim_grounding_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM claims WHERE id = OLD.claim_id)
     AND NOT EXISTS (SELECT 1 FROM claim_groundings WHERE claim_id = OLD.claim_id) THEN
    RAISE EXCEPTION 'Claim % has no direct grounding', OLD.claim_id;
  END IF;
  RETURN OLD;
END;
$$;

CREATE CONSTRAINT TRIGGER claim_grounding_delete_guard
AFTER DELETE OR UPDATE OF claim_id ON claim_groundings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION prevent_last_claim_grounding_delete();
