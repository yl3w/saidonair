# Product Requirements Document (PRD)

**Product:** Multi-User Personal Media Digest Assistant
**Status:** v3 — shared catalog, owner approval, per-user follows and multiple chats
**Companion:** `AGENTS.md` is the engineering source of truth and overrides this document where they disagree.
The Home and Owner screens are specified in detail in `docs/specs/home-read-experience.md` (decided 2026-09-07);
the channel statuses, follows, and episode states they show come from `docs/specs/channel-simplification.md`
(decided 2026-09-10), which supersedes that spec where they differ.
**Implementation status:** This document defines the target requirements and logical schema, not completed features.

## 1. Summary

A personal, long-lived tool for a small, trusted set of users. One global YouTube channel catalog is shared by
everyone: anyone puts a channel in it by pasting the channel id, which also follows it, and the owner approves or
declines. The system ingests, vectorizes, and summarizes
each episode once, sharing that content across followers. Users receive personalized digests through their follows
and can maintain multiple independent conversations across all channels they currently follow.

The application runs entirely on Cloudflare with a text-only UI. Maintainability and privacy of user activity matter
more than speed of delivery. Scheduling cadence remains an owner decision.

### Goals

- Configure each channel once; retain one canonical transcript chunk/vector set and summary per episode.
- Let users discover catalog channels and add missing ones themselves, subject to owner approval.
- Present recent content from followed channels, with read/unread state private to each user.
- Answer questions using currently followed channels with video/timestamp citations.
- Preserve conversations through follow changes and through a channel being declined and approved again.
- Load Home in under five seconds for a user following 20 channels.

### Non-goals

Authentication, per-channel chat, non-YouTube sources, transcript generation for captionless videos, notifications,
email delivery, rich media, mobile apps, rate limiting, and general admin dashboards beyond owner catalog management.

## 2. Users and ownership

- Identity is normalized email (trimmed, lowercase), supplied through `X-User-Email`. No authentication is added.
  The UI says "Who is this for?", never "sign in". Unknown emails auto-register in the Registry DO.
- A user has zero or more follows and chats. Registration does not trigger ingestion.
- Only the owner approves, declines, pauses, and resumes catalog channels, and retries or skips an episode. Anyone can
  add a channel to the catalog, request a declined one again, follow any requested or approved channel, and unfollow
  their own follows.
- The owner is the identity with `role = 'owner'` in the Registry's `global_users`, seeded from the `OWNER_EMAIL`
  secret each time the Registry DO starts (promote only, never demote). Ordinary user identity never implicitly
  authorizes owner actions; Registry methods verify the role. The management interface is the Owner screens in §7.
  This does not introduce authentication.
- Chats, preferences, and read receipts are private to the User DO. Global identity, the catalog, and a follower
  record per channel and email live in the Registry, so it can count a channel's followers and list who is waiting on
  a requested one (decided 2026-09-10). Every channel in the catalog is visible to everyone.

## 3. Architecture

```text
Cloudflare Pages: Vite + Preact + TypeScript
    Account → Home (owner attention card · digest · followed and catalog channels · add a channel · chats in M4)
                 → Channel details
                 → Owner (approval queue · needs attention · catalog health) → Owner channel detail
                         |
              Hono Worker + X-User-Email
                         |
       +-----------------+------------------+
       |                                    |
Global Registry DO                    User DO per email
catalog, followers, episodes,          follows, read receipts,
shared summaries, ingestion runs       chats/messages/sources, preferences
       |
First approval, owner episode retry, or Cron → Workflow per channel run
       RSS → transcript → chunk → Workers AI embed → Vectorize
                                     → shared summary → episode available in the Registry

Vectorize: media-rag, namespace shared-catalog
Chat query: current follows ∩ approved channels
           → channelId metadata filter → validate available episodes → Workers AI answer
```

### Stack

| Concern | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo; `apps/api`, `apps/web`, `packages/shared` |
| Toolchain | Volta-pinned Node; `packageManager`-pinned pnpm |
| API | Cloudflare Worker, Hono, strict TypeScript |
| State | One SQLite Registry DO; one SQLite User DO per normalized email |
| Orchestration | Cloudflare Workflows per channel run; Cron schedule `TODO(owner)` |
| LLM | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| Embeddings | Workers AI `@cf/baai/bge-base-en-v1`, 768 dimensions, 512-token input cap |
| Vectors | Vectorize `media-rag`, cosine, explicit `shared-catalog` namespace; `channelId` and `videoId` metadata indexes |
| UI | Cloudflare Pages, Vite + Preact + TypeScript, `preact-iso`, plain CSS |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |
| Formatting | Biome |

