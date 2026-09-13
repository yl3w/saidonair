-- Global Registry DO — initial schema (docs/PRD.md §5.1, §5.3; docs/specs/channel-simplification.md §3, §6).
-- Rewritten 2026-09-10 before first deployment, with owner approval. Migration governance is open (docs/PRD.md
-- §5.4, 2026-09-12): this file may be edited in place; storage that already applied it must be wiped for an edit to run.
-- All timestamps are Unix milliseconds. Every table carries created_at.

-- Identities. `role` is the owner mechanism decided in AGENTS.md → Identity model:
-- the deployment seeds OWNER_EMAIL as `owner`; everyone else auto-registers as `user`.
CREATE TABLE global_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'user')),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

-- Shared catalog. `status` is the owner's answer; import outcomes live on episodes. Nothing is deleted:
-- a declined channel keeps every episode, summary, vector, follow, and read receipt, and can be approved again.
CREATE TABLE channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'approved', 'declined')),
  initial_import_count INTEGER NOT NULL DEFAULT 5 CHECK (initial_import_count > 0),
  -- Set at the first approval, never reset. Decides whether a later approval starts an initial import
  -- and whether a declined channel reads "Declined" or "Withdrawn".
  approved_at INTEGER CHECK (approved_at IS NULL OR approved_at >= 0),
  -- Latest review only: approve, decline, and owner add write these. Kept when a declined channel is re-requested.
  reviewed_at INTEGER CHECK (reviewed_at IS NULL OR reviewed_at >= 0),
  reviewed_by_email TEXT REFERENCES global_users (email),
  review_note TEXT,
  -- Pause stops new runs on an approved channel. `system` = no active followers; `owner` = explicit and
  -- cleared only by the owner.
  paused_by TEXT CHECK (paused_by IS NULL OR paused_by IN ('owner', 'system')),
  paused_at INTEGER CHECK (paused_at IS NULL OR paused_at >= 0),
  last_checked_at INTEGER CHECK (last_checked_at IS NULL OR last_checked_at >= 0),
  last_ingested_at INTEGER CHECK (last_ingested_at IS NULL OR last_ingested_at >= 0),
  -- Fence for run writes; bumped when an approved channel is declined.
  lifecycle_version INTEGER NOT NULL DEFAULT 1 CHECK (lifecycle_version > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CHECK (status = 'requested' OR (reviewed_at IS NOT NULL AND reviewed_by_email IS NOT NULL)),
  CHECK ((paused_by IS NULL) = (paused_at IS NULL)),
  CHECK (paused_by IS NULL OR status = 'approved')
);

-- Cron selection: approved and not paused.
CREATE INDEX channels_status_paused_by ON channels (status, paused_by);

-- Who follows what, shared so the Registry can list requesters, count followers, and pause a channel nobody
-- follows. The User DO's channel_follows stays the source of truth for the user's own list; this record is kept
-- in step by the follow routes (docs/specs/channel-simplification.md §3.2). An active follow is unfollowed_at IS NULL.
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

-- Episodes carry the state machine. `pending` may be waiting; `failed` is a technical error that survived three
-- attempts; `skipped` is a deliberate, reversible outcome by the system or the owner.
CREATE TABLE episodes (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (channel_id),
  title TEXT NOT NULL,
  published_at INTEGER NOT NULL CHECK (published_at >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'available', 'failed', 'skipped')),
  waiting_code TEXT CHECK (waiting_code IS NULL OR waiting_code IN ('CAPTIONS', 'LIVE_OR_UPCOMING', 'PROVIDER_LIMIT')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_code TEXT,
  failure_detail TEXT,
  skip_reason TEXT CHECK (
    skip_reason IS NULL
    OR skip_reason IN ('SHORT', 'NON_ENGLISH', 'NO_CAPTIONS', 'LIVE_OR_UPCOMING', 'UNPLAYABLE', 'OWNER')
  ),
  skipped_at INTEGER CHECK (skipped_at IS NULL OR skipped_at >= 0),
  skipped_by_email TEXT REFERENCES global_users (email),
  transcript_checked_at INTEGER CHECK (transcript_checked_at IS NULL OR transcript_checked_at >= 0),
  chunk_count INTEGER CHECK (chunk_count IS NULL OR chunk_count >= 0),
  vectorized_at INTEGER CHECK (vectorized_at IS NULL OR vectorized_at >= 0),
  processed_at INTEGER CHECK (processed_at IS NULL OR processed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  -- Available means the full vector set is retrievable and a summary exists.
  CHECK (
    status <> 'available'
    OR (chunk_count IS NOT NULL AND chunk_count > 0 AND vectorized_at IS NOT NULL AND processed_at IS NOT NULL)
  ),
  CHECK (waiting_code IS NULL OR status = 'pending'),
  CHECK (status <> 'failed' OR failure_code IS NOT NULL),
  CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  CHECK (status <> 'skipped' OR skipped_at IS NOT NULL),
  CHECK (skipped_by_email IS NULL OR skip_reason = 'OWNER'),
  CHECK (skip_reason IS NULL OR skip_reason <> 'OWNER' OR skipped_by_email IS NOT NULL)
);

CREATE INDEX episodes_channel_id_status_published_at ON episodes (channel_id, status, published_at);

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

CREATE TABLE ingestion_runs (
  run_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (channel_id),
  workflow_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'scheduled', 'owner_retry')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  lifecycle_version INTEGER NOT NULL CHECK (lifecycle_version > 0),
  episode_limit INTEGER CHECK (episode_limit IS NULL OR episode_limit > 0),
  started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
  finished_at INTEGER CHECK (finished_at IS NULL OR finished_at >= 0),
  failure_code TEXT,
  failure_detail TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

CREATE INDEX ingestion_runs_channel_id_created_at ON ingestion_runs (channel_id, created_at);
-- At most one queued/running run per channel.
CREATE UNIQUE INDEX ingestion_runs_one_active_per_channel
  ON ingestion_runs (channel_id) WHERE status IN ('queued', 'running');

-- Per-run outcomes stay historical even after a later retry changes the episode's current status.
-- `selected` is the row's state until the run reaches the episode; `not_attempted` is a run that ended early.
CREATE TABLE ingestion_run_episodes (
  run_id TEXT NOT NULL REFERENCES ingestion_runs (run_id),
  video_id TEXT NOT NULL REFERENCES episodes (video_id),
  status TEXT NOT NULL CHECK (status IN ('selected', 'available', 'failed', 'skipped', 'waiting', 'not_attempted')),
  failure_code TEXT,
  started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
  finished_at INTEGER CHECK (finished_at IS NULL OR finished_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (run_id, video_id)
);
