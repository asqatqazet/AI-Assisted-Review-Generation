BEGIN;

INSERT INTO entry_mode_definitions (key, semantics)
VALUES ('open-qr', '{"verification":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO providers (id, key, display_name, credential_reference)
VALUES (
  '00000000-0000-4000-8000-000000000201',
  'fake',
  'Fake provider',
  'fake://deterministic'
)
ON CONFLICT (key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  credential_reference = EXCLUDED.credential_reference;

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
  'speicher-neun',
  'Speicher Neun',
  'de-DE',
  'open-qr',
  0,
  '{"maxActiveGenerations":1,"minimumFactSelections":2,"maximumCustomerAssertionChars":500}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  locale = EXCLUDED.locale,
  default_entry_mode_key = EXCLUDED.default_entry_mode_key,
  monthly_budget_micros = EXCLUDED.monthly_budget_micros,
  policy = EXCLUDED.policy;

INSERT INTO locations (id, tenant_id, slug, name)
VALUES (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000101',
  'hafencity',
  'Speicher Neun · HafenCity'
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name;

INSERT INTO posting_destination_types (id, key, external_id_schema, status)
VALUES
  (
    '00000000-0000-4000-8000-000000000140',
    'google',
    '{"displayName":"Google Maps","identifier":"placeQuery"}'::jsonb,
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000000141',
    'tripadvisor',
    '{"displayName":"Tripadvisor","identifier":"locationQuery"}'::jsonb,
    'ACTIVE'
  )
ON CONFLICT (key) DO UPDATE SET
  external_id_schema = EXCLUDED.external_id_schema,
  status = EXCLUDED.status;

INSERT INTO posting_destination_bindings (
  id,
  tenant_id,
  location_id,
  destination_type_id,
  external_id,
  target_url,
  enabled
)
VALUES
  (
    '00000000-0000-4000-8000-000000000142',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    (SELECT id FROM posting_destination_types WHERE key = 'google'),
    'Speicher Neun HafenCity',
    'https://www.google.com/maps/search/?api=1&query=Speicher%20Neun%20HafenCity',
    true
  ),
  (
    '00000000-0000-4000-8000-000000000143',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
    (SELECT id FROM posting_destination_types WHERE key = 'tripadvisor'),
    'Speicher Neun HafenCity',
    'https://www.tripadvisor.com/Search?q=Speicher%20Neun%20HafenCity',
    true
  )
ON CONFLICT (tenant_id, location_id, destination_type_id) DO UPDATE SET
  external_id = EXCLUDED.external_id,
  target_url = EXCLUDED.target_url,
  enabled = EXCLUDED.enabled;

-- Preserve historical catalogue versions from earlier releases. They may be
-- referenced by immutable Generations, so retire/disable them instead of
-- rewriting their versioned content.
UPDATE fact_option_versions
SET is_active = false,
    retired_at = COALESCE(retired_at, clock_timestamp())
WHERE id = '00000000-0000-4000-8000-000000000104'
  AND tenant_id = '00000000-0000-4000-8000-000000000101';

UPDATE review_format_enablements
SET enabled = false
WHERE id = '00000000-0000-4000-8000-000000000106'
  AND tenant_id = '00000000-0000-4000-8000-000000000101';

INSERT INTO fact_option_categories (id, tenant_id, key, label)
VALUES
  (
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000101',
    'service',
    '{"de-DE":"Service","en-GB":"Service"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000109',
    '00000000-0000-4000-8000-000000000101',
    'essen',
    '{"de-DE":"Essen","en-GB":"Food"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000101',
    'atmosphaere',
    '{"de-DE":"Atmosphäre","en-GB":"Atmosphere"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000101',
    'preis',
    '{"de-DE":"Preis","en-GB":"Value"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000112',
    '00000000-0000-4000-8000-000000000101',
    'wartezeit',
    '{"de-DE":"Wartezeit","en-GB":"Waiting time"}'::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  key = EXCLUDED.key,
  label = EXCLUDED.label;

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
VALUES
  ('00000000-0000-4000-8000-000000000130','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000109','s1',1,'TENANT','{"de-DE":"Frischer Fisch","en-GB":"Fresh fish"}'::jsonb,'Frischer Fisch.','POSITIVE',10,true),
  ('00000000-0000-4000-8000-000000000113','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000109','s2',1,'TENANT','{"de-DE":"Gut gewürzt","en-GB":"Well seasoned"}'::jsonb,'Gut gewürzt.','POSITIVE',20,true),
  ('00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000109','s3',1,'TENANT','{"de-DE":"Essen war kalt","en-GB":"The food was cold"}'::jsonb,'Essen war kalt.','NEGATIVE',30,true),
  ('00000000-0000-4000-8000-000000000115','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000103','s4',1,'TENANT','{"de-DE":"Aufmerksamer Service","en-GB":"Attentive service"}'::jsonb,'Aufmerksamer Service.','POSITIVE',40,true),
  ('00000000-0000-4000-8000-000000000116','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000103','s5',1,'TENANT','{"de-DE":"Freundliches Personal","en-GB":"Friendly staff"}'::jsonb,'Freundliches Personal.','POSITIVE',50,true),
  ('00000000-0000-4000-8000-000000000117','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000112','s6',1,'TENANT','{"de-DE":"Lange Wartezeit","en-GB":"Long wait"}'::jsonb,'Lange Wartezeit.','NEGATIVE',60,true),
  ('00000000-0000-4000-8000-000000000118','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000112','s7',1,'TENANT','{"de-DE":"Essen kam schnell","en-GB":"Food arrived quickly"}'::jsonb,'Essen kam schnell.','POSITIVE',70,true),
  ('00000000-0000-4000-8000-000000000119','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000110','s8',1,'TENANT','{"de-DE":"Blick auf den Hafen","en-GB":"Harbour view"}'::jsonb,'Blick auf den Hafen.','POSITIVE',80,true),
  ('00000000-0000-4000-8000-000000000120','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000110','s9',1,'TENANT','{"de-DE":"Zu laut","en-GB":"Too loud"}'::jsonb,'Zu laut.','NEGATIVE',90,true),
  ('00000000-0000-4000-8000-000000000121','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000111','s10',1,'TENANT','{"de-DE":"Fairer Preis","en-GB":"Fair price"}'::jsonb,'Fairer Preis.','POSITIVE',100,true)
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
VALUES
  (
    '00000000-0000-4000-8000-000000000122',
    'concise-blurb',
    1,
    'any',
    'google',
    '{"minChars":20,"maxChars":420,"paragraphs":1,"emojiPolicy":"none","secondPerson":false}'::jsonb,
    '{"displayName":{"de-DE":"Kurzer Text","en-GB":"Concise blurb"},"description":{"de-DE":"Zwei oder drei Sätze. Was passiert ist, in der Reihenfolge, in der es passiert ist.","en-GB":"Two or three sentences. What happened, in the order it happened."},"sample":{"de-DE":"Frischer Fisch, gut gewürzt, und der Service war aufmerksam. Der Blick auf den Hafen hat den Abend gemacht.","en-GB":"Fresh fish, well seasoned, with attentive service."}}'::jsonb,
    ARRAY['GENERATE']::generation_action[],
    'sha256:speicher-neun-concise-blurb-v1',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-000000000123',
    'social-short',
    1,
    'any',
    'tripadvisor',
    '{"minChars":20,"maxChars":140,"paragraphs":1,"emojiPolicy":"allowed","secondPerson":false}'::jsonb,
    '{"displayName":{"de-DE":"Kurz für Portale","en-GB":"Social short"},"description":{"de-DE":"Eine Zeile, für Portale mit harter Zeichenbegrenzung.","en-GB":"One line, for listing sites with a hard character limit."},"sample":{"de-DE":"Frischer Fisch, aufmerksamer Service, Blick auf den Hafen.","en-GB":"Fresh fish, attentive service, harbour view."}}'::jsonb,
    ARRAY['GENERATE']::generation_action[],
    'sha256:speicher-neun-social-short-v1',
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
VALUES
  ('00000000-0000-4000-8000-000000000124','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000122',true,1,ARRAY['GENERATE']::generation_action[]),
  ('00000000-0000-4000-8000-000000000125','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000123',true,2,ARRAY['GENERATE']::generation_action[])
ON CONFLICT (id) DO UPDATE SET
  review_format_version_id = EXCLUDED.review_format_version_id,
  enabled = EXCLUDED.enabled,
  sort_order = EXCLUDED.sort_order,
  allowed_actions = EXCLUDED.allowed_actions;

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
  '00000000-0000-4000-8000-000000000127',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  2,
  'sha256:speicher-neun-hafencity-v1',
  '{
    "snapshotId":"00000000-0000-4000-8000-000000000127",
    "schemaVersion":2,
    "tenantId":"00000000-0000-4000-8000-000000000101",
    "locationId":"00000000-0000-4000-8000-000000000102",
    "tenantName":"Speicher Neun",
    "locationName":"Speicher Neun · HafenCity",
    "provenance":{},
    "settings":{
      "locale":"de-DE",
      "toneGuidelines":"Kurz, gesprochen, ohne Superlative. Nie ein Gericht beschreiben, das nicht bestellt wurde.",
      "entryMode":"open-qr",
      "requireDisclosure":false,
      "requireVerifiedExperience":false,
      "maxReviewFormatsPerRequest":1,
      "bannedTerms":["bestes Restaurant der Stadt","gratis"],
      "enabledReviewFormatVersionIds":["00000000-0000-4000-8000-000000000122","00000000-0000-4000-8000-000000000123"],
      "enabledCommands":["generate"],
      "monthlyBudgetMicros":0,
      "alertThresholdPct":80
    },
    "factOptions":[
      {"id":"00000000-0000-4000-8000-000000000130","version":"s1@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Frischer Fisch.","categoryId":"00000000-0000-4000-8000-000000000109","polarity":"positive","locale":"de-DE","active":true,"sortOrder":10},
      {"id":"00000000-0000-4000-8000-000000000113","version":"s2@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Gut gewürzt.","categoryId":"00000000-0000-4000-8000-000000000109","polarity":"positive","locale":"de-DE","active":true,"sortOrder":20},
      {"id":"00000000-0000-4000-8000-000000000114","version":"s3@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Essen war kalt.","categoryId":"00000000-0000-4000-8000-000000000109","polarity":"negative","locale":"de-DE","active":true,"sortOrder":30},
      {"id":"00000000-0000-4000-8000-000000000115","version":"s4@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Aufmerksamer Service.","categoryId":"00000000-0000-4000-8000-000000000103","polarity":"positive","locale":"de-DE","active":true,"sortOrder":40},
      {"id":"00000000-0000-4000-8000-000000000116","version":"s5@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Freundliches Personal.","categoryId":"00000000-0000-4000-8000-000000000103","polarity":"positive","locale":"de-DE","active":true,"sortOrder":50},
      {"id":"00000000-0000-4000-8000-000000000117","version":"s6@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Lange Wartezeit.","categoryId":"00000000-0000-4000-8000-000000000112","polarity":"negative","locale":"de-DE","active":true,"sortOrder":60},
      {"id":"00000000-0000-4000-8000-000000000118","version":"s7@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Essen kam schnell.","categoryId":"00000000-0000-4000-8000-000000000112","polarity":"positive","locale":"de-DE","active":true,"sortOrder":70},
      {"id":"00000000-0000-4000-8000-000000000119","version":"s8@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Blick auf den Hafen.","categoryId":"00000000-0000-4000-8000-000000000110","polarity":"positive","locale":"de-DE","active":true,"sortOrder":80},
      {"id":"00000000-0000-4000-8000-000000000120","version":"s9@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Zu laut.","categoryId":"00000000-0000-4000-8000-000000000110","polarity":"negative","locale":"de-DE","active":true,"sortOrder":90},
      {"id":"00000000-0000-4000-8000-000000000121","version":"s10@1","owner":{"scope":"tenant","tenantId":"00000000-0000-4000-8000-000000000101"},"proposition":"Fairer Preis.","categoryId":"00000000-0000-4000-8000-000000000111","polarity":"positive","locale":"de-DE","active":true,"sortOrder":100}
    ],
    "reviewFormats":[
      {"id":"00000000-0000-4000-8000-000000000122","key":"concise-blurb","version":"1.0.0","displayName":"Kurzer Text","targetPlatform":"google","locale":"any","description":{"de-DE":"Zwei oder drei Sätze. Was passiert ist, in der Reihenfolge, in der es passiert ist."},"sample":{"de-DE":"Frischer Fisch, gut gewürzt, und der Service war aufmerksam. Der Blick auf den Hafen hat den Abend gemacht."},"constraints":{"minChars":20,"maxChars":420,"paragraphs":1,"emojiPolicy":"none","secondPerson":false},"supportedCommands":["generate"]},
      {"id":"00000000-0000-4000-8000-000000000123","key":"social-short","version":"1.0.0","displayName":"Kurz für Portale","targetPlatform":"tripadvisor","locale":"any","description":{"de-DE":"Eine Zeile, für Portale mit harter Zeichenbegrenzung."},"sample":{"de-DE":"Frischer Fisch, aufmerksamer Service, Blick auf den Hafen."},"constraints":{"minChars":20,"maxChars":140,"paragraphs":1,"emojiPolicy":"allowed","secondPerson":false},"supportedCommands":["generate"]}
    ],
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
-- retain those canonical catalogue identities in the product snapshot instead of
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
WHERE snapshot.id = '00000000-0000-4000-8000-000000000127'
  AND (
    snapshot.payload #>> '{providerRouting,providerModelId}'
  ) IS DISTINCT FROM fake_catalogue.provider_model_id::text;

-- The Console's Drafting actions screen reads the Platform Action catalogue and
-- this account's enablements. Neither existed, so the screen had nothing to
-- show and no Action could be turned on or off.
INSERT INTO action_definitions (action, input_contract, status)
VALUES
  ('GENERATE', '{"requiredInputs":["rating","assertions"]}'::jsonb, 'ACTIVE'),
  ('PARAPHRASE', '{"requiredInputs":["sourceText"]}'::jsonb, 'ACTIVE'),
  ('REGENERATE', '{"requiredInputs":["sourceGeneration"]}'::jsonb, 'ACTIVE'),
  ('REFORMAT', '{"requiredInputs":["sourceGeneration","reviewFormat"]}'::jsonb, 'ACTIVE'),
  ('CONDENSE', '{"requiredInputs":["sourceGeneration"]}'::jsonb, 'ACTIVE'),
  ('EXPAND', '{"requiredInputs":["sourceGeneration"]}'::jsonb, 'ACTIVE'),
  ('REVISE_WORDING', '{"requiredInputs":["sourceGeneration"]}'::jsonb, 'ACTIVE'),
  ('ADD_FACT', '{"requiredInputs":["sourceGeneration","assertions"]}'::jsonb, 'ACTIVE')
ON CONFLICT (action) DO UPDATE SET
  input_contract = EXCLUDED.input_contract,
  status = EXCLUDED.status;

INSERT INTO tenant_action_enablements (tenant_id, action, enabled, sort_order)
VALUES
  ('00000000-0000-4000-8000-000000000101', 'GENERATE', true, 0),
  ('00000000-0000-4000-8000-000000000101', 'PARAPHRASE', true, 1),
  ('00000000-0000-4000-8000-000000000101', 'REGENERATE', true, 2),
  ('00000000-0000-4000-8000-000000000101', 'CONDENSE', true, 3),
  ('00000000-0000-4000-8000-000000000101', 'REFORMAT', false, 4),
  ('00000000-0000-4000-8000-000000000101', 'EXPAND', false, 5),
  ('00000000-0000-4000-8000-000000000101', 'REVISE_WORDING', false, 6),
  ('00000000-0000-4000-8000-000000000101', 'ADD_FACT', false, 7)
ON CONFLICT (tenant_id, action) DO NOTHING;

-- Platform settings had no row at all, so the Console showed a policy of {} and
-- every rate limit as zero, which reads as a broken deployment rather than a
-- default one.
INSERT INTO platform_settings (id, default_policy, rate_limits, log_retention_days)
VALUES (
  'platform',
  '{"requireDisclosure":true,"requireVerifiedExperience":true,"maxReviewFormatsPerRequest":2}'::jsonb,
  '{"perReviewSessionPerHour":20,"perTenantPerMinute":60,"maxConcurrentGenerations":4}'::jsonb,
  7
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO feature_flags (key, enabled, rules)
VALUES
  ('console.bench', false, '{"description":"Operator Generation bench"}'::jsonb),
  ('console.analytics', false, '{"description":"Generation analytics and audit"}'::jsonb)
ON CONFLICT (key) DO UPDATE SET rules = EXCLUDED.rules;

-- Google Gemini as a live routing option. The credential reference is left
-- empty here and set by the deploy only when a key was actually installed, so
-- the Console's configured/missing state stays truthful.
INSERT INTO providers (id, key, display_name, credential_reference, status, is_default, is_fallback)
VALUES (
  '00000000-0000-4000-8000-000000000205',
  'gemini',
  'Google Gemini',
  '',
  'ACTIVE',
  false,
  false
)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status;

INSERT INTO provider_models (
  id, provider_id, model_key, capabilities, status, routing_priority, fallback_priority
)
VALUES (
  '00000000-0000-4000-8000-000000000206',
  '00000000-0000-4000-8000-000000000205',
  'gemini-2.0-flash',
  '{"streaming":true,"structuredOutput":true,"maxTokens":8192}'::jsonb,
  'ACTIVE',
  NULL,
  1
)
ON CONFLICT (id) DO UPDATE SET
  capabilities = EXCLUDED.capabilities,
  status = EXCLUDED.status;

INSERT INTO price_rates (
  id, provider_model_id, currency, input_per_million_micros,
  output_per_million_micros, effective_from
)
VALUES (
  '00000000-0000-4000-8000-000000000207',
  '00000000-0000-4000-8000-000000000206',
  'EUR',
  100000,
  400000,
  TIMESTAMPTZ '2026-01-01 00:00:00+00'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
