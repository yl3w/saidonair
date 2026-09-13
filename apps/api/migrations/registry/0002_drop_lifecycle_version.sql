-- Drops the run fence (owner decision 2026-09-11). Runs stopped writing channel state on 2026-09-10, so a run
-- that outlives a decline can only publish episode summaries, which eligibility hides until the channel is
-- approved again; there is nothing left for a version to guard. 0001 was frozen at the time, so the columns went here
-- (that rule and the additive-only rule were both withdrawn on 2026-09-12, docs/PRD.md §5.4).
ALTER TABLE channels DROP COLUMN lifecycle_version;
ALTER TABLE ingestion_runs DROP COLUMN lifecycle_version;