Each DO owns its SQLite database. Local relationships use foreign keys and transactions; cross-DO references are
validated through DO methods. There are no cross-DO SQL joins or atomic transactions. See
[Cloudflare SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).

## 4. Functional requirements

### 4.1 Catalog, approval, and declining

- Users supply the channel id, a bare `UC…` id or any URL containing `/channel/UC…`, copied from the channel's About
  dialog (Share channel, then Copy channel ID). `@handle` and `/c/…` URLs are rejected with those instructions; there
  is no handle resolution and the YouTube Data API is not used. The id is verified by fetching its RSS feed, which
  also supplies the channel title. The owner may override it, at add or at approval.
- Channel status is `requested`, `approved`, or `declined` (decided 2026-09-10). It records the owner's answer about
  catalog membership and nothing about imports; import outcomes are episode state (§4.2). Channels are never deleted,
  and there is no channel failure code, channel waiting code, channel retry, or restore.
- Anyone adds a channel, which also follows them: a user's add creates it `requested`, the owner's creates it
  `approved` and starts the initial import. An id already in the catalog is not an error — a `requested` or
  `approved` channel is simply followed, and a `declined` one is refused with the owner's note and date so the
  interface can offer **Request again**.
- Requesting a declined channel again returns it to `requested`, keeps the review fields so the queue can show it was
  declined before, and follows the caller. It is explicit: the user sees the note first and confirms once.
- Owner approval sets `approved`, the review fields, and the first-approval timestamp. Initial ingestion starts only
  at that first approval, whether or not anyone follows yet; approving a channel that had been approved before starts
  nothing and leaves the first-approval timestamp alone. Approval recomputes the pause flag from the follower count.
- Owner decline sets `declined` and the review fields and clears the pause. A run in flight is not stopped: it
  finishes, and eligibility hides what it produced until the channel is approved again (decided 2026-09-11).
  Episodes, summaries, vectors, follows, and read receipts are all kept. Copy reads
  "Declined" when the channel was never approved and "Withdrawn" when it was.
- Requested and approved channels appear in everyone's catalog and can be followed; declined channels drop out of the
  catalog list, and their followers keep the row with the owner's note. There are no private requests: the owner queue
  is simply the requested channels, with their followers.

### 4.2 Episode lifecycle and ingestion

The state machine lives on episodes: `pending`, `available`, `failed`, `skipped`. A channel's status never records an
import outcome, so a channel whose every episode is skipped is an approved channel with no available episodes.

1. The first approval, or the owner's own add, creates an approved channel and starts one initial import. Initial
   import defaults to the five most recent RSS entries; `initial_import_count` is a positive, owner-configurable count.
2. Track every selected episode, including those without captions.
3. An episode becomes `available` after its complete vector set is ready for retrieval and its shared summary is
   stored. The accepted flagged raw-summary fallback counts as a stored summary. Partial vector writes are not
   published content, and `processed_at` — the summary's availability time — is never reset.
4. A `pending` episode may carry a wait reason; waiting never counts as an attempt:

| Waiting code | Meaning |
|---|---|
| `CAPTIONS` | A video published within the last 48 hours has no captions yet; re-checked each run |
| `LIVE_OR_UPCOMING` | The video is live or scheduled; the same 48-hour wait applies |
| `PROVIDER_LIMIT` | Transcript credits ran out and ended the run; the episode is reselected next run |

5. Deterministic outcomes are skipped by the system, reversibly, and never reach the owner's queue:

| Skip reason | Meaning |
|---|---|
| `SHORT` | Under 180 seconds; nothing is stored |
| `NON_ENGLISH` | Captions exist but none is an English track (decided 2026-09-08) |
| `NO_CAPTIONS` | Still no captions at or after 48 hours |
| `LIVE_OR_UPCOMING` | Still live at or after 48 hours |
| `UNPLAYABLE` | The provider reports the video cannot be played |
| `OWNER` | The owner skipped a failed episode by hand |

- Technical errors — provider HTTP and parse failures, failed or incomplete vectorization, embedding failures, and
  summary failures after the raw-text fallback — increment `attempt_count` and record the reason. Below three attempts
  the episode stays `pending` and the next scheduled run reattempts it; the third makes it `failed`. Only `failed`
  episodes reach the owner (decided 2026-09-10, replacing "technical failures are never restarted automatically").
  A provider authentication failure or a rate limit still standing after the step's own retries is a fact about the
  account, not the video: it ends the instance without counting an attempt and closes the run as failed with that
  code so the owner sees what to fix (decided 2026-09-11).
