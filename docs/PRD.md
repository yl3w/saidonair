# Product Requirements Document (PRD)

**Product:** Multi-User Personal Media Digest Assistant
**Status:** v3 — shared catalog, owner approval, per-user follows and multiple chats
**Companion:** `AGENTS.md` is the engineering source of truth and overrides this document where they disagree.
**Implementation status:** This document defines the target requirements and logical schema, not completed features.

## 1. Summary

A personal, long-lived tool for a small, trusted set of users. The owner manages one global YouTube channel catalog.
Users request channels for approval and follow available channels. The system ingests, vectorizes, and summarizes
each episode once, sharing that content across followers. Users receive personalized digests through their follows
and can maintain multiple independent conversations across all channels they currently follow.

The application runs entirely on Cloudflare with a text-only UI. Maintainability and privacy of user activity matter
more than speed of delivery. Scheduling cadence remains an owner decision.

### Goals

- Configure each channel once; retain one canonical transcript chunk/vector set and summary per episode.
- Let users discover available channels and request missing ones, subject to owner approval.
- Present recent content from followed channels, with read/unread state private to each user.
- Answer questions using currently followed channels with video/timestamp citations.
- Preserve conversations through follow changes and channel deletion/restoration.
- Load Home in under five seconds for a user following 20 channels.

### Non-goals

Authentication, per-channel chat, non-YouTube sources, transcript generation for captionless videos, notifications,
email delivery, rich media, mobile apps, rate limiting, and general admin dashboards beyond owner catalog management.

## 2. Users and ownership

- Identity is normalized email (trimmed, lowercase), supplied through `X-User-Email`. No authentication is added.
  The UI says "Who is this for?", never "sign in". Unknown emails auto-register in the Registry DO.
- A user has zero or more follows, requests, and chats. Registration does not trigger ingestion.
- Only the owner configures catalog channels, approves/rejects requests, retries failed channels, and deletes/restores
  channels. Users can submit requests, follow available channels, and unfollow their own follows.
- `TODO(owner):` specify how the trusted deployment identifies the owner and exposes management operations.
  Ordinary user identity must not implicitly authorize owner actions. This does not introduce authentication.
- Chats, preferences, follow state, and read receipts are private to the User DO. Global identity and approval requests
  live in the Registry; users see only their own requests, while the owner can review all requests.

## 3. Architecture

