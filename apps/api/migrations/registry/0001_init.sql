-- Global Registry DO — initial schema (docs/PRD.md §5.1, §5.3; docs/specs/api-reference-plan.md Step 4).
-- Rewritten 2026-09-10 and again 2026-09-12 before first deployment, with owner approval, to the M3 model:
-- discovery runs are completed feed history, one attempt ledger records every episode execution, episodes
-- carry a processing window with its intent and vector generations, and reasons live on attempts. Migration governance is open
-- (docs/PRD.md §5.4, 2026-09-12): this file may be edited in place; storage that already applied it must be
-- wiped for an edit to run.
-- All timestamps are Unix milliseconds. Every table carries created_at.

-- Identities. `role` is read by GET /me for the web's rendering; the API itself enforces no authorization
-- (docs/PRD.md §2, §9). The deployment seeds OWNER_EMAIL as `owner`; everyone else auto-registers as `user`.
CREATE TABLE global_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'user')),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

-- Shared catalog. `status` is the owner's answer about membership; import outcomes live on episodes. Nothing
-- is deleted: a declined channel keeps every episode, summary, vector, follow, and read receipt, and can be
-- approved or requested again. There is no stored ingestion timestamp: the API derives `lastIngestedAt` from
-- episodes.processed_at (docs/PRD.md §4.2 rule 27).
CREATE TABLE channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'declined')),
  initial_import_count INTEGER NOT NULL DEFAULT 5 CHECK (initial_import_count > 0),
  -- Set at the first approval, never reset. Decides whether a later approval starts an initial import
  -- and whether a declined channel reads "Declined" or "Withdrawn".
  approved_at INTEGER CHECK (approved_at IS NULL OR approved_at >= 0),
  -- Latest review only: approve and decline write these. Kept when a declined channel is re-requested.
  reviewed_at INTEGER CHECK (reviewed_at IS NULL OR reviewed_at >= 0),
  reviewed_by_email TEXT REFERENCES global_users (email),
  review_note TEXT,
  -- Pause stops scheduled discovery on an approved channel. `system` = no active followers; `owner` =
  -- explicit and cleared only by resume.
  paused_by TEXT CHECK (paused_by IS NULL OR paused_by IN ('owner', 'system')),
  paused_at INTEGER CHECK (paused_at IS NULL OR paused_at >= 0),
  -- When the feed was last read successfully; an unavailable feed does not move it.
  last_checked_at INTEGER CHECK (last_checked_at IS NULL OR last_checked_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CHECK (status = 'requested' OR (reviewed_at IS NOT NULL AND reviewed_by_email IS NOT NULL)),
  CHECK ((paused_by IS NULL) = (paused_at IS NULL)),
  CHECK (paused_by IS NULL OR status = 'approved')
);

-- Cron selection: approved and not paused.
CREATE INDEX channels_status_paused_by ON channels (status, paused_by);

-- The one record of who follows what (docs/PRD.md §4.3, decided 2026-09-13): the user's own list, the follower
-- count, the owner's queue, the automatic pause, and eligibility all read these rows. An active follow is
-- unfollowed_at IS NULL; an unfollow keeps the row as a tombstone that an explicit refollow clears.
CREATE TABLE channel_followers (
  channel_id TEXT NOT NULL REFERENCES channels (channel_id),
  user_email TEXT NOT NULL REFERENCES global_users (email),
  followed_at INTEGER NOT NULL CHECK (followed_at >= 0),
  unfollowed_at INTEGER CHECK (unfollowed_at IS NULL OR unfollowed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (channel_id, user_email)
);

CREATE INDEX channel_followers_channel_id_unfollowed_at ON channel_followers (channel_id, unfollowed_at);
-- A user's own list and eligibility.
CREATE INDEX channel_followers_user_email_unfollowed_at ON channel_followers (user_email, unfollowed_at);

-- Discovery runs: one completed RSS feed check of one channel (docs/PRD.md §4.2 rules 1–4). A run exists only
-- once complete, so it has no status, Workflow, or failure columns; episode processing history is on
-- episode_ingestion_attempts, and an episode names the run that discovered it (no run-episode table).
CREATE TABLE ingestion_runs (
  run_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (channel_id),
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'scheduled')),
  feed_status TEXT NOT NULL CHECK (feed_status IN ('read', 'unavailable')),
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  -- The initial run's initial_import_count; null for a scheduled run.
  episode_limit INTEGER CHECK (episode_limit IS NULL OR episode_limit > 0),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  finished_at INTEGER NOT NULL CHECK (finished_at >= started_at),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  -- An unavailable feed discovers nothing.
  CHECK (feed_status = 'read' OR discovered_count = 0)
);

