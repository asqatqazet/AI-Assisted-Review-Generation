-- A verification challenge is permanently closed after its fifth failed
-- evidence attempt. The count belongs to the short-lived Entry Challenge;
-- Invitation Tokens remain untouched until successful admission.
ALTER TABLE entry_challenges
  ADD COLUMN verification_failure_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT entry_challenges_verification_failure_count_check
    CHECK (verification_failure_count BETWEEN 0 AND 5);