- Owner retry moves a `failed` or `skipped` episode back to `pending`, clearing attempts and skip fields, and owner
  skip moves a `failed` one to `skipped OWNER`. Both need an approved channel with no queued or running run. Sibling
  episodes and their summaries are untouched. There is no channel-level retry.
- Cron selects approved, non-paused channels with no queued or running run, every 6 hours (decided 2026-09-08), and
  per channel takes the new feed entries, meaning untracked ones published after the channel's first approval, plus
  every `pending` episode that is waiting or below three attempts. Follower count reaches selection only through the
  pause flag (§4.3). A tick spreads the instances it starts a few seconds apart and starts nothing while the
  transcript provider reports no credits (decided 2026-09-11).
- Persist each run and its exact episode selection/outcomes (`selected`, `available`, `failed`, `skipped`, `waiting`,
  `not_attempted`). At most one run per channel can be queued or running. The handler that creates a run reads the
  feed and selects; each selected episode is then ingested by its own Workflow instance, in which every transcript,
  AI, and Vectorize call is its own retryable step (decided 2026-09-11). The run closes when its last episode reports.
  A run-episode whose instance is lost is closed by a reconciliation sweep at the next cron tick; an approved channel
  with no run row at all needs the owner's attention.
- Transcripts come from DownSub's API (decided 2026-09-08; the InnerTube approach of 2026-09-07 was built, measured,
  and dropped because YouTube bot-checks Cloudflare's egress). A playable video with no captions is a skip reason;
  a provider error or any other failure is a technical failure, kept distinct. See AGENTS.md → Transcript contract.
- Reuse persisted progress and deterministic vector IDs. One canonical stored copy does not imply external API calls
  can execute exactly once under retries. Do not repeat completed ingestion just because another user follows.
- Declining a channel stops nothing in flight. Runs write episodes, summaries, and two channel timestamps, never
  channel state, so a run that outlives a decline publishes content that eligibility hides until re-approval (decided
  2026-09-11, replacing the `lifecycle_version` fence of 2026-09-10). A run's writes are accepted only while the run
  is open, which guards against a reconciled run's instance turning out to be alive.

### 4.3 Follows, followers, and pause

- Explicit follow/refollow is allowed for any `requested` or `approved` channel; following a `declined` one is refused
  with the owner's note, and the interface offers Request again instead.
- Follow membership is recorded twice: the User DO's follow row is what the user's own list shows, and the Registry
  keeps a follower record per channel and email so it can count followers, list who is waiting on a requested channel,
  and pause a channel nobody follows. A follow writes the User DO first and then the Registry; both writes are
  idempotent, and a pair left inconsistent by a failure is corrected by the next follow or unfollow of that pair.
- Unfollow retains a tombstone using `unfollowed_at`. It neither deletes global content nor changes other users.
- There is no automatic following. Adding a channel or requesting one again follows the caller in the same call, so
  requesters are followers from the start and nothing is handed off between the Durable Objects.
- Pause is a flag on approved channels, `paused_by` with `paused_at`, either `owner` or `system`. When the last active
  follower of an approved channel leaves, the system pauses it; the next follow lifts a system pause. An owner pause
  is lifted only by owner resume, which clears either kind. Declining clears the flag and approving recomputes it, so
  a channel nobody follows is paused as soon as it is approved while its one initial import still runs. A requested or
  declined channel is never paused.
- Pause stops new run selection only. A running run finishes, and the channel's existing summaries stay readable and
  searchable in digest, channel history, and chat — a paused channel is still eligible.
- Declining removes a channel from digest and future retrieval while preserving episodes, summaries, vectors, follows,
  read receipts, and historical citations. Approving it again restores access for its remaining active followers;
  explicitly unfollowed users stay unfollowed, and no new initial import runs.

### 4.4 Shared summaries, digests, and unread state

- Store one summary per episode: executive summary of at most three sentences, 3–5 takeaways each with the timestamp
  of the moment it comes from when the model can place it, and topic tags.
  Validate model JSON; retry invalid output once, then retain raw text with a fallback flag.
- User preferences affect chat answers only, not shared summaries.
- Cross-references are shared related-video IDs computed in the shared namespace, excluding the current video.
  Display only related titles belonging to the reader's eligible channels.
