-- The episode's runtime in seconds, as the transcript provider reported it. Written when the
-- provider answers (markStaged), so it is null for an episode that never reached a transcript and
-- for every episode published before 2026-09-14.
--
-- It is not a diagnostic: the takeaway budget of a reduced summary is a function of it
-- (docs/specs/summary-quality.md), and coverage cannot be scored without it -- a summary that
-- ignores an episode's last half hour is indistinguishable from a complete one when the only
-- runtime we know is the last timestamp the model happened to emit.
ALTER TABLE episodes ADD COLUMN duration_sec INTEGER
  CHECK (duration_sec IS NULL OR duration_sec >= 0);
