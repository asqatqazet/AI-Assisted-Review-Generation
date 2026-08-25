-- Bind optimistic concurrency to both the published scope revision and the
-- mutable Draft revision. A write to a Draft is itself a versioned change.
ALTER TABLE configuration_drafts
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);

ALTER TABLE configuration_audit_events
  ADD COLUMN draft_id uuid,
  ADD COLUMN draft_revision bigint,
  ADD CONSTRAINT configuration_audit_events_draft_version_pair
    CHECK (
      (draft_id IS NULL AND draft_revision IS NULL)
      OR (draft_id IS NOT NULL AND draft_revision IS NOT NULL AND draft_revision > 0)
    );

CREATE UNIQUE INDEX configuration_audit_events_published_draft_unique
  ON configuration_audit_events (draft_id)
  WHERE draft_id IS NOT NULL;

-- Platform defaults are complete. Tenant values are deliberately sparse so
-- field provenance can distinguish inheritance from an explicit override.
INSERT INTO platform_settings (id, default_policy, rate_limits)
VALUES ('platform', '{}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

UPDATE platform_settings
SET default_policy = jsonb_build_object(
  'locale', 'en-GB',
  'toneGuidelines', 'Plain, factual, first person.',
  'entryMode', 'invite',
  'requireDisclosure', true,
  'requireVerifiedExperience', true,
  'maxReviewFormatsPerRequest', 1,
  'minimumFactSelections', 1,
  'maximumCustomerAssertionChars', 500,
  'bannedTerms', '[]'::jsonb,
  'enabledReviewFormatVersionIds', '[]'::jsonb,
  'enabledCommands', '[]'::jsonb,
  'monthlyBudgetMicros', 0,
  'alertThresholdPct', 80
) || default_policy
WHERE id = 'platform';

ALTER TABLE tenants
  ADD COLUMN configuration_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT tenants_configuration_values_object
    CHECK (jsonb_typeof(configuration_values) = 'object');

-- Existing rows already expressed concrete Tenant values through legacy
-- columns. Preserve that meaning during rollout; new Tenants start sparse.
UPDATE tenants
SET configuration_values = jsonb_build_object(
  'locale', locale,
  'toneGuidelines', COALESCE(tone_guidelines, ''),
  'entryMode', COALESCE(default_entry_mode_key, 'invite'),
  'requireDisclosure', COALESCE((policy ->> 'requireDisclosure')::boolean, true),
  'requireVerifiedExperience', COALESCE((policy ->> 'requireVerifiedExperience')::boolean, true),
  'maxReviewFormatsPerRequest', COALESCE((policy ->> 'maxReviewFormatsPerRequest')::integer, 1),
  'minimumFactSelections', COALESCE((policy ->> 'minimumFactSelections')::integer, 1),
  'maximumCustomerAssertionChars', COALESCE((policy ->> 'maximumCustomerAssertionChars')::integer, 500),
  'bannedTerms', to_jsonb(banned_terms),
  'monthlyBudgetMicros', monthly_budget_micros,
  'alertThresholdPct', alert_threshold_percent
);
