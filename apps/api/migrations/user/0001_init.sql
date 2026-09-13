-- Per-user DO — initial schema (docs/PRD.md §5.2, §5.3).
-- One object per normalized email; the email is implicit and never stored here.
-- Rewritten 2026-09-10 before first deployment, with owner approval. Migration governance is open (docs/PRD.md
-- §5.4, 2026-09-12): this file may be edited in place; storage that already applied it must be wiped for an edit to run.
-- Edited 2026-09-13: channel_follows removed. Follows have one record, the Registry's channel_followers
-- (docs/specs/follows-single-owner.md); this object holds only what is private to the user.
-- All timestamps are Unix milliseconds. Every table carries created_at.

-- Read receipts for shared summaries. No row means unread.
CREATE TABLE summary_reads (
  video_id TEXT PRIMARY KEY,
  read_at INTEGER NOT NULL CHECK (read_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

CREATE TABLE chats (
  chat_id TEXT PRIMARY KEY,
  title TEXT,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);

CREATE INDEX chats_updated_at ON chats (updated_at);

-- channel_id is reserved for a possible scoped view and stays NULL for global chats;
-- retrieval scope comes from the Registry's follower record, never from this column.
CREATE TABLE chat_messages (
  message_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats (chat_id),
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  failure_code TEXT,
  reply_to_message_id TEXT,
  channel_id TEXT,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (chat_id, sequence_number),
  -- Parent key for the composite foreign key below.
  UNIQUE (message_id, chat_id),
  -- A reply must belong to the same chat as the message it answers.
  FOREIGN KEY (reply_to_message_id, chat_id) REFERENCES chat_messages (message_id, chat_id),
  -- User messages are stored complete and never answer anything; assistant replies always do.
  CHECK (role <> 'user' OR (status = 'completed' AND reply_to_message_id IS NULL)),
  CHECK (role <> 'assistant' OR reply_to_message_id IS NOT NULL),
  CHECK (status <> 'failed' OR failure_code IS NOT NULL)
);

-- Citation snapshots. Later catalog changes never rewrite these rows.
CREATE TABLE chat_message_sources (
  source_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES chat_messages (message_id),
  position INTEGER NOT NULL CHECK (position >= 0),
  video_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  video_title TEXT NOT NULL,
  channel_title TEXT NOT NULL,
  start_sec REAL NOT NULL CHECK (start_sec >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (message_id, position)
);

-- Singleton. Rules apply to chat answers only, never to shared summaries.
CREATE TABLE user_preferences (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  system_rules TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
);