- Digest defaults to episodes published in the last 24 hours, newest first, within eligible followed channels.
  Channel pages show recent episodes to followers, with a summary on the available ones and a phrase on the rest.
- A summary is unread until actually returned in the digest or viewed on its channel page. Record a user-specific
  read receipt only for returned summaries, including when paginated. Absence of a receipt means unread.
- Existing summaries start unread on first follow. Preserve read receipts through unfollow, refollow, decline, and
  re-approval. Unread counts use currently eligible summaries; no shared summary row contains `read_at`.

### 4.5 Chats and retrieval

- A user can have zero or more independent chats. Each chat has an optional title and its own ordered messages.
  Retain all chats/messages; no chat deletion or archive functionality is required now.
- Every message searches all channels the user currently follows that are approved, paused or not. There is no
  fixed channel selection at chat creation and no chat-to-channel membership table.
- Following a new channel expands retrieval for existing chats; unfollow or a decline excludes future retrieval.
  Previous messages/citations remain visible and may still be used as conversation context. Do not scrub history.
- Chat creation, message submission, and history are never disabled for lack of follows. When no eligible channels
  exist, store the assistant response "Chat requires following at least one approved channel." with no sources;
  do not call AI or Vectorize for that response.
- Otherwise embed the question, retrieve the best three eligible chunks, combine their exact text with the user's
  preferences and this chat's recent history, and ask Workers AI to answer with video/timestamp citations.
- Store citation snapshots (video/channel IDs, titles, start time) with each reply. Link to
  `https://youtu.be/<videoId>?t=<startSec>`; later catalog changes must not erase historical sources.

## 5. Logical database schema

This is the target schema for SQLite-backed DO migrations. It does not authorize destructive changes to existing data.
Every table includes `created_at INTEGER NOT NULL` (Unix milliseconds), including each DO's `_migrations` table.
IDs and emails are `TEXT`; all fields are required unless marked `?`. Timestamps, counters, sequence/position values,
limits, and versions are `INTEGER`, except `start_sec`, which is `REAL` to preserve fractional transcript timing.
Other fields are `TEXT`; `_json` columns contain validated JSON text. `PK` and `FK` mean primary and foreign key.

### 5.1 Global Registry DO

| Table | Columns in addition to `created_at` | Keys and relationships |
|---|---|---|
| `global_users` | `email`, `role DEFAULT 'user'`, `last_seen_at` | PK `email`, normalized |
| `channels` | `channel_id`, `title`, `canonical_url`, `status`, `initial_import_count DEFAULT 5`, `approved_at?`, `reviewed_at?`, `reviewed_by_email?`, `review_note?`, `paused_by?`, `paused_at?`, `last_checked_at?`, `last_ingested_at?`, `updated_at` | PK `channel_id` (YouTube `UC…` ID); FK `reviewed_by_email → global_users.email` |
| `channel_followers` | `channel_id`, `user_email`, `followed_at`, `unfollowed_at?`, `updated_at` | Composite PK `(channel_id, user_email)`; FKs to `channels.channel_id` and `global_users.email`; an active follow is `unfollowed_at IS NULL` |
| `episodes` | `video_id`, `channel_id`, `title`, `published_at`, `status`, `waiting_code?`, `attempt_count DEFAULT 0`, `failure_code?`, `failure_detail?`, `skip_reason?`, `skipped_at?`, `skipped_by_email?`, `transcript_checked_at?`, `chunk_count?`, `vectorized_at?`, `processed_at?`, `updated_at` | PK `video_id`; FK `channel_id → channels.channel_id`; FK `skipped_by_email → global_users.email` |
| `episode_summaries` | `video_id`, `format`, `executive_summary?`, `takeaways_json?`, `topic_tags_json?`, `raw_text?`, `related_video_ids_json`, `model`, `prompt_version` | PK/FK `video_id → episodes.video_id`; `prompt_version` is a TEXT identifier |
| `ingestion_runs` | `run_id`, `channel_id`, `workflow_id`, `kind`, `status`, `episode_limit?`, `started_at?`, `finished_at?`, `failure_code?`, `failure_detail?` | PK `run_id`; unique `workflow_id`; FK `channel_id → channels.channel_id` |
| `ingestion_run_episodes` | `run_id`, `video_id`, `status`, `failure_code?`, `started_at?`, `finished_at?` | Composite PK `(run_id, video_id)`; FKs to runs and episodes |

