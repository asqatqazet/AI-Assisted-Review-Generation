-- The Prompt deployment identity is the Action, not the Prompt Version id.
-- Preserve Drafts written by the expand-phase release by deriving that Action
-- from the same-Tenant immutable Prompt. An orphan is a release blocker: never
-- guess, drop the change, or let a later JSON decoder turn it into a 500.

DO $legacy_prompt_deployment_draft_guard$
DECLARE
  orphaned_draft_id uuid;
  orphaned_prompt_version_id text;
BEGIN
  SELECT draft.id, change.value ->> 'promptVersionId'
  INTO orphaned_draft_id, orphaned_prompt_version_id
  FROM configuration_drafts AS draft
  CROSS JOIN LATERAL jsonb_array_elements(draft.changes)
    WITH ORDINALITY AS change(value, ordinal)
  LEFT JOIN prompt_versions AS prompt
    ON prompt.tenant_id = draft.tenant_id
   AND (change.value ->> 'promptVersionId') ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   AND prompt.id = (change.value ->> 'promptVersionId')::uuid
  WHERE change.value ->> 'operation' = 'deploy-prompt-version'
    AND NOT (change.value ? 'action')
    AND prompt.id IS NULL
  ORDER BY draft.id, change.ordinal
  LIMIT 1;

  IF orphaned_draft_id IS NOT NULL THEN
    RAISE EXCEPTION
      'LEGACY_PROMPT_DEPLOYMENT_DRAFT_ORPHANED: Draft % references Prompt Version % outside its Tenant or no longer resolvable; cancel or repair that Draft before deploying',
      orphaned_draft_id,
      coalesce(orphaned_prompt_version_id, '<missing>');
  END IF;
END
$legacy_prompt_deployment_draft_guard$;

WITH normalized AS (
  SELECT
    draft.id,
    jsonb_agg(
      CASE
        WHEN change.value ->> 'operation' = 'deploy-prompt-version'
         AND NOT (change.value ? 'action')
        THEN change.value || jsonb_build_object(
          'action',
          CASE prompt.action
            WHEN 'GENERATE' THEN 'generate'
            WHEN 'PARAPHRASE' THEN 'paraphrase'
            WHEN 'REGENERATE' THEN 'resample'
            WHEN 'REFORMAT' THEN 'reformat'
            WHEN 'CONDENSE' THEN 'condense'
            WHEN 'EXPAND' THEN 'expand'
            WHEN 'REVISE_WORDING' THEN 'revise-wording'
            WHEN 'ADD_FACT' THEN 'add-assertion'
          END
        )
        ELSE change.value
      END
      ORDER BY change.ordinal
    ) AS changes
  FROM configuration_drafts AS draft
  CROSS JOIN LATERAL jsonb_array_elements(draft.changes)
    WITH ORDINALITY AS change(value, ordinal)
  LEFT JOIN prompt_versions AS prompt
    ON prompt.tenant_id = draft.tenant_id
   AND change.value ->> 'operation' = 'deploy-prompt-version'
   AND (change.value ->> 'promptVersionId') ~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   AND prompt.id = (change.value ->> 'promptVersionId')::uuid
  GROUP BY draft.id
)
UPDATE configuration_drafts AS draft
SET changes = normalized.changes
FROM normalized
WHERE draft.id = normalized.id
  AND draft.changes IS DISTINCT FROM normalized.changes;
