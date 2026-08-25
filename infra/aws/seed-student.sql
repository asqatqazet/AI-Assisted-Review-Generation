BEGIN;

-- All three entry modes exist as data, because Account settings offers all
-- three. With only open-qr seeded, choosing invite or both failed on the
-- foreign key behind that dropdown.
INSERT INTO entry_mode_definitions (key, semantics)
VALUES
  ('open-qr', '{"verification":false}'::jsonb),
  ('invite', '{"verification":true}'::jsonb),
  ('both', '{"verification":"optional"}'::jsonb)
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

-- The strict-$0 student profile always routes through FakeProvider. Clear a
-- previously selected paid primary before upserting the one required primary;
-- migration 18 verifies the final transaction state with a deferred trigger.
UPDATE provider_models
SET routing_priority = NULL
WHERE routing_priority = 1;

INSERT INTO provider_models (id, provider_id, model_key, routing_priority)
VALUES (
  '00000000-0000-4000-8000-000000000202',
  (SELECT id FROM providers WHERE key = 'fake'),
  'fake-v1',
  1
)
ON CONFLICT (provider_id, model_key) DO UPDATE SET
  routing_priority = EXCLUDED.routing_priority;

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
  tone_guidelines,
  banned_terms,
  monthly_budget_micros,
  configuration_values,
  policy
)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  'speicher-neun',
  'Speicher Neun',
  'de-DE',
  'open-qr',
  'Kurz, gesprochen, ohne Superlative. Nie ein Gericht beschreiben, das nicht bestellt wurde.',
  ARRAY['bestes Restaurant der Stadt','gratis']::text[],
  0,
  '{"locale":"de-DE","toneGuidelines":"Kurz, gesprochen, ohne Superlative. Nie ein Gericht beschreiben, das nicht bestellt wurde.","entryMode":"open-qr","requireDisclosure":false,"requireVerifiedExperience":false,"maxReviewFormatsPerRequest":1,"minimumFactSelections":1,"maximumCustomerAssertionChars":500,"bannedTerms":["bestes Restaurant der Stadt","gratis"],"monthlyBudgetMicros":0,"alertThresholdPct":80}'::jsonb,
  '{"maxActiveGenerations":1,"requireDisclosure":false,"requireVerifiedExperience":false,"maxReviewFormatsPerRequest":1,"minimumFactSelections":1,"maximumCustomerAssertionChars":500}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  locale = EXCLUDED.locale,
  default_entry_mode_key = EXCLUDED.default_entry_mode_key,
  tone_guidelines = EXCLUDED.tone_guidelines,
  banned_terms = EXCLUDED.banned_terms,
  monthly_budget_micros = EXCLUDED.monthly_budget_micros,
  configuration_values = EXCLUDED.configuration_values,
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

-- A manual production check left this known disposable Location behind.
-- Delete it when unreferenced; otherwise preserve referential history under a
-- neutral archived identity that cannot leak the garbage fixture into lists.
DO $cleanup$
BEGIN
  DELETE FROM locations
  WHERE tenant_id = '00000000-0000-4000-8000-000000000101'
    AND slug = 'fsdfdsfsdfsd';
EXCEPTION
  WHEN foreign_key_violation THEN
    UPDATE locations
    SET status = 'INACTIVE',
        name = 'Archived test Location',
        slug = 'archived-' || replace(id::text, '-', '')
    WHERE tenant_id = '00000000-0000-4000-8000-000000000101'
      AND slug = 'fsdfdsfsdfsd';
END
$cleanup$;

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
    'unconfigured',
    'https://www.tripadvisor.com/',
    false
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
  body,
  variables,
  version,
  status
)
VALUES (
  '00000000-0000-4000-8000-000000000136',
  '00000000-0000-4000-8000-000000000101',
  'review.generate.release',
  'GENERATE',
  'sha256:faf385e0cafc00a1b456dbedaa29828486d5fc2f2da8cb16a6debf871ae4fbeb',
  'Use only supplied Assertions.',
  ARRAY['locale','tone']::text[],
  3,
  'DRAFT'
)
ON CONFLICT (id) DO NOTHING;

-- Base-only by design. A clean release checkout must append a persisted Prompt
-- Evaluation Report, then the deployment-only qualification command creates the
-- Candidacy Decision and publishes through the production configuration seam.
-- This file must never manufacture Evaluation, Candidate, Deployment or Snapshot
-- rows merely to make the assessment look ready.

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
  ('00000000-0000-4000-8000-000000000101', 'PARAPHRASE', false, 1),
  ('00000000-0000-4000-8000-000000000101', 'REGENERATE', false, 2),
  ('00000000-0000-4000-8000-000000000101', 'CONDENSE', false, 3),
  ('00000000-0000-4000-8000-000000000101', 'REFORMAT', false, 4),
  ('00000000-0000-4000-8000-000000000101', 'EXPAND', false, 5),
  ('00000000-0000-4000-8000-000000000101', 'REVISE_WORDING', false, 6),
  ('00000000-0000-4000-8000-000000000101', 'ADD_FACT', false, 7)
ON CONFLICT (tenant_id, action) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  sort_order = EXCLUDED.sort_order;

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