`channel_followers` mirrors the User DO's follow rows so the Registry can count followers, list who is waiting on a
requested channel, and pause a channel nobody follows; the User DO stays the source of truth for a user's own list.
`approved_at` is set at the first approval and never reset; the review fields hold the latest review only and are kept
when a declined channel is requested again. Per-run episode outcomes remain historical even
when a later retry changes the episode's current status. Validate each run episode belongs to the run's channel.
`related_video_ids_json` is an array of shared episode IDs, validated in the Registry and filtered at read time.

### 5.2 Per-user DO

| Table | Columns in addition to `created_at` | Keys and relationships |
|---|---|---|
| `channel_follows` | `channel_id`, `followed_at`, `unfollowed_at?`, `updated_at` | PK `channel_id`; a retained row with `unfollowed_at` set records the unfollow |
| `summary_reads` | `video_id`, `read_at` | PK `video_id`; no row means unread |
| `chats` | `chat_id`, `title?`, `updated_at` | PK `chat_id` |
| `chat_messages` | `message_id`, `chat_id`, `sequence_number`, `role`, `content`, `status`, `failure_code?`, `reply_to_message_id?`, `channel_id?`, `updated_at` | PK `message_id`; FK `chat_id → chats.chat_id`; self-FK for reply; unique `(chat_id, sequence_number)` |
| `chat_message_sources` | `source_id`, `message_id`, `position`, `video_id`, `channel_id`, `video_title`, `channel_title`, `start_sec` | PK `source_id`; FK to message; unique `(message_id, position)` |
| `user_preferences` | `id`, `system_rules`, `updated_at` | Singleton PK constrained to `id = 'default'` |

Email is implicit in the owning User DO, not repeated in each row. Shared channel and video IDs are cross-DO
references validated through Registry methods, not SQLite foreign keys. A reply must belong to the same chat as its
referenced message. The nullable `chat_messages.channel_id` is retained for a possible future scoped view and stays
null for current global chats; it does not define retrieval scope. Sources capture the actual per-reply channel IDs.
Message content may be empty while an assistant reply is pending. Update chat ordering when messages are added.

### 5.3 Constraints and indexes

Use `CHECK` constraints for these enums:

| Column | Values |
|---|---|
| `global_users.role` | `owner`, `user` |
| `channels.status` | `requested`, `approved`, `declined` |
| `channels.paused_by` | `owner`, `system` |
| `episodes.status` | `pending`, `available`, `failed`, `skipped` |
| `episodes.waiting_code` | `CAPTIONS`, `LIVE_OR_UPCOMING`, `PROVIDER_LIMIT` |
| `episodes.skip_reason` | `SHORT`, `NON_ENGLISH`, `NO_CAPTIONS`, `LIVE_OR_UPCOMING`, `UNPLAYABLE`, `OWNER` |
| `episode_summaries.format` | `structured`, `raw_fallback` |
| `ingestion_runs.kind` | `initial`, `scheduled`, `owner_retry` |
| `ingestion_runs.status` | `queued`, `running`, `completed`, `failed`, `cancelled` |
| `ingestion_run_episodes.status` | `selected`, `available`, `failed`, `skipped`, `waiting`, `not_attempted` |
| `chat_messages.role` | `user`, `assistant` |
| `chat_messages.status` | `pending`, `completed`, `failed` |

- Positive import limits; nonnegative timestamps, attempt/chunk counts, sequence/position values,
  and source offsets. An available episode requires positive `chunk_count`, `vectorized_at`, and `processed_at`.
- Channel checks: an approved channel requires `approved_at`; any status other than `requested` requires `reviewed_at`
  and `reviewed_by_email`; `paused_by` and `paused_at` are both set or both null, and only on an approved channel.
- Episode checks: a waiting code only while `pending`; a failed episode requires `failure_code`; `skipped` and
  `skip_reason` imply each other, a skipped episode requires `skipped_at`, and `skipped_by_email` is present exactly
  for an `OWNER` skip. Keep prior failure history in ingestion runs.
- Structured summaries require executive summary, takeaways, and tags; raw fallback requires `raw_text`. Validate JSON
  shape at the application boundary as well as JSON validity. Mark episode processed and store summary in one local
  transaction after vector completion. SQLite cannot atomically commit with Vectorize.
- Registry indexes: `channels(status, paused_by)` for cron selection;
  `channel_followers(channel_id, unfollowed_at)` for follower counts and the owner queue;
  `episodes(channel_id, status, published_at)`; `ingestion_runs(channel_id, created_at)`.
- Add a partial unique index on `ingestion_runs(channel_id)` where status is `queued` or `running`.
- User indexes: `channel_follows(unfollowed_at)` and `chats(updated_at)`. The unique chat/message sequence and
  message/source position indexes also support ordered reads.
