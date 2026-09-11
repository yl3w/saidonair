-- Drops the run fence (owner decision 2026-09-11). Runs stopped writing channel state on 2026-09-10, so a run
-- that outlives a decline can only publish episode summaries, which eligibility hides until the channel is
-- approved again; there is nothing left for a version to guard. 0001 stays frozen, so the columns go here.
-- This is the one owner-approved DROP; the additive-only rule holds for everything else.
ALTER TABLE channels DROP COLUMN lifecycle_version;
ALTER TABLE ingestion_runs DROP COLUMN lifecycle_version;