CREATE INDEX ingestion_runs_channel_id_created_at ON ingestion_runs (channel_id, created_at);

-- Episodes carry the state machine (`pending`, `available`, `failed`, `skipped`) and, separately, the processing
-- window: an `intent` (`publish` the first summary, or `replace` an existing one) with its start, 48-hour
-- deadline, and next attempt time (docs/PRD.md §4.2 rules 5, 10, 13–14). The window opens at creation, not after
-- a failure. Reasons live on attempts: the row carries no waiting or technical code while the window is open,
-- and failure_code is written once, at the timeout, as INGESTION_TIMEOUT with the latest attempt's reason as detail.
CREATE TABLE episodes (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (channel_id),
  -- Immutable: the run that created this row, so a run's episodes are a join, not a table.
  discovered_by_run_id TEXT NOT NULL REFERENCES ingestion_runs (run_id),
  title TEXT NOT NULL,
  published_at INTEGER NOT NULL CHECK (published_at >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'available', 'failed', 'skipped')),
  intent TEXT CHECK (intent IS NULL OR intent IN ('publish', 'replace')),
  window_started_at INTEGER CHECK (window_started_at IS NULL OR window_started_at >= 0),
  window_deadline_at INTEGER CHECK (window_deadline_at IS NULL OR window_deadline_at >= 0),
  next_attempt_at INTEGER CHECK (next_attempt_at IS NULL OR next_attempt_at >= 0),
  -- Attempts that launched a Workflow since the window last started; blocked attempts never count. Diagnostic.
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_code TEXT CHECK (failure_code IS NULL OR failure_code = 'INGESTION_TIMEOUT'),
  failure_detail TEXT,
  skip_reason TEXT CHECK (skip_reason IS NULL OR skip_reason IN ('SHORT', 'NON_ENGLISH', 'UNPLAYABLE', 'OWNER')),
  skipped_at INTEGER CHECK (skipped_at IS NULL OR skipped_at >= 0),
  skipped_by_email TEXT REFERENCES global_users (email),
  transcript_checked_at INTEGER CHECK (transcript_checked_at IS NULL OR transcript_checked_at >= 0),
  chunk_count INTEGER CHECK (chunk_count IS NULL OR chunk_count >= 0),
  vectorized_at INTEGER CHECK (vectorized_at IS NULL OR vectorized_at >= 0),
  -- First availability; never reset (the API's summaryAvailableAt and the digest's basis).
  processed_at INTEGER CHECK (processed_at IS NULL OR processed_at >= 0),
  -- The vector generation retrieval may use, and the one the open window's attempts are staging
  -- (docs/PRD.md §4.2 rules 24–26).
  active_vector_generation TEXT,
  staged_vector_generation TEXT,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  -- Available means a verified generation is active and a summary exists.
  CHECK (
    status <> 'available'
    OR (chunk_count IS NOT NULL AND chunk_count > 0 AND vectorized_at IS NOT NULL AND processed_at IS NOT NULL
        AND active_vector_generation IS NOT NULL)
  ),
  -- failure_code is INGESTION_TIMEOUT exactly when failed, null otherwise.
  CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  -- The intent and its three window timestamps are all set or all null.
  CHECK ((intent IS NULL) = (window_started_at IS NULL)),
  CHECK ((intent IS NULL) = (window_deadline_at IS NULL)),
  CHECK ((intent IS NULL) = (next_attempt_at IS NULL)),
  CHECK (intent IS NULL OR window_deadline_at >= window_started_at),
  -- Publishing belongs to a pending episode, replacing to an available one.
  CHECK (intent IS NOT 'publish' OR status = 'pending'),
  CHECK (intent IS NOT 'replace' OR status = 'available'),
  -- A staged generation exists only while a window is open.
  CHECK (staged_vector_generation IS NULL OR intent IS NOT NULL),
  -- Skips: reason and status imply each other, a skipped episode is dated, and OWNER names who skipped.
  CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  CHECK (status <> 'skipped' OR skipped_at IS NOT NULL),
  CHECK ((skip_reason IS 'OWNER') = (skipped_by_email IS NOT NULL))
);