- Each DO has `_migrations(version TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`; run pending numbered migrations
  under `blockConcurrencyWhile`. Follow `AGENTS.md` for additive-only migration and committed-file rules. Both
  `0001_init.sql` files were rewritten once, on 2026-09-10 before first deployment, with owner approval
  (`docs/specs/channel-simplification.md` §6). One drop has been approved since: the Registry's
  `0002_drop_lifecycle_version.sql` (2026-09-11) removes `lifecycle_version` from `channels` and `ingestion_runs`
  as a new file, so the Registry lists two versions and the User DO one; otherwise those rules apply
  without exception.

## 6. Vector storage and retrieval boundaries

- Store transcript text only as shared Vectorize chunk metadata, not duplicated in each user database or namespace.
- Namespace: `shared-catalog`. ID: `${videoId}:${chunkIndex}`. Metadata:
  `{ videoId, channelId, channelTitle, title, startSec, endSec, text, publishedAt }`.
- Keep exact chunk text and the existing hybrid chunking contract: about 60 seconds, target 400 tokens by `chars / 4`,
  1–2 overlapping segments, strict maximum 480 tokens. Handle overlong individual segments without exceeding the cap.
- Every Vectorize helper requires explicit namespace scope. For ID-based methods, enforce that scope in the helper
  even if the underlying API does not accept a namespace parameter. No user-specific private text goes into this index.
- Chat uses `filter: { channelId: { $in: eligibleChannelIds } }`, `topK: 3`, and all metadata. Never send an empty or
  unfiltered fallback query. Split channel lists into filters below Vectorize's 2048-byte limit and merge by score.
- Validate returned episodes are available and channels remain eligible before using retrieved text. Fetch additional
  candidates as necessary when rejecting partial ingestion. Never publish availability based only on accepting an
  asynchronous upsert; verify the complete vector set is ready for retrieval.
- Declining a channel does not require vector deletion or rewriting every vector. Current catalog eligibility excludes
  the retained vectors; approving the channel again reuses them.
- The owner must create `channelId` and `videoId` metadata indexes before the first upsert. See
  [Cloudflare metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).

## 7. UI and target API

### Screens

- **Account `/`:** "Who is this for?" email input and recent local emails. Selected accounts go to `/home`;
  "Switch account" remains visible elsewhere.
- **Home `/home`:** one page for everyone. Owners see an attention card first (channels waiting for review, failed
  episodes, approved channels never started) linking to the Owner page; users never see it. Then the digest from
  eligible follows (last 24 hours, newest first, NEW markers for items with no prior read receipt, "Show last 7
  days"), and channels in two subsections: followed (summarised count, unread count, last ingestion, unfollow;
  requested rows read "awaiting owner approval", paused rows add "paused", and declined rows show "Declined" or
  "Withdrawn" with the owner's note and a Request again button that confirms once) and the catalog (approved and
  requested channels the reader does not follow, with follow). Below both, one "Add a channel" input for the `UC…`
  channel id with a line saying where to copy it: a new id creates and follows, an id already in the catalog follows,
  and a declined id shows the owner's note with Request again.
  Poll about every 15 seconds only while a followed channel is still awaiting the owner's decision.
  Chats join Home in M4; lack of follows never disables chat controls.
- **Channel `/channel/:id`:** any status. Requested shows the header and "awaiting owner approval" with no episodes;
  approved shows recent shared summaries and per-user read status for followers, and pending, skipped and failed
  episodes by title with their phrase; declined shows the owner's note, the date, and Request again. Follow control
  for non-followers. No per-channel chat input. Back link to Home.
- **Owner `/owner`:** owner only. Queue: requested channels oldest first with title, id, their followers by email,
  "nobody is waiting" when there are none, "previously declined" when re-requested, and approve and decline with an
  optional note; reviewed history collapsed. Needs attention: failed episodes grouped by channel with reason,
  attempts, retry and skip; then approved channels with no ingestion run at all, as information — there is no Start
  action until M3 adds a route that starts a run. Catalog health: channels by status, paused and declined counts,
  episodes by status, active runs, last successful ingestion; an all-channels table with status, paused, available
  over tracked episodes with skipped and failed counts, follower count, last ingestion, latest run, and the actions
  the status allows — approve, decline (confirming once with the follower count), pause, resume. Follower counts are
  real; the emails behind them appear only in the queue.
