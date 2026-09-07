-- Registry DO — channel_requests.channel_title (docs/specs/home-read-experience.md, decision 7).
-- The route captures the channel's RSS feed title when a request is submitted, so every request
-- list shows a name instead of an opaque id and approval has a default title without fetching.
-- Nullable: rows created before this migration have none.
-- Committed migrations are frozen: never edit this file, add 0003_*.sql instead.

ALTER TABLE channel_requests ADD COLUMN channel_title TEXT;
