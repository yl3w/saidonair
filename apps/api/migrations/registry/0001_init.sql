-- Global Registry DO — initial schema (docs/PRD.md §5.1, §5.3).
-- Committed migrations are frozen: never edit this file, add 0002_*.sql instead.
-- All timestamps are Unix milliseconds. Every table carries created_at.

-- Identities. `role` is the owner mechanism decided in AGENTS.md → Identity model:
-- the deployment seeds OWNER_EMAIL as `owner`; everyone else auto-registers as `user`.
CREATE TABLE global_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'user')),
  last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

-- Shared catalog. `status` is processing state; `deleted_at` is independent soft deletion.
CREATE TABLE channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'available', 'failed')),
  initial_import_count INTEGER NOT NULL DEFAULT 5 CHECK (initial_import_count > 0),
  failure_code TEXT,
  failure_detail TEXT,
  available_at INTEGER CHECK (available_at IS NULL OR available_at >= 0),
  last_checked_at INTEGER CHECK (last_checked_at IS NULL OR last_checked_at >= 0),
  last_ingested_at INTEGER CHECK (last_ingested_at IS NULL OR last_ingested_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0),
  lifecycle_version INTEGER NOT NULL DEFAULT 1 CHECK (lifecycle_version > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  -- A failed channel always carries a reason code.
  CHECK (status <> 'failed' OR failure_code IS NOT NULL)
);

CREATE INDEX channels_status_deleted_at ON channels (status, deleted_at);

-- Approval requests. youtube_channel_id is deliberately not a foreign key: the channel
-- may not exist until approval. approved_channel_id is set to the same id on approval.
CREATE TABLE channel_requests (
  request_id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES global_users (email),
  youtube_channel_id TEXT NOT NULL,
  submitted_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at INTEGER CHECK (reviewed_at IS NULL OR reviewed_at >= 0),
  reviewed_by_email TEXT REFERENCES global_users (email),
  owner_explanation TEXT,
  approved_channel_id TEXT REFERENCES channels (channel_id),
  auto_follow_completed_at INTEGER CHECK (auto_follow_completed_at IS NULL OR auto_follow_completed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (user_email, youtube_channel_id),
  -- Pending has no review outcome; approval needs channel + review; rejection needs review.
  CHECK (
    (status = 'pending' AND reviewed_at IS NULL AND reviewed_by_email IS NULL AND approved_channel_id IS NULL)
    OR (status = 'approved' AND reviewed_at IS NOT NULL AND reviewed_by_email IS NOT NULL AND approved_channel_id IS NOT NULL)
    OR (status = 'rejected' AND reviewed_at IS NOT NULL AND reviewed_by_email IS NOT NULL AND approved_channel_id IS NULL)
  ),
  -- Automatic-follow completion only makes sense for approved requests.
  CHECK (auto_follow_completed_at IS NULL OR status = 'approved')
);

CREATE INDEX channel_requests_user_email_created_at ON channel_requests (user_email, created_at);
CREATE INDEX channel_requests_auto_follow
  ON channel_requests (approved_channel_id, status, auto_follow_completed_at);

CREATE TABLE episodes (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels (channel_id),
  title TEXT NOT NULL,
  published_at INTEGER NOT NULL CHECK (published_at >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'processed', 'no_transcript', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_code TEXT,
  failure_detail TEXT,
  transcript_checked_at INTEGER CHECK (transcript_checked_at IS NULL OR transcript_checked_at >= 0),
  chunk_count INTEGER CHECK (chunk_count IS NULL OR chunk_count >= 0),
  vectorized_at INTEGER CHECK (vectorized_at IS NULL OR vectorized_at >= 0),
  processed_at INTEGER CHECK (processed_at IS NULL OR processed_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  -- Processed means the full vector set is retrievable and a summary exists.
  CHECK (
    status <> 'processed'
    OR (chunk_count > 0 AND vectorized_at IS NOT NULL AND processed_at IS NOT NULL)
  )
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
CREATE TABLE ingestion_run_episodes (
  run_id TEXT NOT NULL REFERENCES ingestion_runs (run_id),
  video_id TEXT NOT NULL REFERENCES episodes (video_id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'processed', 'no_transcript', 'failed', 'skipped')),
  failure_code TEXT,
  started_at INTEGER CHECK (started_at IS NULL OR started_at >= 0),
  finished_at INTEGER CHECK (finished_at IS NULL OR finished_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (run_id, video_id)
);