- **Owner channel detail `/owner/channels/:id`:** status, pause, approval and review fields, import count, follower
  count; episodes with status, wait reason, attempts, failure or skip reason, and summary format, with
  retry and skip; ingestion runs with per-episode outcomes; followers by email. Never shows any user's read or chat
  activity.
- Digest empty states: "Follow a channel to start your digest." with the catalog inline when the reader has
  no active follows; otherwise "Nothing new since yesterday." Chats display plain text with preserved newlines and
  source links.
- Owner management is limited to what supports approve, decline, pause, resume, and per-episode retry and skip; there
  is no general admin dashboard. Routing is history mode. The owner label is "Owner" throughout.

### Target resource contract

All endpoints except `/health` require `X-User-Email`, return 400 for missing/malformed email, and exchange JSON.
Owner endpoints additionally require `role = 'owner'`. Resolve chats only inside the caller's User DO. Shared request/response
types live in `packages/shared`; the web fetch wrapper remains the sole web `fetch` caller.

The API is modelled on entities, not roles: there is no owner namespace and no role-named type. Owner-only
operations are marked and return 403 to other callers; `?scope=all` widens a collection for the owner; channels
carry a `management` block for the owner and are otherwise identical for every caller.

| Method and path | Who | Purpose |
|---|---|---|
| `GET /me` | anyone | Caller's normalized email and role |
| `GET /catalog` | owner | Aggregate catalog state: channels requested/approved/paused/declined, episodes available/pending/waiting/failed/skipped, active runs, attention (failed episodes, never started, requested), last successful ingestion |
| `GET /channels` | anyone | Requested and approved channels with status, pause, follow state, follower count and episode counts; `?scope=all` (owner) adds declined ones, with `management` |
| `POST /channels` `{ channelId, title?, initialImportCount? }` | anyone | Create a requested channel and follow the caller (201); the owner's call creates it approved and starts the initial import. An existing requested or approved id is followed instead (200); a declined id is 409 with the owner's note |
| `GET /channels/:id` | anyone | One channel in any status, so a declined one can show its note; the owner also gets `management` |
| `POST /channels/:id/request` | anyone | Declined → requested; follows the caller |
| `POST /channels/:id/approve` `{ title?, initialImportCount?, explanation? }` | owner | Requested or declined → approved; the initial import runs only at the first approval |
| `POST /channels/:id/decline` `{ explanation? }` | owner | Requested or approved → declined, pause cleared; a run in flight finishes |
| `POST /channels/:id/pause` / `POST /channels/:id/resume` | owner | Owner pause; resume clears either kind of pause. Approved channels only |
| `GET /channels/:id/episodes` | anyone | Episodes newest first; the owner and followers of an approved channel receive summaries, which are marked read for the caller; the owner also receives processing detail |
| `POST /channels/:id/episodes/:videoId/retry` / `…/skip` | owner | Failed or skipped → pending with attempts cleared / failed → skipped by the owner |
| `GET /channels/:id/ingestion-runs` | owner | Ingestion runs with per-episode outcomes |
| `GET /channels/:id/followers` | owner | Emails and follow times of the channel's active followers |
| `GET /follows` | anyone (own) | Own follows, each with its channel — any status — and unread count |
| `PUT /follows/:channelId` / `DELETE /follows/:channelId` | anyone (own) | Follow/refollow a requested or approved channel (409 with the note for a declined one) / retain unfollow tombstone; both also write the Registry follower record |
| `GET /digest?since=<iso>` | anyone (own) | Eligible summaries, default last 24h, clamped to 7 days; mark returned summaries read |
| `POST /chats` / `GET /chats` | anyone (own) | Create an empty chat / list own chats |
| `GET /chats/:id/messages?limit=50` | anyone (own) | Selected chat history with citation snapshots |
| `POST /chats/:id/messages` `{ message }` | anyone (own) | Reply and sources using current eligible follows |
| `GET /preferences` / `PUT /preferences` | anyone (own) | Chat preference rules |

## 8. Verification and success criteria

- Two users following one channel produce one shared episode/summary/vector set with independent read receipts.
- Users cannot inspect another user's chats, messages, preferences, or read receipts. Follow membership is shared with
  the Registry so the owner sees a channel's followers and counts; that is the explicit exception, not private
  conversation access.
- Approve, decline, pause, and resume are owner-only, as are episode retry and skip. Requesters follow at the moment
  they request, so several followers share one ingestion pipeline and nothing is auto-followed later. A failure
  between the User DO write and the Registry follower record is corrected by the next follow or unfollow of that pair
  and never reverses an explicit unfollow.