```text
Cloudflare Pages: Vite + Preact + TypeScript
    Account → Home (catalog/follows · digest · chat list/conversation · own requests)
                 → Channel details
                         |
              Hono Worker + X-User-Email
                         |
       +-----------------+------------------+
       |                                    |
Global Registry DO                    User DO per email
catalog, requests, episodes,           follows, read receipts,
shared summaries, ingestion runs       chats/messages/sources, preferences
       |
Owner approval/retry or Cron → Workflow per channel run
       RSS → transcript → chunk → Workers AI embed → Vectorize
                                     → shared summary → Registry completion

Vectorize: media-rag, namespace shared-catalog
Chat query: current follows ∩ available channels ∩ non-deleted channels
           → channelId metadata filter → validate processed episodes → Workers AI answer
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

### 4.1 Catalog and requests

- Accept `@handle`, `/channel/UC…`, and `/c/…` URLs and resolve them to a canonical YouTube channel ID.
- A request retains requester identity, submitted URL, canonical channel ID, approval/rejection status, review time,
  reviewer, and an optional owner explanation. One request per user/channel; several users may request the same channel.
- A request does not configure a catalog entry before approval. Owner approval creates or reuses one global channel
  and starts initial ingestion when needed; multiple approvals never duplicate channel processing.
- Only `available`, non-deleted channels appear in the followable catalog. Users see their requests separately,
  combining approval status with any approved channel's processing status and failure reason.
- Every approved requester is automatically followed once the channel is available. A failed initial import leaves
  approval intact and automatic following pending until successful owner retry.

### 4.2 Channel lifecycle and ingestion

Channel processing states are `pending`, `available`, and `failed`. `deleted_at` independently controls soft deletion.

1. Owner configuration/approval creates a pending channel. Initial import defaults to the five most recent RSS entries;
   `initial_import_count` is a positive, owner-configurable count.
2. Track every selected episode, including those without captions. Episode states are `pending`, `processing`,
   `processed`, `no_transcript`, and `failed`.
3. An episode is processed after its complete vector set is ready for retrieval and its shared summary is stored.
   The accepted flagged raw-summary fallback counts as a stored summary. Partial vector writes are not published content.
4. One processed episode makes the channel available immediately; the rest of the selected batch can continue.
   Later episode failures or missing captions do not revoke availability while usable content remains.
5. If initial attempts finish without a processed episode, set `failed` with a reason code:

| Reason code | Meaning |
|---|---|
| `NO_TRANSCRIPTS` | Every attempted episode definitively lacked captions |
| `NO_EPISODES` | No RSS episodes were available to attempt |
| `INITIAL_IMPORT_FAILED` | Technical failures, including a mix of failures and missing captions |

- Failed channels receive no scheduled ingestion. Only the owner can reset `failed → pending` to retry.
- Owner retry selects the latest configured episode count, skips already processed episodes, and may reattempt
  unsuccessful episodes, including those previously lacking captions.
- Cron selects available, non-deleted catalog channels independently of users and follower count. Cadence is undecided.
- Persist each run and its exact episode selection/outcomes. At most one run per channel can be queued or running.
  Each RSS, transcript, AI, and Vectorize call has its own retryable Workflow step.
- Reuse persisted progress and deterministic vector IDs. One canonical stored copy does not imply external API calls
  can execute exactly once under retries. Do not repeat completed ingestion just because another user follows.
- Channel deletion and owner retry increment `lifecycle_version`. Run writes must match that version; cancel/fence
  old runs so they cannot publish stale state or resurrect deleted channels.

### 4.3 Follows, deletion, restoration

- Explicit follow/refollow is allowed only for available, non-deleted channels.
- Unfollow retains a tombstone using `unfollowed_at`. It neither deletes global content nor changes other users.
- Automatic following is a durable handoff: select approved requests with no completion timestamp whose channel is
  available; ask the User DO to insert a follow only if no row exists; acknowledge completion in the Registry afterward.
  Existing active follows and unfollow tombstones are never overwritten. A crash/retry cannot reverse an unfollow.
- Owner deletion sets `deleted_at`, stops ingestion, and removes the channel from future retrieval and digest results.
  Preserve episodes, summaries, vectors, requests, follows, read receipts, and historical citations.
- Restoration clears `deleted_at`. Previous active followers regain access when the channel is available. Explicitly
  unfollowed users stay unfollowed. Restoration alone does not retry a failed channel.

### 4.4 Shared summaries, digests, and unread state

- Store one summary per episode: executive summary of at most three sentences, 3–5 takeaways, and topic tags.
  Validate model JSON; retry invalid output once, then retain raw text with a fallback flag.
- User preferences affect chat answers only, not shared summaries.
- Cross-references are shared related-video IDs computed in the shared namespace, excluding the current video.
  Display only related titles belonging to the reader's eligible channels.
- Digest defaults to episodes published in the last 24 hours, newest first, within eligible followed channels.
  Channel pages show recent processed episodes to followers.
- A summary is unread until actually returned in the digest or viewed on its channel page. Record a user-specific
  read receipt only for returned summaries, including when paginated. Absence of a receipt means unread.
- Existing summaries start unread on first follow. Preserve read receipts through unfollow, refollow, deletion, and
  restoration. Unread counts use currently eligible summaries; no shared summary row contains `read_at`.

### 4.5 Chats and retrieval

- A user can have zero or more independent chats. Each chat has an optional title and its own ordered messages.
  Retain all chats/messages; no chat deletion or archive functionality is required now.
- Every message searches all channels the user currently follows that are available and non-deleted. There is no
  fixed channel selection at chat creation and no chat-to-channel membership table.
- Following a new channel expands retrieval for existing chats; unfollow or deletion excludes future retrieval.
  Previous messages/citations remain visible and may still be used as conversation context. Do not scrub history.
- Chat creation, message submission, and history are never disabled for lack of follows. When no eligible channels
  exist, store the assistant response "Chat requires following at least one available channel." with no sources;
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
| `global_users` | `email`, `last_seen_at` | PK `email`, normalized |
| `channels` | `channel_id`, `title`, `canonical_url`, `status`, `initial_import_count DEFAULT 5`, `failure_code?`, `failure_detail?`, `available_at?`, `last_checked_at?`, `last_ingested_at?`, `deleted_at?`, `lifecycle_version DEFAULT 1`, `updated_at` | PK `channel_id` (YouTube `UC…` ID) |
| `channel_requests` | `request_id`, `user_email`, `youtube_channel_id`, `submitted_url`, `status`, `reviewed_at?`, `reviewed_by_email?`, `owner_explanation?`, `approved_channel_id?`, `auto_follow_completed_at?`, `updated_at` | PK `request_id`; unique `(user_email, youtube_channel_id)`; FKs for requester/reviewer to `global_users.email` and approved channel to `channels.channel_id` |
| `episodes` | `video_id`, `channel_id`, `title`, `published_at`, `status`, `attempt_count DEFAULT 0`, `failure_code?`, `failure_detail?`, `transcript_checked_at?`, `chunk_count?`, `vectorized_at?`, `processed_at?`, `updated_at` | PK `video_id`; FK `channel_id → channels.channel_id` |
| `episode_summaries` | `video_id`, `format`, `executive_summary?`, `takeaways_json?`, `topic_tags_json?`, `raw_text?`, `related_video_ids_json`, `model`, `prompt_version` | PK/FK `video_id → episodes.video_id`; `prompt_version` is a TEXT identifier |
| `ingestion_runs` | `run_id`, `channel_id`, `workflow_id`, `kind`, `status`, `lifecycle_version`, `episode_limit?`, `started_at?`, `finished_at?`, `failure_code?`, `failure_detail?` | PK `run_id`; unique `workflow_id`; FK `channel_id → channels.channel_id` |
| `ingestion_run_episodes` | `run_id`, `video_id`, `status`, `failure_code?`, `started_at?`, `finished_at?` | Composite PK `(run_id, video_id)`; FKs to runs and episodes |

`channel_requests.youtube_channel_id` can refer to a channel not yet approved; it is not a foreign key.
Approval sets `approved_channel_id` to the same canonical channel ID. Per-run episode outcomes remain historical even
when a later retry changes the episode's current status. Validate each run episode belongs to the run's channel.
`related_video_ids_json` is an array of shared episode IDs, validated in the Registry and filtered at read time.

### 5.2 Per-user DO

| Table | Columns in addition to `created_at` | Keys and relationships |
|---|---|---|
| `channel_follows` | `channel_id`, `followed_at`, `unfollowed_at?`, `origin`, `origin_request_id?`, `updated_at` | PK `channel_id`; retained row prevents automatic-follow replay after unfollow |
| `summary_reads` | `video_id`, `read_at` | PK `video_id`; no row means unread |
| `chats` | `chat_id`, `title?`, `updated_at` | PK `chat_id` |
| `chat_messages` | `message_id`, `chat_id`, `sequence_number`, `role`, `content`, `status`, `failure_code?`, `reply_to_message_id?`, `channel_id?`, `updated_at` | PK `message_id`; FK `chat_id → chats.chat_id`; self-FK for reply; unique `(chat_id, sequence_number)` |
| `chat_message_sources` | `source_id`, `message_id`, `position`, `video_id`, `channel_id`, `video_title`, `channel_title`, `start_sec` | PK `source_id`; FK to message; unique `(message_id, position)` |
| `user_preferences` | `id`, `system_rules`, `updated_at` | Singleton PK constrained to `id = 'default'` |

Email is implicit in the owning User DO, not repeated in each row. Shared channel/video/request IDs are cross-DO
references validated through Registry methods, not SQLite foreign keys. A reply must belong to the same chat as its
referenced message. The nullable `chat_messages.channel_id` is retained for a possible future scoped view and stays
null for current global chats; it does not define retrieval scope. Sources capture the actual per-reply channel IDs.
Message content may be empty while an assistant reply is pending. Update chat ordering when messages are added.

### 5.3 Constraints and indexes

Use `CHECK` constraints for these enums:

| Column | Values |
|---|---|
| `channels.status` | `pending`, `available`, `failed` |
| `channel_requests.status` | `pending`, `approved`, `rejected` |
| `episodes.status` | `pending`, `processing`, `processed`, `no_transcript`, `failed` |
| `episode_summaries.format` | `structured`, `raw_fallback` |
| `ingestion_runs.kind` | `initial`, `scheduled`, `owner_retry` |
| `ingestion_runs.status` | `queued`, `running`, `completed`, `failed`, `cancelled` |
| `ingestion_run_episodes.status` | `pending`, `processing`, `processed`, `no_transcript`, `failed`, `skipped` |
| `channel_follows.origin` | `manual`, `request` |
| `chat_messages.role` | `user`, `assistant` |
| `chat_messages.status` | `pending`, `completed`, `failed` |

- Positive import limits and lifecycle versions; nonnegative timestamps, attempt/chunk counts, sequence/position values,
  and source offsets. A processed episode requires positive `chunk_count`, `vectorized_at`, and `processed_at`.
- A failed channel requires `failure_code`; clear current channel failure fields on owner reset to pending. Keep prior
  failure history in ingestion runs. Set `available_at` on first availability, preserve it through deletion/restoration.
- Structured summaries require executive summary, takeaways, and tags; raw fallback requires `raw_text`. Validate JSON
  shape at the application boundary as well as JSON validity. Mark episode processed and store summary in one local
  transaction after vector completion. SQLite cannot atomically commit with Vectorize.
- Approval requires an approved channel, review time, and reviewer; rejection requires review time and reviewer.
  Pending requests have no review outcome. Automatic-follow completion is valid only for approved requests.
- Registry indexes: `channels(status, deleted_at)`; `channel_requests(user_email, created_at)`;
  `channel_requests(approved_channel_id, status, auto_follow_completed_at)`;
  `episodes(channel_id, status, published_at)`; `ingestion_runs(channel_id, created_at)`.
- Add a partial unique index on `ingestion_runs(channel_id)` where status is `queued` or `running`.
- User indexes: `channel_follows(unfollowed_at)` and `chats(updated_at)`. The unique chat/message sequence and
  message/source position indexes also support ordered reads.
- Each DO has `_migrations(version TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`; run pending numbered migrations
  under `blockConcurrencyWhile`. Follow `AGENTS.md` for additive-only migration and committed-file rules.

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
- Validate returned episodes are processed and channels remain eligible before using retrieved text. Fetch additional
  candidates as necessary when rejecting partial ingestion. Never publish availability based only on accepting an
  asynchronous upsert; verify the complete vector set is ready for retrieval.
- Channel deletion does not require vector deletion or rewriting every vector. Current catalog eligibility excludes
  retained vectors; restoration can reuse them.
- The owner must create `channelId` and `videoId` metadata indexes before the first upsert. See
  [Cloudflare metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/).

## 7. UI and target API

### Screens

- **Account `/`:** "Who is this for?" email input and recent local emails. Selected accounts go to `/home`;
  "Switch account" remains visible elsewhere.
- **Home `/home`:** first-time users are presented with the available catalog to follow. Show a digest from eligible
  follows, a chat list with create/select and a selected conversation, followed channels with processing/counts, and
  available catalog follow controls. Show own requests separately, including owner explanations and processing reasons.
  A "Request channel" URL input requests approval. Poll about every 15 seconds while own requests await approval or
  their approved channels are pending. Lack of follows never disables chat controls.
- **Channel `/channel/:id`:** available channel header; follow control for non-followers; recent shared summaries and
  per-user read status for followers. No per-channel chat input. Back link to Home.
- Digest empty state: "Nothing new since yesterday." Chats display plain text with preserved newlines and source links.
- Owner management is required, but the concrete management interface remains `TODO(owner)`.

### Target resource contract

All endpoints require `X-User-Email`, return 400 for missing/malformed email, and exchange JSON. Owner endpoints
additionally require the trusted owner check. Resolve chats only inside the caller's User DO. Shared request/response
types live in `packages/shared`; the web fetch wrapper remains the sole web `fetch` caller.

| Method and path | Purpose |
|---|---|
| `POST /chats` / `GET /chats` | Create an empty chat / list own chats |
| `GET /chats/:id/messages?limit=50` | Selected chat history with citation snapshots |
| `POST /chats/:id/messages` `{ message }` | Reply and sources using current eligible follows |
| `GET /digest?since=<iso>` | Eligible summaries, default last 24h; mark returned summaries read |
| `GET /channels` | Available, non-deleted catalog with caller follow state |
| `GET /channels/:id` | Available channel; recent summaries/counts for followers; mark returned summaries read |
| `GET /follows` | Own follows with channel availability, last ingestion, processed count, and unread count |
| `PUT /follows/:channelId` / `DELETE /follows/:channelId` | Follow/refollow available channel / retain unfollow tombstone |
| `POST /channel-requests` `{ url }` / `GET /channel-requests` | Submit request / list own requests with processing outcome |
| `GET /preferences` / `PUT /preferences` | Chat preference rules |
| `GET /owner/channels` / `POST /owner/channels` | Inspect all catalog states / configure a channel |
| `GET /owner/channel-requests` | Review all requests |
| `POST /owner/channel-requests/:id/approve` or `/reject` | Owner review with optional explanation |
| `POST /owner/channels/:id/retry` | Reset failed channel to pending and start retry |
| `DELETE /owner/channels/:id` / `POST /owner/channels/:id/restore` | Soft-delete / restore channel |

## 8. Verification and success criteria

- Two users following one channel produce one shared episode/summary/vector set with independent read receipts.
- Users cannot inspect another user's chats, messages, preferences, follows, or requests. Owner review is the explicit
  exception for global requests, not private conversation access.
- Approval is owner-only. Multiple requesters share ingestion and each automatically follows at availability.
  Repeated delivery, including a crash between User DO insertion and Registry acknowledgement, never reverses unfollow.
- Initial import selects five episodes by default. One processed episode unlocks availability; missing-caption,
  empty-feed, and technical failure reasons remain distinct. Failed channels require owner retry.
- Stale runs cannot publish after deletion/restart; partial vector writes cannot become chat context.
- Existing chats include newly followed channels and exclude unfollowed/deleted ones from new retrieval. Historical
  messages and sources remain intact. Restoration restores previous active follows, not explicit unfollows.
- With no eligible follows, chats remain usable and persist the fixed response without calling AI/Vectorize.
- Read receipts apply only to summaries returned to that user. First-follow summaries start unread; restoration keeps
  prior read status. Shared cross-references are filtered at display time.
- Real DO SQLite tests cover migrations and isolation. Use fakes for Workers AI/Vectorize; retain pure-function tests
  for chunking, RSS/URL parsing, and summary validation. Do not add tests for UI components or Workflow step ordering.
- `pnpm check` is the finish gate. Runtime behavior, especially transcript fetching, must also be exercised under
  `wrangler dev`. Follow the engineering constraints and setup commands in `AGENTS.md`.

## 9. Open decisions and retention

- `TODO(owner):` cron cadence and times; no chosen schedule is implied by this document.
- `TODO(owner):` owner identification and management interface in the trusted deployment.
- Retain all chats and all shared/user records for now. A future retention policy needs an owner decision.
- Whether Home's chat input should be pinned to the bottom when the digest is long remains a UI decision.

## 10. Milestones

```text
M1 Foundation    pnpm/Turbo/Volta scaffold · Hono · identity · Registry/User DO migrations
M2 Catalog       owner review/configuration · channel requests · follows · catalog lifecycle
M3 Ingestion     shared runs/episodes · RSS/transcripts · chunking · embeddings · retry fencing
M4 Intelligence  shared summaries · unread receipts · multiple chats · filtered retrieval/citations
M5 UI            account · available catalog/requests · digest · conversations · channel details
M6 Hardening     isolation/lifecycle tests · wrangler verification · owner-decided cron · docs
```
