BEGIN;

INSERT INTO entry_mode_definitions (key, semantics)
VALUES ('open-qr', '{"verification":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO providers (id, key, display_name, credential_reference)
VALUES (
  '00000000-0000-4000-8000-000000000201',
  'fake',
  'Synthetic Provider',
  'fake://student'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO provider_models (id, provider_id, model_key)
VALUES (
  '00000000-0000-4000-8000-000000000202',
  (SELECT id FROM providers WHERE key = 'fake'),
  'fake-v1'
)
ON CONFLICT (provider_id, model_key) DO NOTHING;

INSERT INTO price_rates (
  id,
  provider_model_id,
  currency,
  input_per_million_micros,
  output_per_million_micros,
  effective_from
)
VALUES (
  '00000000-0000-4000-8000-000000000203',
  (
    SELECT model.id
    FROM provider_models AS model
    JOIN providers AS provider ON provider.id = model.provider_id
    WHERE provider.key = 'fake' AND model.model_key = 'fake-v1'
  ),
  'EUR',
  0,
  0,
  '2026-08-01T00:00:00.000Z'
)
ON CONFLICT (provider_model_id, effective_from) DO NOTHING;

SELECT set_config(
  'app.tenant_id',
  '00000000-0000-4000-8000-000000000101',
  true
);

INSERT INTO tenants (
  id,
  slug,
  name,
  locale,
  default_entry_mode_key,
  monthly_budget_micros,
  policy
)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  'demo-tenant',
  'Student Demo',
  'en-GB',
  'open-qr',
  0,
  '{"maxActiveGenerations":1}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO locations (id, tenant_id, slug, name)
VALUES (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101',
  'demo-location',
  'Demo Location'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO fact_option_categories (id, tenant_id, key, label)
VALUES (
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000101',
  'service',
  '{"en-GB":"Service"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO fact_option_versions (
  id,
  tenant_id,
  category_id,
  fact_option_key,
  version,
  owner_scope,
  label,
  proposition,
  polarity,
  sort_order,
  is_active
)
VALUES (
  '00000000-0000-4000-8000-000000000104',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000103',
  'attentive',
  1,
  'TENANT',
  '{"en-GB":"The team was attentive"}'::jsonb,
  'The team was attentive.',
  'POSITIVE',
  1,
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO review_format_versions (
  id,
  format_key,
  version,
  locale,
  target_platform,
  constraints,
  localized_text,
  supported_actions,
  content_hash,
  status
)
VALUES (
  '00000000-0000-4000-8000-000000000105',
  'concise-student-demo',
  1,
  'en-GB',
  'google',
  '{"minChars":1,"maxChars":350,"paragraphs":1,"emojiPolicy":"none","secondPerson":false}'::jsonb,
  '{"displayName":{"en-GB":"Concise review"},"description":{"en-GB":"One short paragraph."},"sample":{"en-GB":"The team was attentive."}}'::jsonb,
  ARRAY['GENERATE']::generation_action[],
  'sha256:student-demo-format-v1',
  'ACTIVE'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO review_format_enablements (
  id,
  tenant_id,
  review_format_version_id,
  enabled,
  sort_order,
  allowed_actions
)
VALUES (
  '00000000-0000-4000-8000-000000000106',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000105',
  true,
  1,
  ARRAY['GENERATE']::generation_action[]
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO prompt_versions (
  id,
  tenant_id,
  prompt_key,
  action,
  content_hash,
  body
)
VALUES (
  '00000000-0000-4000-8000-000000000107',
  '00000000-0000-4000-8000-000000000101',
  'generate-v1',
  'GENERATE',
  'prompt-generate-v1',
  'Use only supplied Assertions.'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO effective_configuration_snapshots (
  id,
  tenant_id,
  location_id,
  schema_version,
  content_hash,
  payload,
  provenance
)
VALUES (
  '00000000-0000-4000-8000-000000000108',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  2,
  'sha256:student-demo-snapshot-v1',
  '{
    "snapshotId":"00000000-0000-4000-8000-000000000108",
    "schemaVersion":2,
    "tenantId":"00000000-0000-4000-8000-000000000101",
    "locationId":"00000000-0000-4000-8000-000000000102",
    "tenantName":"Student Demo",
    "locationName":"Demo Location",
    "provenance":{},
    "settings":{
      "locale":"en-GB",
      "toneGuidelines":"Warm and specific.",
      "entryMode":"open-qr",
      "requireDisclosure":false,
      "requireVerifiedExperience":false,
      "maxReviewFormatsPerRequest":1,
      "bannedTerms":[],
      "enabledReviewFormatVersionIds":["00000000-0000-4000-8000-000000000105"],
      "enabledCommands":["generate"],
      "monthlyBudgetMicros":0,
      "alertThresholdPct":80
    },
    "factOptions":[{
      "id":"00000000-0000-4000-8000-000000000104",
      "version":"fact-attentive@1",
      "owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},
      "proposition":"The team was attentive.",
      "categoryId":"00000000-0000-4000-8000-000000000103",
      "polarity":"positive",
      "locale":"en-GB",
      "active":true,
      "sortOrder":1
    }],
    "reviewFormats":[{
      "id":"00000000-0000-4000-8000-000000000105",
      "key":"concise",
      "version":"1.0.0",
      "displayName":"Concise review",
      "targetPlatform":"google",
      "locale":"en-GB",
      "description":{"en-GB":"One short paragraph."},
      "sample":{"en-GB":"The team was attentive."},
      "constraints":{"minChars":1,"maxChars":350,"paragraphs":1,"emojiPolicy":"none","secondPerson":false},
      "supportedCommands":["generate"]
    }],
    "promptVersions":[{
      "id":"00000000-0000-4000-8000-000000000107",
      "hash":"prompt-generate-v1",
      "key":"review.generate",
      "commandKind":"generate",
      "body":"Use only supplied Assertions.",
      "variables":["locale","tone"]
    }],
    "priceRates":[{
      "id":"00000000-0000-4000-8000-000000000203",
      "providerModelId":"00000000-0000-4000-8000-000000000202",
      "provider":"fake",
      "model":"fake-v1",
      "inputPerMillionMicros":0,
      "outputPerMillionMicros":0,
      "currency":"EUR",
      "unit":"token",
      "effectiveFrom":"2026-08-01T00:00:00.000Z",
      "effectiveTo":null
    }],
    "providerRouting":{
      "version":"routing-v1",
      "providerModelId":"00000000-0000-4000-8000-000000000202",
      "primaryProvider":"fake",
      "primaryModel":"fake-v1"
    }
  }'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- The provider catalogue is shared across tenants. When this idempotent seed is
-- applied to a database that already contains the FakeProvider natural keys,
-- retain those canonical catalogue identities in the demo snapshot instead of
-- the preferred bootstrap UUIDs above.
WITH fake_catalogue AS (
  SELECT
    model.id AS provider_model_id,
    rate.id AS price_rate_id
  FROM providers AS provider
  JOIN provider_models AS model ON model.provider_id = provider.id
  JOIN price_rates AS rate ON rate.provider_model_id = model.id
  WHERE provider.key = 'fake'
    AND model.model_key = 'fake-v1'
    AND rate.effective_from = '2026-08-01T00:00:00.000Z'::timestamptz
)
UPDATE effective_configuration_snapshots AS snapshot
SET payload = jsonb_set(
  jsonb_set(
    jsonb_set(
      snapshot.payload,
      '{providerRouting,providerModelId}',
      to_jsonb(fake_catalogue.provider_model_id::text)
    ),
    '{priceRates,0,providerModelId}',
    to_jsonb(fake_catalogue.provider_model_id::text)
  ),
  '{priceRates,0,id}',
  to_jsonb(fake_catalogue.price_rate_id::text)
)
FROM fake_catalogue
WHERE snapshot.id = '00000000-0000-4000-8000-000000000108'
  AND (
    snapshot.payload #>> '{providerRouting,providerModelId}'
  ) IS DISTINCT FROM fake_catalogue.provider_model_id::text;

COMMIT;