- Initial import selects five episodes by default and runs once, at the first approval, whether or not anyone follows
  yet. Skip reasons and technical failures remain distinct; a technical error is reattempted on up to three runs
  before it becomes a failed episode that needs the owner.
- Unfollowing to zero followers pauses an approved channel; the next follow lifts a system pause, an owner pause
  survives it, and a paused channel's summaries stay readable while cron skips it.
- A run that outlives a decline publishes only content that eligibility hides; a write against a closed run is
  refused; partial vector writes cannot become chat context.
- Existing chats include newly followed channels and exclude unfollowed or declined ones from new retrieval.
  Historical messages and sources remain intact. Approving a declined channel again restores access for its remaining
  active followers, not for explicit unfollows.
- With no eligible follows, chats remain usable and persist the fixed response without calling AI/Vectorize.
- Read receipts apply only to summaries returned to that user. First-follow summaries start unread; declining and
  approving again keeps prior read status. Shared cross-references are filtered at display time.
- Real DO SQLite tests cover migrations and isolation. Use fakes for Workers AI/Vectorize; retain pure-function tests
  for chunking, RSS/URL parsing, and summary validation. Do not add tests for UI components or Workflow step ordering.
- `pnpm check` is the finish gate. Runtime behavior, especially transcript fetching, must also be exercised under
  `wrangler dev`. Follow the engineering constraints and setup commands in `AGENTS.md`.

## 9. Open decisions and retention

- **Channel state simplification — decided 2026-09-10** (`docs/specs/channel-simplification.md`). A channel is an
  approval container with three statuses, `requested`, `approved`, and `declined`, and carries no import outcome.
  Anyone adds a channel by pasting its id, which also follows it; the owner approves or declines. Declining is the one
  answer to "no, not this channel" and "we are withdrawing this one": it stops scheduling, hides the channel from the
  catalog list, keeps everything it produced, and is undone by the owner approving it again or a user requesting it
  again after reading the note. Channels are never deleted. Pause is a flag on approved channels, set by the system
  when the last follower leaves and by the owner by hand. Episodes carry the state machine — `pending`, `available`,
  `failed`, `skipped` — with technical errors retried on three runs before the owner sees them and deterministic
  outcomes skipped automatically, reversibly. Follows are recorded in the Registry as well as the User DO, so
  follower counts are real. The initial import runs once, at the first approval, regardless of followers. Gone with
  this decision: the request entity and its outcome phrases, automatic follows, channel failure codes, channel retry,
  the channel waiting code, channel soft delete and restore, and the follow eligibility guard. Because nothing was
  deployed, both `0001_init.sql` files were rewritten once, with owner approval, instead of extended (§5.3).
- **M3 execution model — decided 2026-09-11** (`docs/specs/m3-ingestion.md` §2). The Registry keeps one ingestion
  run per channel; the handler that creates it reads the feed and selects the episodes, and each selected episode is
  ingested by its own Workflow instance, so a lost instance blocks one episode and episodes process in parallel. The
  `lifecycle_version` fence of 2026-09-10 is reversed: declining stops nothing in flight, and the column was dropped
  by the one owner-approved drop migration. Lost instances reconcile at each cron tick once their run is an hour old,
  with no age window on "approved, never started". A tick staggers its instances by three seconds each, and a rate
  limit or an authentication failure never counts as an episode attempt. The deployment is on Workers Paid.
- Cron cadence — decided 2026-09-08: every 6 hours, `0 */6 * * *` UTC.
- Owner management interface: decided 2026-09-07 as the Owner screens in §7 and `docs/specs/home-read-experience.md`.
  Identification: `global_users.role` seeded from the `OWNER_EMAIL` secret.
- Retain all chats and all shared/user records for now. A future retention policy needs an owner decision.
- Whether Home's chat input should be pinned to the bottom when the digest is long remains a UI decision.

## 10. Milestones

```text
M1 Foundation    pnpm/Turbo/Volta scaffold · Hono · identity · Registry/User DO migrations
M2 Catalog       anyone adds a channel · owner approve/decline · pause · follows and followers
M3 Ingestion     shared runs/episodes · RSS/transcripts · chunking · embeddings · one Workflow instance per episode
M4 Intelligence  shared summaries · unread receipts · multiple chats · filtered retrieval/citations
M5 UI            account · home (digest · channels · add a channel) · owner queue · catalog health · channel details · conversations
M6 Hardening     isolation/lifecycle tests · wrangler verification · owner-decided cron · docs
```