CREATE INDEX episodes_channel_id_status_published_at ON episodes (channel_id, status, published_at);
-- Recovery selection: everything due.
CREATE INDEX episodes_next_attempt_at ON episodes (next_attempt_at);
-- A discovery run's episodes.
CREATE INDEX episodes_discovered_by_run_id ON episodes (discovered_by_run_id);
-- The derived per-channel ingestion time.
CREATE INDEX episodes_channel_id_processed_at ON episodes (channel_id, processed_at);

-- One shared summary per episode. takeaways_json is an array of { text, startSec } objects (docs/PRD.md §4.4).
CREATE TABLE episode_summaries (
  video_id TEXT PRIMARY KEY REFERENCES episodes (video_id),
  format TEXT NOT NULL CHECK (format IN ('structured', 'raw_fallback')),
  executive_summary TEXT,
  takeaways_json TEXT,
  topic_tags_json TEXT,
  raw_text TEXT,
  related_video_ids_json TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (
    (format = 'structured'
      AND executive_summary IS NOT NULL AND takeaways_json IS NOT NULL AND topic_tags_json IS NOT NULL)
    OR (format = 'raw_fallback' AND raw_text IS NOT NULL)
  )
);

-- The one execution ledger: first processing, scheduled recovery, and owner Retry are each one row, and each
-- launched row is one Workflow instance (docs/PRD.md §4.2 rules 6–9). A `blocked` row records a start that
-- pre-flight refused and never launched. outcome_code is the AttemptOutcomeCode enum of the API contract;
-- its CHECK lands at the end of M3 (docs/specs/m3-7-owner-ux-plan.md Step 3), once every outcome has run for real.
CREATE TABLE episode_ingestion_attempts (
  attempt_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES episodes (video_id),
  trigger TEXT NOT NULL CHECK (trigger IN ('channel_ingestion', 'scheduled_recovery', 'owner_retry')),
  intent TEXT NOT NULL CHECK (intent IN ('publish', 'replace')),
  generation_id TEXT,
  -- Set when embedding begins, so the next attempt can delete an abandoned staged generation.
  staged_chunk_count INTEGER CHECK (staged_chunk_count IS NULL OR staged_chunk_count >= 0),
  workflow_id TEXT UNIQUE,
  requested_by_email TEXT REFERENCES global_users (email),
  status TEXT NOT NULL CHECK (status IN ('running', 'available', 'waiting', 'failed', 'skipped', 'blocked')),
  outcome_code TEXT,
  failure_detail TEXT,
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  finished_at INTEGER CHECK (finished_at IS NULL OR finished_at >= started_at),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  -- Running has no end; every other status has one.
  CHECK ((status = 'running') = (finished_at IS NULL)),
  -- A blocked start never launched an instance.
  CHECK (status <> 'blocked' OR workflow_id IS NULL),
  -- Owner Retry names who asked; the automatic triggers name nobody.
  CHECK ((trigger = 'owner_retry') = (requested_by_email IS NOT NULL))
);

CREATE INDEX episode_ingestion_attempts_video_id_created_at ON episode_ingestion_attempts (video_id, created_at);
-- Reconciliation: running attempts older than an hour.
CREATE INDEX episode_ingestion_attempts_status_started_at ON episode_ingestion_attempts (status, started_at);
