CREATE TYPE review_session_journey_phase AS ENUM (
  'FACTS',
  'PARAPHRASE_INPUT',
  'FORMAT',
  'RESULTS',
  'EDITING',
  'DONE'
);

ALTER TABLE review_sessions
  ADD COLUMN journey_phase review_session_journey_phase NOT NULL DEFAULT 'FACTS',
  ADD COLUMN selected_fact_option_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ADD COLUMN customer_assertion text NOT NULL DEFAULT '',
  ADD COLUMN source_text text NOT NULL DEFAULT '',
  ADD COLUMN selected_review_format_version_id uuid,
  ADD CONSTRAINT review_sessions_selected_facts_limit
    CHECK (cardinality(selected_fact_option_ids) <= 100),
  ADD CONSTRAINT review_sessions_customer_assertion_limit
    CHECK (char_length(customer_assertion) <= 5000),
  ADD CONSTRAINT review_sessions_source_text_limit
    CHECK (char_length(source_text) <= 10000),
  ADD CONSTRAINT review_sessions_selected_format_fk
    FOREIGN KEY (selected_review_format_version_id)
    REFERENCES review_format_versions(id)
    ON DELETE RESTRICT;

COMMENT ON COLUMN review_sessions.customer_assertion IS
  'Provisional reviewer-authored input. It becomes grounding only when admission creates an immutable Assertion.';
COMMENT ON COLUMN review_sessions.source_text IS
  'Provisional Paraphrase source. It becomes grounding only through an immutable Source Text Revision and span-anchored Assertions.';
